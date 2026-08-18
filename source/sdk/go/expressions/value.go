package expressions

import (
	"encoding/json"
	"math"
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
func TypeOf(value Value) ValueType {
	switch value.(type) {
	case nil:
		return TypeNull
	case string:
		return TypeText
	case float64:
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
		return v.UTC().Format(time.RFC3339Nano)
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(encoded)
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
