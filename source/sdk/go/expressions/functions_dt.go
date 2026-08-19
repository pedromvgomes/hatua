package expressions

import (
	"math"
	"regexp"
	"time"
)

// Instants. RFC 3339 only — there are no free-form format strings in v1,
// because a format string is a second language to keep two implementations
// agreeing on, and nothing so far needs one.

// Instants carry millisecond precision, which is what a JavaScript Date can
// hold. Truncating here rather than keeping nanoseconds Go could print and
// TypeScript could not is what makes the two agree.
const datetimePrecision = time.Millisecond

// The range a JavaScript Date can represent: ±100,000,000 days from the epoch.
// Beyond it a Date is `Invalid Date`, so an instant Go could hold and TypeScript
// could not is refused rather than silently produced.
const maxInstantMillis = 8.64e15

// rfc3339 is the same shape TypeScript has to be told explicitly, because
// Date.parse there accepts a great deal more than this.
var rfc3339 = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$`)

var datetimeUnits = map[string]time.Duration{
	"seconds": time.Second,
	"minutes": time.Minute,
	"hours":   time.Hour,
	"days":    24 * time.Hour,
}

// normalizeSeparators uppercases RFC 3339's date/time separator and its Zulu
// marker, the two places the specification allows either case.
func normalizeSeparators(text string) string {
	out := []byte(text)
	for i, b := range out {
		if (b == 't' || b == 'z') && i > 0 {
			out[i] = b - ('a' - 'A')
		}
	}
	return string(out)
}

func unitFactor(name, qualified string) time.Duration {
	factor, ok := datetimeUnits[name]
	if !ok {
		panic(badArgument(qualified, "unit", name))
	}
	return factor
}

func dtFunctions() map[string]FunctionImpl {
	return map[string]FunctionImpl{
		// The clock is supplied by the caller and never read from the system. A
		// system clock makes dt.now() unfixturable, and worse, lets two steps in
		// one run disagree about when "now" was.
		"dt.now": func(_ []Value, ctx Context) Value {
			if ctx.Now == nil {
				panic(badArgument("dt.now", "clock", "no clock in the context"))
			}
			return ctx.Now.UTC().Truncate(datetimePrecision)
		},

		"dt.parse": func(args []Value, _ Context) Value {
			text := args[0].(string)
			if !rfc3339.MatchString(text) {
				panic(badArgument("dt.parse", "value", text))
			}
			// RFC 3339 permits a lowercase `t` and `z`, and the shared regex
			// accepts them; time.Parse does not, while Date.parse does. Upper-
			// casing the two separators is what makes the pair agree.
			parsed, err := time.Parse(time.RFC3339, normalizeSeparators(text))
			if err != nil {
				panic(badArgument("dt.parse", "value", text))
			}
			return parsed.UTC().Truncate(datetimePrecision)
		},

		"dt.iso": func(args []Value, _ Context) Value {
			return DatetimeToText(args[0].(time.Time))
		},

		// Shifted in milliseconds through UnixMilli rather than by adding a
		// Duration. A Duration is int64 nanoseconds and saturates at about 292
		// years, so `dt.add(…, 120000, 'days')` wrapped to the year 1763 while
		// TypeScript returned 2348.
		"dt.add": func(args []Value, _ Context) Value {
			value, amount, unit := args[0].(time.Time), args[1].(float64), args[2].(string)
			factor := unitFactor(unit, "dt.add")
			shift := math.Round(amount * float64(factor/time.Millisecond))
			shifted := float64(value.UnixMilli()) + shift
			if math.IsInf(shifted, 0) || math.IsNaN(shifted) || math.Abs(shifted) > maxInstantMillis {
				panic(badArgument("dt.add", "amount", NumberToText(amount)))
			}
			return time.UnixMilli(int64(shifted)).UTC()
		},

		// Whole units, truncated toward zero — never rounded, in either language.
		//
		// Subtracted as milliseconds rather than as a Duration: Sub saturates at
		// roughly ±292 years, so two instants further apart than that would
		// silently return a clamped number while TypeScript returned the real
		// one. Milliseconds also match the precision the value space declares.
		"dt.diff": func(args []Value, _ Context) Value {
			a, b, unit := args[0].(time.Time), args[1].(time.Time), args[2].(string)
			factor := unitFactor(unit, "dt.diff")
			elapsed := float64(a.UnixMilli() - b.UnixMilli())
			return math.Trunc(elapsed / float64(factor/time.Millisecond))
		},
	}
}
