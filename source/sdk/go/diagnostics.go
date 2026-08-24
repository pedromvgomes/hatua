package hatua

import (
	"regexp"
	"strings"
)

// Filling a declared diagnostic's message.
//
// The generated table carries templates — "{label} is required." — because the
// text a user reads has to be identical in the builder and in a runner's logs.
// Something has to fill the holes, and a Host reading Message itself would get
// the literal braces.

var messageHole = regexp.MustCompile(`\{(\w+)\}`)

// FormatDefinitionMessage fills a declared message's {name} holes from the
// fields a diagnostic carries.
//
// A hole with no field keeps its braces rather than becoming empty: a sentence
// missing a word reads as a bug in Hatua, and one still holding {label} reads as
// a diagnostic raised without the field it names — which is what it is.
func FormatDefinitionMessage(code DefinitionCode, fields map[string]string) string {
	spec, declared := DefinitionDiagnostics[code]
	if !declared {
		return ""
	}
	return messageHole.ReplaceAllStringFunc(spec.Message, func(hole string) string {
		name := strings.Trim(hole, "{}")
		if value, held := fields[name]; held {
			return value
		}
		return hole
	})
}
