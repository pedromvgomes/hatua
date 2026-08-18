package expressions

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

// Numbers. There is one numeric type and it is a 64-bit float, so nothing here
// has an integer path to disagree about.

// numberLiteral is what num.parse accepts. Deliberately the same shape the
// grammar accepts, and deliberately narrower than strconv.ParseFloat, which
// takes "Inf", "0x1p-2" and a leading "+".
var numberLiteral = regexp.MustCompile(`^-?\d+(\.\d+)?([eE][+-]?\d+)?$`)

func numFunctions() map[string]FunctionImpl {
	return map[string]FunctionImpl{
		// math.Round is already half away from zero. JavaScript's Math.round is
		// not — it rounds halves toward positive infinity, so Math.round(-0.5)
		// is -0 there — which is why the TypeScript half hand-implements this
		// one and Go leaves it alone.
		"num.round": func(args []Value, _ Context) Value { return math.Round(args[0].(float64)) },
		"num.floor": func(args []Value, _ Context) Value { return math.Floor(args[0].(float64)) },
		"num.ceil":  func(args []Value, _ Context) Value { return math.Ceil(args[0].(float64)) },
		"num.abs":   func(args []Value, _ Context) Value { return math.Abs(args[0].(float64)) },

		"num.min": func(args []Value, _ Context) Value {
			smallest := args[0].(float64)
			for _, arg := range args[1:] {
				smallest = math.Min(smallest, arg.(float64))
			}
			return smallest
		},

		"num.max": func(args []Value, _ Context) Value {
			largest := args[0].(float64)
			for _, arg := range args[1:] {
				largest = math.Max(largest, arg.(float64))
			}
			return largest
		},

		// The only text-to-number conversion there is; none is implicit.
		"num.parse": func(args []Value, _ Context) Value {
			text := strings.TrimSpace(args[0].(string))
			if !numberLiteral.MatchString(text) {
				panic(badArgument("num.parse", "value", text))
			}
			parsed, err := strconv.ParseFloat(text, 64)
			if err != nil {
				panic(badArgument("num.parse", "value", text))
			}
			return parsed
		},
	}
}
