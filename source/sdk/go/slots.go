package hatua

import (
	"strings"
	"time"

	"hatua.dev/go/expressions"
)

// The bridge between a Component Manifest and the expression language.
//
// hatua.dev/go/expressions deliberately knows nothing about manifests: it takes
// a Slot and a []ScopeEntry as arguments. The cost is that something has to turn
// a step and its manifest into those arguments, and this is it — once per
// language, so a runner never restates the field-kind to type mapping and
// cannot get it subtly different from the builder.
//
// The TypeScript half is packages/model/src/slots.ts and scope.ts.

// MappingVerb is the component whose outputs come from its own configuration.
const MappingVerb = "data.map"

// FieldKindTypes says what each mappable field kind's value must produce. The
// kinds absent from it hold literal values, not Templates.
//
// `mono` and `textarea` are text that renders differently. `ref` is `unknown` on
// purpose: a ref field holds whatever it points at, and the check belongs at the
// far end rather than here. `map` has no single type at all — each of its
// entries declares its own.
var FieldKindTypes = map[string]expressions.ValueType{
	"text":     expressions.TypeText,
	"mono":     expressions.TypeText,
	"textarea": expressions.TypeText,
	"number":   expressions.TypeNumber,
	"ref":      expressions.TypeUnknown,
	"map":      expressions.TypeUnknown,
}

// MapEntry is one entry of a `map` field: a name, a Template, and the type it
// must produce.
type MapEntry struct {
	Key   string
	Value string
	Type  expressions.ValueType
}

// SlotsFor is the Slots a step's `with:` map resolves into.
//
// A `map` field contributes one Slot per entry, named `<field>.<key>`, because
// each entry is separately typed and separately wrong.
func SlotsFor(step Step, manifest Manifest) []expressions.Slot {
	slots := []expressions.Slot{}

	for _, field := range manifest.Fields {
		declared, mappable := FieldKindTypes[field.Kind]
		if !mappable {
			continue
		}

		value := step.With[field.K]

		if field.Kind == "map" {
			for _, entry := range MapEntries(value) {
				slots = append(slots, expressions.Slot{
					Name:         field.K + "." + entry.Key,
					Template:     entry.Value,
					ExpectedType: entry.Type,
				})
			}
			continue
		}

		template, ok := value.(string)
		if !ok {
			continue
		}
		slots = append(slots, expressions.Slot{
			Name: field.K, Template: template, ExpectedType: declared,
		})
	}

	return slots
}

// WhenSlot is the Slot a branch's condition resolves into.
//
// Separate from SlotsFor because a branch is not a step and has no manifest —
// and because its type is not declared anywhere: a condition is a boolean, and
// that is the whole reason `when: "{{s2.count}} > 0"` can be refused at design
// time rather than misread at run time.
func WhenSlot(when string) expressions.Slot {
	return expressions.Slot{Name: "when", Template: when, ExpectedType: expressions.TypeBoolean}
}

// MapEntries reads the `{key, value, type}` entries of a `map` field, ignoring
// anything malformed.
func MapEntries(value any) []MapEntry {
	items, ok := value.([]any)
	if !ok {
		return nil
	}

	entries := make([]MapEntry, 0, len(items))
	for _, item := range items {
		fields, ok := item.(map[string]any)
		if !ok {
			continue
		}
		key, keyOK := fields["key"].(string)
		template, valueOK := fields["value"].(string)
		declared, typeOK := fields["type"].(string)
		if !keyOK || !valueOK || !typeOK {
			continue
		}
		entries = append(entries, MapEntry{
			Key: key, Value: template, Type: expressions.ValueType(declared),
		})
	}
	return entries
}

// UpstreamOf reports the steps a given step may reference: its ancestors and the
// earlier siblings of every ancestor. Sibling branches are deliberately out of
// scope, so a user cannot express a mapping that could not resolve at run time.
func UpstreamOf(doc Definition, id string) []Step {
	if found := collectUpstream(doc.Steps, id, nil); found != nil {
		return found
	}
	return []Step{}
}

func collectUpstream(steps []Step, id string, ancestors []Step) []Step {
	var earlier []Step

	for _, step := range steps {
		if step.ID == id {
			return append(append([]Step{}, ancestors...), earlier...)
		}

		seen := append(append(append([]Step{}, ancestors...), earlier...), step)
		for _, branch := range step.Branches {
			if found := collectUpstream(branch.Steps, id, seen); found != nil {
				return found
			}
		}
		if found := collectUpstream(step.Steps, id, seen); found != nil {
			return found
		}
		earlier = append(earlier, step)
	}
	return nil
}

