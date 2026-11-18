package runner

import (
	"context"
	"errors"
	"fmt"
	"math"
	"reflect"
	"strconv"
	"unicode"
	"unicode/utf8"
)

// Node is a typed Step handler. Its Handler decodes a Step's resolved fields
// into In, calls the Node, and encodes the Out it returns as the Step's
// output, so a Host writes against its own types instead of map[string]any.
//
// In and Out are each a struct type or map[string]any. A map[string]any
// passes through untouched in either direction; a struct is decoded from, or
// encoded to, the field map by the naming rules below.
//
// # Field naming
//
// A struct field's key is the name in its `hatua` struct tag:
//
//	type Request struct {
//		URL     string            `hatua:"url"`
//		Headers map[string]string // key "headers"
//		Retries int               `hatua:"-"` // never decoded or encoded
//	}
//
// An exported field with no tag, or with an empty tag name, takes its Go
// name with the first letter lowercased, so `Headers` is "headers" and `URL`
// is "uRL". The tag "-" skips the field. Unexported fields are always
// skipped. An embedded struct is a field like any other, keyed by its type
// name; its fields are not promoted into the enclosing map. Two fields of one
// struct that resolve to the same key make the type unusable.
//
// # Decoding
//
// A key absent from the field map, or present with a nil value, leaves the
// field at its zero value: a nil pointer, a nil slice, an empty string.
// Whether a field is required is the Definition validator's concern, not the
// decoder's. A key that matches no field is ignored.
//
// A value whose type is assignable to the field is stored as it is. Otherwise:
//
//   - string and bool fields take only a string and a bool.
//   - Integer fields take any Go integer or float, provided it is a whole
//     number that fits the field; 2.0 decodes into an int, 2.5 does not.
//   - Float fields take any Go integer or float that fits the field.
//   - Slice fields take any slice, decoded element by element.
//   - Map fields have string keys and take any map with string keys, decoded
//     entry by entry.
//   - Struct fields take any map with string keys, decoded by the rules
//     above.
//   - Pointer fields are allocated and the value decoded into what they
//     point to.
//   - Interface fields, `any` included, take any value the interface admits.
//
// Arrays, complex numbers, channels, functions and unsafe pointers are not
// supported anywhere in In or Out.
//
// A value that does not fit is a *FieldError naming the field by its path
// from the top of the field map, such as `request.headers["accept"]` or
// `items[2].name`, and the Handler returns it as the Step's error.
//
// # Encoding
//
// A struct Out becomes a map holding every field the naming rules keep,
// zero values included. Nested structs become map[string]any, slices []any
// and maps map[string]any, recursively; a nil pointer, slice, map or
// interface becomes nil. A scalar keeps its kind but loses any named type, so
// a field of type `type Mode string` encodes as a plain string.
type Node[In, Out any] func(ctx context.Context, in In) (Out, error)

// Errors a Node reports. ErrInputType and ErrOutputType are returned when a
// Node is adapted to a Handler, before any Step runs. ErrFieldType and
// ErrFieldRange are returned while a Step runs, each wrapped in a
// *FieldError that names the field.
var (
	// ErrInputType reports a Node whose In is not a type the decoder can
	// fill.
	ErrInputType = errors.New("node input type is not supported")
	// ErrOutputType reports a Node whose Out is not a type the encoder can
	// turn into a Step's output.
	ErrOutputType = errors.New("node output type is not supported")
	// ErrFieldType reports a value whose kind does not fit its field, such as
	// a string where an int is declared.
	ErrFieldType = errors.New("value does not fit the field's type")
	// ErrFieldRange reports a number of the right kind that the field cannot
	// hold: a fraction or an overflowing value for an integer field, a
	// negative value for an unsigned one, an overflowing value for a float32.
	ErrFieldRange = errors.New("value is out of range for the field")
)

// FieldError is the error a Node's Handler returns when one field cannot be
// decoded from the Step's fields, or encoded into the Step's output. Field is
// the path to it, and Err wraps ErrFieldType or ErrFieldRange with the detail.
type FieldError struct {
	Field string
	Err   error
}

// Error renders the field's path alongside the reason.
func (e *FieldError) Error() string {
	return fmt.Sprintf("runner: field %s: %v", e.Field, e.Err)
}

// Unwrap exposes the cause, so errors.Is matches the sentinel it wraps.
func (e *FieldError) Unwrap() error { return e.Err }

var fieldMapType = reflect.TypeFor[map[string]any]()

