package expressions

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

// The value space.
//
// Two rules make everything else in this package tractable, and both are pinned
// by ADR-0009:
//
//   - There is exactly one absent value, nil. A missing key yields it, and
//     reading a property of it yields it again.
//   - There is one numeric type and it is float64, so `7 / 2` is 3.5 here as
//     well as in TypeScript. Never reach for int.
//
// NaN and Inf are not in the space at all: division by zero is an error rather
// than a value, which is what keeps them out.

// ValueType is every type a value or a declaration can name. The first seven
// are the Component Manifest's own output types, so a field's declared type and
// an expression's type are drawn from one vocabulary rather than two that have
// to be mapped. TypeUnknown and TypeNull exist only in the language.
type ValueType string

const (
	TypeText     ValueType = "text"
	TypeNumber   ValueType = "number"
	TypeBoolean  ValueType = "boolean"
	TypeDatetime ValueType = "datetime"
	TypeList     ValueType = "list"
	TypeObject   ValueType = "object"
	TypeItem     ValueType = "item"
	TypeUnknown  ValueType = "unknown"
	TypeNull     ValueType = "null"
)

// Value is string, float64, bool, time.Time, []Value, map[string]Value or nil.
type Value = any

// TypeOf reports a value's type in the same vocabulary a manifest declares.
//
// The integer cases are not part of the value space — there is one numeric type
// and it is float64 — but they are what a YAML decoder produces, including this
// SDK's own LoadDefinition. Recognising them here means a Host that feeds
// decoded YAML straight in gets a number rather than being told its count is an
// object; Normalize is what actually converts them.
func TypeOf(value Value) ValueType {
	switch value.(type) {
	case nil:
		return TypeNull
	case string:
		return TypeText
	case float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return TypeNumber
	case bool:
		return TypeBoolean
	case time.Time:
		return TypeDatetime
	case []Value:
		return TypeList
	case map[string]Value:
		return TypeObject
	}
	return TypeObject
}

// Normalize converts a value into the value space: every number becomes a
// float64, and lists and objects are converted through.
//
// It exists because the value space and Go's YAML and JSON decoders disagree
// about integers. `count: 24` decodes to an `int`, and an `int` reaching the
// evaluator used to be typed `object` and rendered as "null" — a silent wrong
// answer rather than a loud failure. Values arriving from a Host are normalized
// as they are read, so a runner can hand over decoded YAML without knowing any
// of this.
func Normalize(value Value) Value {
	switch v := value.(type) {
	case int:
		return float64(v)
	case int8:
		return float64(v)
	case int16:
		return float64(v)
	case int32:
		return float64(v)
	case int64:
		return float64(v)
	case uint:
		return float64(v)
	case uint8:
		return float64(v)
	case uint16:
		return float64(v)
	case uint32:
		return float64(v)
	case uint64:
		return float64(v)
	case float32:
		return float64(v)
	case []any:
		out := make([]Value, 0, len(v))
		for _, item := range v {
			out = append(out, Normalize(item))
		}
		return out
	case map[string]any:
		out := make(map[string]Value, len(v))
		for key, item := range v {
			out[key] = Normalize(item)
		}
		return out
	}
	return value
}

// Satisfies reports whether a value matches a declared type.
//
// Coercion at the boundary is narrow and declared, so "must match" has a
// precise meaning: any scalar into text is permitted, because a text field is
// the universal sink and that is exactly what interpolation already does; text
// into number is not implicit and requires num.parse(); nil satisfies any
// declared type, since whether absence is acceptable is `req:`'s business and
// not the evaluator's; everything else must match exactly.
func Satisfies(value Value, declared ValueType) bool {
	if declared == TypeUnknown || declared == TypeItem {
		return true
	}
	if value == nil {
		return true
	}
	actual := TypeOf(value)
	if actual == declared {
		return true
	}
	if declared == TypeText {
		return IsScalar(actual)
	}
	return false
}

// IsScalar reports whether a type is one of the four that can render as text.
func IsScalar(t ValueType) bool {
	return t == TypeText || t == TypeNumber || t == TypeBoolean || t == TypeDatetime
}

// AsText renders a value at a text boundary.
func AsText(value Value) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case float64:
		return NumberToText(v)
	case bool:
		if v {
			return "true"
		}
		return "false"
	case time.Time:
		return DatetimeToText(v)
	}
	return ToJSON(value)
}

