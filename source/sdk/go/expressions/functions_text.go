package expressions

import (
	"strings"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

// Strings.
//
// Case mapping is full Unicode and language-neutral. `upper("ß")` is "SS" and
// `lower("İ")` is two code points — which is what ECMAScript does for free and
// what strings.ToUpper does not, since it applies only the simple mapping.
// golang.org/x/text is in this module for that and nothing else.
//
// language.Und is deliberate: a locale-sensitive mapping would make the same
// workflow produce different text depending on where its runner happens to run.
var (
	upperCaser = cases.Upper(language.Und)
	lowerCaser = cases.Lower(language.Und)
)

// points counts and indexes by code point. Go indexes by byte and JavaScript by
// UTF-16 unit; neither is what a user means by "the first ten characters".
func points(value string) []rune { return []rune(value) }

// sliceRange is JavaScript's Array.slice semantics, spelled out so both
// languages have the same clamping and the same treatment of negative indices.
func sliceRange(length, start int, end *int) (int, int) {
	from := clampIndex(start, length)
	if start < 0 {
		from = clampIndex(length+start, length)
	}
	to := length
	if end != nil {
		to = clampIndex(*end, length)
		if *end < 0 {
			to = clampIndex(length+*end, length)
		}
	}
	return from, max(from, to)
}

func clampIndex(index, length int) int {
	return min(max(index, 0), length)
}

// optionalIndex reads a trailing optional number argument.
func optionalIndex(args []Value, position int) *int {
	if len(args) <= position {
		return nil
	}
	value := int(args[position].(float64))
	return &value
}

func textFunctions() map[string]FunctionImpl {
	return map[string]FunctionImpl{
		"text.upper": func(args []Value, _ Context) Value { return upperCaser.String(args[0].(string)) },
		"text.lower": func(args []Value, _ Context) Value { return lowerCaser.String(args[0].(string)) },
		"text.trim":  func(args []Value, _ Context) Value { return strings.TrimSpace(args[0].(string)) },

		// The concatenation primitive, because `+` is numeric only.
		"text.concat": func(args []Value, _ Context) Value {
			var out strings.Builder
			for _, arg := range args {
				out.WriteString(arg.(string))
			}
			return out.String()
		},

		"text.split": func(args []Value, _ Context) Value {
			value, separator := args[0].(string), args[1].(string)
			var parts []string
			if separator == "" {
				for _, char := range points(value) {
					parts = append(parts, string(char))
				}
			} else {
				parts = strings.Split(value, separator)
			}
			out := make([]Value, 0, len(parts))
			for _, part := range parts {
				out = append(out, part)
			}
			return out
		},

		"text.join": func(args []Value, _ Context) Value {
			values, separator := args[0].([]Value), args[1].(string)
			parts := make([]string, 0, len(values))
			for _, item := range values {
				parts = append(parts, AsText(item))
			}
			return strings.Join(parts, separator)
		},

		"text.replace": func(args []Value, _ Context) Value {
			value, search, replacement := args[0].(string), args[1].(string), args[2].(string)
			if search == "" {
				return value
			}
			return strings.ReplaceAll(value, search, replacement)
		},

		"text.contains": func(args []Value, _ Context) Value {
			return strings.Contains(args[0].(string), args[1].(string))
		},

		"text.starts_with": func(args []Value, _ Context) Value {
			return strings.HasPrefix(args[0].(string), args[1].(string))
		},

		"text.ends_with": func(args []Value, _ Context) Value {
			return strings.HasSuffix(args[0].(string), args[1].(string))
		},

		"text.slice": func(args []Value, _ Context) Value {
			chars := points(args[0].(string))
			from, to := sliceRange(len(chars), int(args[1].(float64)), optionalIndex(args, 2))
			return string(chars[from:to])
		},

		"text.len": func(args []Value, _ Context) Value {
			return float64(len(points(args[0].(string))))
		},
	}
}