// Handler adapts n to a Handler. It checks In and Out once, here, and returns
// an error wrapping ErrInputType or ErrOutputType when either is not a
// struct or map[string]any built from supported kinds, and ErrNilHandler
// when n is nil.
//
// The returned Handler decodes the Step's fields into In, returning a
// *FieldError when a value does not fit; calls n, returning its error as it
// is; and encodes Out as the Step's output.
func (n Node[In, Out]) Handler() (Handler, error) {
	if n == nil {
		return nil, ErrNilHandler
	}
	inType, outType := reflect.TypeFor[In](), reflect.TypeFor[Out]()
	if err := checkTopType(inType); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInputType, err)
	}
	if err := checkTopType(outType); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrOutputType, err)
	}
	return func(ctx context.Context, fields map[string]any) (map[string]any, error) {
		var in In
		if err := decodeValue("", reflect.ValueOf(fields), reflect.ValueOf(&in).Elem()); err != nil {
			return nil, err
		}
		out, err := n(ctx, in)
		if err != nil {
			return nil, err
		}
		ov := reflect.ValueOf(&out).Elem()
		if outType == fieldMapType {
			return ov.Interface().(map[string]any), nil
		}
		return encodeStruct("", ov)
	}, nil
}

// RegisterNode adapts n with its Handler method and registers the result
// under verb. Adapting errors come back wrapped in a *VerbError that names
// the verb, exactly as Register's own errors do.
func RegisterNode[In, Out any](r *Registry, verb string, n Node[In, Out]) error {
	h, err := n.Handler()
	if err != nil {
		return &VerbError{Verb: verb, Err: err}
	}
	return r.Register(verb, h)
}

// checkTopType reports whether t can be a Node's In or Out.
func checkTopType(t reflect.Type) error {
	if t == fieldMapType {
		return nil
	}
	if t.Kind() != reflect.Struct {
		return fmt.Errorf("%s is neither a struct nor map[string]any", t)
	}
	return checkType("", t, map[reflect.Type]bool{})
}

// checkType reports the first part of t the decoder and encoder cannot
// handle. seen stops the walk at a struct type already being checked, so a
// recursive type such as a tree node terminates.
func checkType(path string, t reflect.Type, seen map[reflect.Type]bool) error {
	switch t.Kind() {
	case reflect.Bool, reflect.String,
		reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
		reflect.Float32, reflect.Float64, reflect.Interface:
		return nil
	case reflect.Pointer:
		return checkType(path, t.Elem(), seen)
	case reflect.Slice:
		return checkType(path+"[]", t.Elem(), seen)
	case reflect.Map:
		if t.Key().Kind() != reflect.String {
			return fmt.Errorf("%s: map key %s is not a string", describePath(path), t.Key())
		}
		return checkType(path+"[]", t.Elem(), seen)
	case reflect.Struct:
		if seen[t] {
			return nil
		}
		seen[t] = true
		fields, err := structFields(t)
		if err != nil {
			return fmt.Errorf("%s: %v", describePath(path), err)
		}
		for _, f := range fields {
			if err := checkType(joinField(path, f.key), t.Field(f.index).Type, seen); err != nil {
				return err
			}
		}
		return nil
	default:
		return fmt.Errorf("%s: %s is not supported", describePath(path), t)
	}
}

func describePath(path string) string {
	if path == "" {
		return "top level"
	}
	return "field " + path
}

// structField is one field of a struct the naming rules keep: its key in the
// field map and its index in the struct.
type structField struct {
	key   string
	index int
}

// structFields lists the fields of struct type t the naming rules keep, and
// reports two fields that resolve to the same key.
func structFields(t reflect.Type) ([]structField, error) {
	var fields []structField
	byKey := map[string]string{}
	for i := range t.NumField() {
		f := t.Field(i)
		if !f.IsExported() {
			continue
		}
		key := f.Tag.Get("hatua")
		if key == "-" {
			continue
		}
		if key == "" {
			key = lowerFirst(f.Name)
		}
		if other, ok := byKey[key]; ok {
			return nil, fmt.Errorf("%s fields %s and %s both use key %q", t, other, f.Name, key)
		}
		byKey[key] = f.Name
		fields = append(fields, structField{key: key, index: i})
	}
	return fields, nil
}

func lowerFirst(s string) string {
	r, size := utf8.DecodeRuneInString(s)
	return string(unicode.ToLower(r)) + s[size:]
}

func joinField(path, key string) string {
	if path == "" {
		return key
	}
	return path + "." + key
}

func joinIndex(path string, i int) string {
	return path + "[" + strconv.Itoa(i) + "]"
}

func joinKey(path, key string) string {
	return path + "[" + strconv.Quote(key) + "]"
}

