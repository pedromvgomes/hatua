package expressions

import (
	"sort"
	"strings"
	"time"
)

// Lists.
//
// There are no lambdas in v1, so no filter and no map: closures mean
// implementing scoping and capture twice, and getting them subtly different is
// the failure this whole package exists to prevent. `[]` projection and
// core.for_each cover the common cases; nothing in the grammar blocks adding
// them later.

func listFunctions() map[string]FunctionImpl {
	return map[string]FunctionImpl{
		"list.len": func(args []Value, _ Context) Value { return float64(len(args[0].([]Value))) },

		// Nil when empty, which is the one absent value rather than an error.
		"list.first": func(args []Value, _ Context) Value {
			items := args[0].([]Value)
			if len(items) == 0 {
				return nil
			}
			return items[0]
		},

		"list.last": func(args []Value, _ Context) Value {
			items := args[0].([]Value)
			if len(items) == 0 {
				return nil
			}
			return items[len(items)-1]
		},

		"list.slice": func(args []Value, _ Context) Value {
			items := args[0].([]Value)
			from, to := sliceRange(len(items), args[1].(float64), optionalIndex(args, 2))
			return append([]Value{}, items[from:to]...)
		},

		// By the same rule as `==`: total, and never coercing.
		"list.contains": func(args []Value, _ Context) Value {
			for _, item := range args[0].([]Value) {
				if Equals(item, args[1]) {
					return true
				}
			}
			return false
		},

		"list.join": func(args []Value, _ Context) Value {
			items, separator := args[0].([]Value), args[1].(string)
			parts := make([]string, 0, len(items))
			for _, item := range items {
				if item != nil && !IsScalar(TypeOf(item)) {
					panic(badArgument("list.join", "value", "a list of "+string(TypeOf(item))))
				}
				parts = append(parts, AsText(item))
			}
			return strings.Join(parts, separator)
		},

		"list.unique": func(args []Value, _ Context) Value {
			out := []Value{}
			for _, item := range args[0].([]Value) {
				seen := false
				for _, kept := range out {
					if Equals(kept, item) {
						seen = true
						break
					}
				}
				if !seen {
					out = append(out, item)
				}
			}
			return out
		},

		// Ascending, and every element must be the same ordered type.
		//
		// A mixed list has no defensible ordering, and inventing one — nulls
		// first, numbers before text — would be a rule nobody could derive from
		// anywhere else in the language.
		"list.sort": func(args []Value, _ Context) Value {
			items := args[0].([]Value)
			if len(items) == 0 {
				return []Value{}
			}

			kind := TypeOf(items[0])
			if kind != TypeNumber && kind != TypeText && kind != TypeDatetime {
				panic(badArgument("list.sort", "value", "a list of "+string(kind)))
			}
			for _, item := range items {
				if TypeOf(item) != kind {
					panic(badArgument("list.sort", "value", "a list of mixed types"))
				}
			}

			out := append([]Value{}, items...)
			sort.SliceStable(out, func(i, j int) bool {
				switch kind {
				case TypeNumber:
					return out[i].(float64) < out[j].(float64)
				case TypeText:
					return out[i].(string) < out[j].(string)
				}
				return out[i].(time.Time).Before(out[j].(time.Time))
			})
			return out
		},
	}
}