// ScopeFor is everything addressable from a step, with the shape of each thing.
//
// Scope position comes from the tree; the shapes come from the manifests. The
// two are joined here because neither side owns both.
func ScopeFor(doc Definition, stepID string, manifests []Manifest) []expressions.ScopeEntry {
	byUse := make(map[string]Manifest, len(manifests))
	for _, manifest := range manifests {
		byUse[manifest.Use] = manifest
	}

	entries := []expressions.ScopeEntry{}

	// Triggers and vars are in scope everywhere: a workflow cannot run without a
	// trigger firing, and vars are workflow-scoped rather than positional. Only
	// steps are constrained by tree position, because only a step can fail to run.
	for _, trigger := range doc.Triggers {
		entries = append(entries, expressions.ScopeEntry{
			Path: "triggers." + trigger.ID,
			Type: outputsToType(byUse[trigger.Use].Outputs),
		})
	}

	if len(doc.Triggers) > 1 {
		entries = append(entries, expressions.ScopeEntry{
			Path: "TRIGGER",
			Type: expressions.TypeNode{Type: expressions.TypeText},
		})
	}

	for _, variable := range doc.Vars {
		entries = append(entries, expressions.ScopeEntry{
			Path: "var." + variable.Key,
			Type: expressions.TypeNode{Type: varType(variable.Value)},
		})
	}

	for _, step := range UpstreamOf(doc, stepID) {
		manifest := byUse[step.Use]
		entries = append(entries, expressions.ScopeEntry{
			Path: step.ID,
			Type: stepOutputType(step, manifest),
		})
	}

	return entries
}

// varType reads a workflow variable's type from its literal value.
//
// Vars are the one addressable thing with no declaration to consult, and calling
// them all unknown would make every `{{ var.x }}` in a workflow warn — which
// trains people to ignore warnings. A var holding text is text. A var holding a
// Template is genuinely unknown until it is evaluated, and says so.
func varType(value any) expressions.ValueType {
	switch v := value.(type) {
	case string:
		if strings.Contains(v, "{{") {
			return expressions.TypeUnknown
		}
		return expressions.TypeText
	case float64, float32, int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64:
		return expressions.TypeNumber
	case bool:
		return expressions.TypeBoolean
	case []any:
		return expressions.TypeList
	case time.Time:
		// Text, not datetime, and the reason is the decoders rather than the
		// language: yaml.v3 turns `value: 2024-01-01T00:00:00Z` into a
		// time.Time, and the `yaml` package the builder uses leaves it a string.
		// Typing it `datetime` here would block a publish in the Go SDK that the
		// builder allows, over one scalar neither of them was told the type of.
		return expressions.TypeText
	}
	return expressions.TypeUnknown
}

// stepOutputType reports a step's outputs as a type.
//
// data.map is the one component whose outputs a manifest cannot declare, because
// they are whatever the user named. It is the third verb Hatua interprets
// structurally, alongside core.fork and core.for_each — and the only one that
// does so by reading a field's value rather than its position in the tree.
func stepOutputType(step Step, manifest Manifest) expressions.TypeNode {
	if step.Use == MappingVerb {
		members := map[string]expressions.TypeNode{}
		for _, entry := range MapEntries(step.With["entries"]) {
			members[entry.Key] = expressions.TypeNode{Type: entry.Type}
		}
		return expressions.TypeNode{Type: expressions.TypeObject, Members: members}
	}
	return outputsToType(manifest.Outputs)
}

// outputsToType turns a manifest's list of {k, t, of} into the tree the checker
// wants.
func outputsToType(outputs []Output) expressions.TypeNode {
	members := map[string]expressions.TypeNode{}
	for _, output := range outputs {
		members[output.K] = outputToType(output)
	}
	return expressions.TypeNode{Type: expressions.TypeObject, Members: members}
}

func outputToType(output Output) expressions.TypeNode {
	node := expressions.TypeNode{Type: expressions.ValueType(output.T)}
	// `of:` describes an object's members, or the fields of each list element —
	// one shape for both, which is exactly what a TypeNode carries.
	if len(output.Of) > 0 {
		node.Members = outputsToType(output.Of).Members
	}
	return node
}
