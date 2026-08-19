package expressions

import (
	"math"
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
//
// These are package level despite x/text's "a Caser may be stateful and should
// therefore not be shared between goroutines", and the exception is specific
// rather than optimistic. For the root locale, cases.Upper/Lower return the
// package-level singletons undUpper/undLower, whose types are `struct{
// transform.NopResetter }` — no fields, a no-op Reset, and a context built on
// the stack per call. Building a Caser per call would hand back that same
// singleton, so it buys no isolation whatever while costing about 107ns a call;
// the only thing that would actually isolate is a mutex around a shared
// stateless value, which is worse in every direction.
//
// The warning is aimed at the locale-sensitive casers — Greek final sigma,
// Turkish dotted i — which carry context between calls. Those are exactly what
// language.Und avoids.
//
// TestCaseMappingIsSafeUnderConcurrency runs this under -race, so an x/text
// release that made the root caser stateful would not pass quietly.
var (
	upperCaser = cases.Upper(language.Und)
	lowerCaser = cases.Lower(language.Und)
)

func upperOf(value string) string { return upperCaser.String(value) }
func lowerOf(value string) string { return lowerCaser.String(value) }

// points counts and indexes by code point. Go indexes by byte and JavaScript by
// UTF-16 unit; neither is what a user means by "the first ten characters".
func points(value string) []rune { return []rune(value) }

// sliceRange is JavaScript's Array.slice semantics, spelled out so both
// languages have the same clamping and the same treatment of negative indices.
//
// The bound arrives as a float64 and is truncated *after* the negative
// adjustment, not before. There is one numeric type, so `slice(xs, -1.5)` is
// writable; truncating first turns -1.5 into -1 and shifts the window by one.
func sliceRange(length int, start float64, end *float64) (int, int) {
	from := clampIndex(start, length)
	if start < 0 {
		from = clampIndex(float64(length)+start, length)
	}
	to := length
	if end != nil {
		to = clampIndex(*end, length)
		if *end < 0 {
			to = clampIndex(float64(length)+*end, length)
		}
	}
	return from, max(from, to)
}

// clampIndex clamps *before* converting to int. Converting an out-of-range
// float64 to int is implementation-defined in Go, so `text.slice(s, 1e20)`
// returned the whole string on amd64 and the empty string on arm64 — two Go
// runners disagreeing with each other, which is worse than disagreeing with
// TypeScript.
func clampIndex(index float64, length int) int {
	if index <= 0 {
		return 0
	}
	if index >= float64(length) {
		return length
	}
	return int(math.Trunc(index))
}

// optionalIndex reads a trailing optional number argument.
func optionalIndex(args []Value, position int) *float64 {
	if len(args) <= position {
		return nil
	}
	value := args[position].(float64)
	return &value
}

func textFunctions() map[string]FunctionImpl {
	return map[string]FunctionImpl{
		"text.upper": func(args []Value, _ Context) Value { return upperOf(args[0].(string)) },
		"text.lower": func(args []Value, _ Context) Value { return lowerOf(args[0].(string)) },
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
			from, to := sliceRange(len(chars), args[1].(float64), optionalIndex(args, 2))
			return string(chars[from:to])
		},

		"text.len": func(args []Value, _ Context) Value {
			return float64(len(points(args[0].(string))))
		},
	}
}
