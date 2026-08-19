package expressions

import (
	"encoding/json"
	"errors"
)

// The escape hatch for opaque payloads.
//
// json.parse returns `unknown`, which is what makes
// `json.parse(s2.output).count` a warning rather than an error at design time —
// and a run-time type check at the slot boundary instead. Rejecting it would
// make the function unusable; accepting it silently would hide a real risk.

func jsonFunctions() map[string]FunctionImpl {
	return map[string]FunctionImpl{
		"json.parse": func(args []Value, _ Context) Value {
			var decoded Value
			// encoding/json produces float64 for every number and map[string]any
			// for every object, which is exactly the value space — so nothing
			// needs converting afterwards.
			if err := json.Unmarshal([]byte(args[0].(string)), &decoded); err != nil {
				// The two failures are told apart so the message matches
				// TypeScript's. JSON.parse accepts `1e400` and yields Infinity,
				// which the TypeScript half rejects afterwards as "a number out
				// of range"; the decoder here refuses it up front, and reporting
				// that as "text that is not JSON" would be the same code with a
				// different explanation in each runtime's logs.
				var rangeErr *json.UnmarshalTypeError
				if errors.As(err, &rangeErr) {
					panic(badArgument("json.parse", "value", "a number out of range"))
				}
				panic(badArgument("json.parse", "value", "text that is not JSON"))
			}
			return decoded
		},

		// Canonical: object keys sorted, so Go and JavaScript produce one string.
		"json.stringify": func(args []Value, _ Context) Value { return ToJSON(args[0]) },
	}
}