// mismatch is the *FieldError for a src whose kind does not fit dst.
func mismatch(path string, src reflect.Value, dst reflect.Type) error {
	return &FieldError{Field: path, Err: fmt.Errorf("%w: cannot decode %s into %s", ErrFieldType, src.Type(), dst)}
}

func outOfRange(path string, src reflect.Value, dst reflect.Type, why string) error {
	return &FieldError{Field: path, Err: fmt.Errorf("%w: %v %s %s", ErrFieldRange, src.Interface(), why, dst)}
}

// decodeValue stores src into dst, which is settable. path names dst for
// errors. An invalid src, or a nil one of a nilable kind, leaves dst as it
// is.
func decodeValue(path string, src, dst reflect.Value) error {
	for src.IsValid() && src.Kind() == reflect.Interface {
		src = src.Elem()
	}
	if !src.IsValid() || isNil(src) {
		return nil
	}
	t := dst.Type()
	if src.Type().AssignableTo(t) {
		dst.Set(src)
		return nil
	}
	switch t.Kind() {
	case reflect.Bool:
		if src.Kind() != reflect.Bool {
			return mismatch(path, src, t)
		}
		dst.SetBool(src.Bool())
	case reflect.String:
		if src.Kind() != reflect.String {
			return mismatch(path, src, t)
		}
		dst.SetString(src.String())
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return decodeInt(path, src, dst)
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return decodeUint(path, src, dst)
	case reflect.Float32, reflect.Float64:
		return decodeFloat(path, src, dst)
	case reflect.Pointer:
		elem := reflect.New(t.Elem())
		if err := decodeValue(path, src, elem.Elem()); err != nil {
			return err
		}
		dst.Set(elem)
	case reflect.Slice:
		if src.Kind() != reflect.Slice && src.Kind() != reflect.Array {
			return mismatch(path, src, t)
		}
		out := reflect.MakeSlice(t, src.Len(), src.Len())
		for i := range src.Len() {
			if err := decodeValue(joinIndex(path, i), src.Index(i), out.Index(i)); err != nil {
				return err
			}
		}
		dst.Set(out)
	case reflect.Map:
		if src.Kind() != reflect.Map || src.Type().Key().Kind() != reflect.String {
			return mismatch(path, src, t)
		}
		out := reflect.MakeMapWithSize(t, src.Len())
		iter := src.MapRange()
		for iter.Next() {
			key := iter.Key().String()
			elem := reflect.New(t.Elem()).Elem()
			if err := decodeValue(joinKey(path, key), iter.Value(), elem); err != nil {
				return err
			}
			out.SetMapIndex(reflect.ValueOf(key).Convert(t.Key()), elem)
		}
		dst.Set(out)
	case reflect.Struct:
		if src.Kind() != reflect.Map || src.Type().Key().Kind() != reflect.String {
			return mismatch(path, src, t)
		}
		fields, err := structFields(t)
		if err != nil {
			return &FieldError{Field: path, Err: fmt.Errorf("%w: %v", ErrFieldType, err)}
		}
		for _, f := range fields {
			v := src.MapIndex(reflect.ValueOf(f.key).Convert(src.Type().Key()))
			if err := decodeValue(joinField(path, f.key), v, dst.Field(f.index)); err != nil {
				return err
			}
		}
	default:
		// Interfaces land here only when src does not implement them, and
		// every other kind is refused by checkType before a Step runs.
		return mismatch(path, src, t)
	}
	return nil
}

func isNil(v reflect.Value) bool {
	switch v.Kind() {
	case reflect.Map, reflect.Pointer, reflect.Slice, reflect.Interface, reflect.Chan, reflect.Func:
		return v.IsNil()
	}
	return false
}

// twoTo63 is 2^63, the smallest float64 beyond int64's range; float64
// represents it and 2^64, the smallest beyond uint64's, exactly.
const twoTo63 = float64(1 << 63)

func decodeInt(path string, src, dst reflect.Value) error {
	var n int64
	switch src.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		n = src.Int()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		u := src.Uint()
		if u > math.MaxInt64 {
			return outOfRange(path, src, dst.Type(), "overflows")
		}
		n = int64(u)
	case reflect.Float32, reflect.Float64:
		f := src.Float()
		if f != math.Trunc(f) {
			return outOfRange(path, src, dst.Type(), "is not a whole number for")
		}
		if f < -twoTo63 || f >= twoTo63 {
			return outOfRange(path, src, dst.Type(), "overflows")
		}
		n = int64(f)
	default:
		return mismatch(path, src, dst.Type())
	}
	if dst.OverflowInt(n) {
		return outOfRange(path, src, dst.Type(), "overflows")
	}
	dst.SetInt(n)
	return nil
}