// ToJSON is canonical JSON — what json.stringify produces.
//
// Hand-rolled in both languages rather than reaching for the built-in, because
// the two built-ins disagree in ways that would reach a user: Go sorts object
// keys and JavaScript preserves insertion order, Go escapes `<` and `&` by
// default, and each formats numbers its own way. Sorting keys in both is the
// only choice that can be made identical, so both sort.
func ToJSON(value Value) string {
	switch v := value.(type) {
	case nil:
		return "null"
	case string:
		return jsonString(v)
	case float64:
		return NumberToText(v)
	case bool:
		if v {
			return "true"
		}
		return "false"
	case time.Time:
		return jsonString(DatetimeToText(v))
	case []Value:
		parts := make([]string, 0, len(v))
		for _, item := range v {
			parts = append(parts, ToJSON(item))
		}
		return "[" + strings.Join(parts, ",") + "]"
	case map[string]Value:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			parts = append(parts, jsonString(key)+":"+ToJSON(v[key]))
		}
		return "{" + strings.Join(parts, ",") + "}"
	}
	return "null"
}

func jsonString(value string) string {
	var out strings.Builder
	out.WriteByte('"')
	for _, char := range value {
		switch char {
		case '"':
			out.WriteString(`\"`)
		case '\\':
			out.WriteString(`\\`)
		case '\n':
			out.WriteString(`\n`)
		case '\r':
			out.WriteString(`\r`)
		case '\t':
			out.WriteString(`\t`)
		case '\b':
			out.WriteString(`\b`)
		case '\f':
			out.WriteString(`\f`)
		default:
			if char < 0x20 {
				out.WriteString(fmt.Sprintf(`\u%04x`, char))
				continue
			}
			out.WriteRune(char)
		}
	}
	out.WriteByte('"')
	return out.String()
}

// DatetimeToText renders an instant as RFC 3339 in UTC, with a fractional part
// only when there is one.
//
// RFC3339Nano is exactly that; the note is for the TypeScript side, where
// Date.toISOString() always writes three decimal places and has to be trimmed
// to match this.
//
// Truncated to milliseconds here rather than only in dt.parse and dt.now,
// because a Host puts instants into the Context too — time.Now() carries
// nanoseconds, and a Date cannot. Doing it at the rendering boundary is what
// makes "instants carry millisecond precision" true of every instant rather
// than only of the ones Hatua created.
func DatetimeToText(value time.Time) string {
	return value.UTC().Truncate(time.Millisecond).Format(time.RFC3339Nano)
}

// NumberToText is the ECMAScript Number::toString algorithm, ported.
//
// Go's own formatting disagrees with JavaScript's at both ends of the range:
// strconv gives "1e-06" where JavaScript gives "0.000001". A workflow that
// emails a number must not read differently depending on which runner sent it,
// so the JavaScript spelling wins and this is what makes Go produce it.
//
// The shortest round-trip digits come from strconv with precision -1, which is
// exactly the "k as small as possible" the specification asks for.
func NumberToText(value float64) string {
	if math.IsNaN(value) {
		return "NaN"
	}
	if math.IsInf(value, 1) {
		return "Infinity"
	}
	if math.IsInf(value, -1) {
		return "-Infinity"
	}
	if value == 0 {
		// Covers -0, which JavaScript renders as "0".
		return "0"
	}
	if value < 0 {
		return "-" + NumberToText(-value)
	}

	// `d.dddde±dd` — the mantissa digits are s, and the exponent is n-1.
	scientific := strconv.FormatFloat(value, 'e', -1, 64)
	mantissa, exponent, _ := strings.Cut(scientific, "e")
	digits := strings.Replace(mantissa, ".", "", 1)
	power, err := strconv.Atoi(exponent)
	if err != nil {
		return scientific
	}

	k := len(digits)
	n := power + 1

	switch {
	case k <= n && n <= 21:
		return digits + strings.Repeat("0", n-k)
	case 0 < n && n <= 21:
		return digits[:n] + "." + digits[n:]
	case -6 < n && n <= 0:
		return "0." + strings.Repeat("0", -n) + digits
	}

	sign := "+"
	e := n - 1
	if e < 0 {
		sign = "-"
		e = -e
	}
	if k == 1 {
		return digits + "e" + sign + strconv.Itoa(e)
	}
	return digits[:1] + "." + digits[1:] + "e" + sign + strconv.Itoa(e)
}
