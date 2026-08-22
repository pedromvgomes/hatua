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
const MappingVerb = "core.map"

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
// that is the whole reason `when: "{{steps.s2.count}} > 0"` can be refused at design
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
// The walk is rooted at the step's own Board and never leaves it. A block's
// steps do not see the call site's ancestry, which is the whole reason a call is
// a cross-link with a contract and a jump is not (ADR-0013).
func UpstreamOf(doc Definition, ref StepRef) []Step {
	board := BoardOf(doc, ref.Board)
	if board == nil {
		return []Step{}
	}
	if found := collectUpstream(board.Steps, ref.ID, nil); found != nil {
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

// BoardScope is everything a Board offers with no position in its tree.
//
// Never a step's output. A variable's value has no position — it is not reached
// by running anything — so no step is guaranteed to have run by the time it is
// evaluated. Everything here is available unconditionally for the mirror-image
// reason: a workflow cannot run without a trigger firing, the Host supplies Run
// Context to every execution, a parameter is filled by the caller before the
// block starts, and a var is Board-scoped rather than positional.
//
// The two Boards offer different things, and the difference IS the contract:
//
//	                    root Board            a block's
//	run.*               Run Context           the same — the one thing that crosses
//	triggers.*/TRIGGER  the contract          absent
//	params.*            absent                the contract
//	var.*               the workflow's        the block's, rebuilt per call
//
// A block cannot read the workflow's variables or ask which trigger fired. Run
// Context is the single exception because nothing in the document declares it:
// the Host supplies it to every execution, so it is exact on every path of every
// Board with no intersection to compute.
//
// Split out because the builder needs scope without a step to ask about, and
// ScopeFor is this plus the upstream steps — one definition of the unpositioned
// half, two readers.
func BoardScope(doc Definition, board BoardID, manifests []Manifest, context []ContextKey) []expressions.ScopeEntry {
	byUse := make(map[string]Manifest, len(manifests))
	for _, manifest := range manifests {
		byUse[manifest.Use] = manifest
	}

	entries := []expressions.ScopeEntry{}

	// First, because it is the only part of scope no document declares: it is
	// there before a workflow has a trigger, a var or a step.
	for _, key := range context {
		entries = append(entries, expressions.ScopeEntry{
			Path: "run." + key.K,
			Type: contextKeyType(key),
		})
	}

	block := BlockOf(doc, board)
	if board != RootBoard && block == nil {
		return []expressions.ScopeEntry{}
	}

	if block != nil {
		for _, param := range block.Params {
			entries = append(entries, expressions.ScopeEntry{
				Path: "params." + param.K,
				Type: declarationToType(param),
			})
		}
	} else {
		for _, trigger := range doc.Triggers {
			entries = append(entries, expressions.ScopeEntry{
				Path: "triggers." + trigger.ID,
				Type: outputsToType(byUse[trigger.Use].Outputs),
			})
		}

		// Absent on a block's Board for the reason `triggers.` is: a block
		// cannot ask which trigger fired, because it cannot see the triggers at
		// all. A block that needs to know takes it as a parameter.
		if len(doc.Triggers) > 1 {
			entries = append(entries, expressions.ScopeEntry{
				Path: "TRIGGER",
				Type: expressions.TypeNode{Type: expressions.TypeText},
			})
		}
	}

	// The Board's own variables: the workflow's at the root, the block's inside
	// one. A block called twice starts clean both times, because these are
	// rebuilt per invocation rather than carried.
	vars := doc.Vars
	if block != nil {
		vars = block.Vars
	}
	for _, variable := range vars {
		entries = append(entries, expressions.ScopeEntry{
			Path: "var." + variable.Key,
			Type: expressions.TypeNode{Type: varType(variable.Value)},
		})
	}

	return entries
}

// ScopeFor is everything addressable from a step: the unpositioned scope, plus
// the upstream steps.
//
// Scope position comes from the tree; the shapes come from the manifests. The
// two are joined here because neither side owns both. Only steps are
// constrained by tree position, because only a step can fail to run.
func ScopeFor(doc Definition, ref StepRef, manifests []Manifest, context []ContextKey) []expressions.ScopeEntry {
	byUse := make(map[string]Manifest, len(manifests))
	for _, manifest := range manifests {
		byUse[manifest.Use] = manifest
	}

	entries := BoardScope(doc, ref.Board, manifests, context)

	for _, step := range UpstreamOf(doc, ref) {
		manifest := byUse[step.Use]
		entries = append(entries, expressions.ScopeEntry{
			Path: "steps." + step.ID,
			Type: stepOutputType(doc, step, manifest),
		})
	}

	return entries
}

// declarationToType turns a block's parameter or output into the shape the
// checker wants. Three lines rather than a second traversal, because a
// Declaration is spelled exactly as an Output is.
func declarationToType(declaration Declaration) expressions.TypeNode {
	node := expressions.TypeNode{Type: expressions.ValueType(declaration.T)}
	if len(declaration.Of) > 0 {
		node.Members = make(map[string]expressions.TypeNode, len(declaration.Of))
		for _, member := range declaration.Of {
			node.Members[member.K] = declarationToType(member)
		}
	}
	return node
}

// blockOutputType is what a call publishes, read where the block is declared
// rather than from a manifest. That is what makes a call type-check before its
// body is written: the declaration is the contract, and core.return only binds
// values to it.
func blockOutputType(block *Block) expressions.TypeNode {
	node := expressions.TypeNode{
		Type:    expressions.TypeObject,
		Members: map[string]expressions.TypeNode{},
	}
	if block == nil {
		return node
	}
	for _, output := range block.Outputs {
		node.Members[output.K] = declarationToType(output)
	}
	return node
}

// contextKeyType turns a Run Context key into the shape the checker wants.
//
// Three lines rather than a second traversal, because a ContextKey is spelled
// exactly as an Output is: one shape whether the value came from a component's
// outputs or from the Host's ambient values.
func contextKeyType(key ContextKey) expressions.TypeNode {
	node := expressions.TypeNode{Type: expressions.ValueType(key.T)}
	if len(key.Of) > 0 {
		members := make(map[string]expressions.TypeNode, len(key.Of))
		for _, member := range key.Of {
			members[member.K] = contextKeyType(member)
		}
		node.Members = members
	}
	return node
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
// core.map is the one component whose outputs a manifest cannot declare, because
// they are whatever the user named. It is the third verb Hatua interprets
// structurally, alongside core.fork and core.for_each — and the only one that
// does so by reading a field's value rather than its position in the tree.
func stepOutputType(doc Definition, step Step, manifest Manifest) expressions.TypeNode {
	if called, ok := BlockIDOf(step.Use); ok {
		return blockOutputType(BlockOf(doc, called))
	}
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