func decodeUint(path string, src, dst reflect.Value) error {
	var n uint64
	switch src.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		i := src.Int()
		if i < 0 {
			return outOfRange(path, src, dst.Type(), "is negative for")
		}
		n = uint64(i)
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		n = src.Uint()
	case reflect.Float32, reflect.Float64:
		f := src.Float()
		if f != math.Trunc(f) {
			return outOfRange(path, src, dst.Type(), "is not a whole number for")
		}
		if f < 0 {
			return outOfRange(path, src, dst.Type(), "is negative for")
		}
		if f >= 2*twoTo63 {
			return outOfRange(path, src, dst.Type(), "overflows")
		}
		n = uint64(f)
	default:
		return mismatch(path, src, dst.Type())
	}
	if dst.OverflowUint(n) {
		return outOfRange(path, src, dst.Type(), "overflows")
	}
	dst.SetUint(n)
	return nil
}

func decodeFloat(path string, src, dst reflect.Value) error {
	var f float64
	switch src.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		f = float64(src.Int())
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		f = float64(src.Uint())
	case reflect.Float32, reflect.Float64:
		f = src.Float()
	default:
		return mismatch(path, src, dst.Type())
	}
	if dst.OverflowFloat(f) {
		return outOfRange(path, src, dst.Type(), "overflows")
	}
	dst.SetFloat(f)
	return nil
}

// encodeStruct encodes struct v as a field map.
func encodeStruct(path string, v reflect.Value) (map[string]any, error) {
	fields, err := structFields(v.Type())
	if err != nil {
		return nil, &FieldError{Field: path, Err: fmt.Errorf("%w: %v", ErrFieldType, err)}
	}
	out := make(map[string]any, len(fields))
	for _, f := range fields {
		key := joinField(path, f.key)
		ev, err := encodeValue(key, v.Field(f.index))
		if err != nil {
			return nil, err
		}
		out[f.key] = ev
	}
	return out, nil
}

// encodeValue turns v into the plain value a Step's output holds. path names
// v for errors; only an interface holding an unsupported kind produces one,
// since checkType refuses every other unsupported kind before a Step runs.
func encodeValue(path string, v reflect.Value) (any, error) {
	if !v.IsValid() || isNil(v) {
		return nil, nil
	}
	switch v.Kind() {
	case reflect.Interface, reflect.Pointer:
		return encodeValue(path, v.Elem())
	case reflect.Struct:
		return encodeStruct(path, v)
	case reflect.Slice, reflect.Array:
		out := make([]any, v.Len())
		for i := range v.Len() {
			ev, err := encodeValue(joinIndex(path, i), v.Index(i))
			if err != nil {
				return nil, err
			}
			out[i] = ev
		}
		return out, nil
	case reflect.Map:
		if v.Type().Key().Kind() != reflect.String {
			break
		}
		out := make(map[string]any, v.Len())
		iter := v.MapRange()
		for iter.Next() {
			key := iter.Key().String()
			ev, err := encodeValue(joinKey(path, key), iter.Value())
			if err != nil {
				return nil, err
			}
			out[key] = ev
		}
		return out, nil
	case reflect.Bool:
		return v.Bool(), nil
	case reflect.String:
		return v.String(), nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
		reflect.Float32, reflect.Float64:
		return v.Convert(basicTypes[v.Kind()]).Interface(), nil
	}
	return nil, &FieldError{Field: path, Err: fmt.Errorf("%w: cannot encode %s", ErrFieldType, v.Type())}
}

// basicTypes maps each numeric kind to its unnamed Go type, so a named
// numeric type encodes as the plain number it is built on.
var basicTypes = map[reflect.Kind]reflect.Type{
	reflect.Int:     reflect.TypeFor[int](),
	reflect.Int8:    reflect.TypeFor[int8](),
	reflect.Int16:   reflect.TypeFor[int16](),
	reflect.Int32:   reflect.TypeFor[int32](),
	reflect.Int64:   reflect.TypeFor[int64](),
	reflect.Uint:    reflect.TypeFor[uint](),
	reflect.Uint8:   reflect.TypeFor[uint8](),
	reflect.Uint16:  reflect.TypeFor[uint16](),
	reflect.Uint32:  reflect.TypeFor[uint32](),
	reflect.Uint64:  reflect.TypeFor[uint64](),
	reflect.Float32: reflect.TypeFor[float32](),
	reflect.Float64: reflect.TypeFor[float64](),
}
