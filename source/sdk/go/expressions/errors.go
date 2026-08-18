package expressions

import (
	"regexp"
	"strings"
)

// Diagnostics and the one error type.
//
// The SDK reports; the Host disposes. An evaluation failure yields a typed
// error carrying a stable code, the slot it happened in and the offset inside
// that slot's Template. Hatua never decides whether a step fails, whether the
// run aborts, or whether the value should quietly become empty — those are the
// Host's calls, and it can only make them if it is told exactly what happened.

// Diagnostic is one problem, at design time or run time.
type Diagnostic struct {
	Code Code
	// Severity: an error blocks Publish, a warning blocks nothing.
	Severity Severity
	// At is the offset of the failing construct within the Template.
	At int
	// Slot is the slot this Template was being resolved into, when there is one.
	Slot    string
	Message string
}

var messageHole = regexp.MustCompile(`\{([a-z_]+)\}`)

// FormatMessage fills a {name} template.
//
// Hand-rolled rather than fmt so the TypeScript half produces byte-identical
// output: a message that reads one way in the builder and another in a runner's
// logs is a support ticket nobody can close.
func FormatMessage(template string, args map[string]string) string {
	return messageHole.ReplaceAllStringFunc(template, func(whole string) string {
		if value, ok := args[whole[1:len(whole)-1]]; ok {
			return value
		}
		return whole
	})
}

// NewDiagnostic builds one from its declared code.
func NewDiagnostic(code Code, at int, args map[string]string) Diagnostic {
	spec := Diagnostics[code]
	return Diagnostic{
		Code:     code,
		Severity: spec.Severity,
		At:       at,
		Message:  FormatMessage(spec.Message, args),
	}
}

// InSlot returns a copy naming the slot it happened in.
func (d Diagnostic) InSlot(slot string) Diagnostic {
	d.Slot = slot
	return d
}

// Error is what Resolve and ResolveAll return.
//
// It carries a list, not a single failure: ResolveAll does a whole `with:` map
// in one call and reports every failure together rather than stopping at the
// first, because a user fixing one field at a time is a user running the
// workflow five times to find five mistakes.
type Error struct {
	Diagnostics []Diagnostic
}

func (e *Error) Error() string {
	parts := make([]string, 0, len(e.Diagnostics))
	for _, d := range e.Diagnostics {
		parts = append(parts, d.Message)
	}
	return strings.Join(parts, "; ")
}

// Code reports the first failure's code. The common case is exactly one.
func (e *Error) Code() Code {
	if len(e.Diagnostics) == 0 {
		return ""
	}
	return e.Diagnostics[0].Code
}

func newError(diagnostics ...Diagnostic) *Error {
	return &Error{Diagnostics: diagnostics}
}

// ErrorsIn keeps only the diagnostics that block Publish.
func ErrorsIn(diagnostics []Diagnostic) []Diagnostic {
	out := make([]Diagnostic, 0, len(diagnostics))
	for _, d := range diagnostics {
		if d.Severity == SeverityError {
			out = append(out, d)
		}
	}
	return out
}

// BlocksPublish reports whether a set of diagnostics blocks Publish. Warnings
// never do.
func BlocksPublish(diagnostics []Diagnostic) bool {
	for _, d := range diagnostics {
		if d.Severity == SeverityError {
			return true
		}
	}
	return false
}
