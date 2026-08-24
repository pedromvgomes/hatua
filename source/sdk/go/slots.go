package hatua

import (
	"strings"

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

// CallSlots is the Slots a call's `with:` map resolves into: one per declared
// parameter, typed by the declaration.
//
// Separate from SlotsFor because a call has no manifest — `block.<id>` names a
// block in this document, and its parameters are the contract that block
// declares. A runner that only asked SlotsFor would evaluate nothing at a call
// site at all.
func CallSlots(step Step, block Block) []expressions.Slot {
	return declaredSlots(block.Params, step)
}

// ReturnSlots is the Slots a core.return's `with:` map resolves into: one per
// declared output of the block it sits on.
//
// The mirror of core.map. A mapping's outputs come from its own field values
// because no manifest can declare them; a return's inputs come from the
// enclosing block's outputs for the same reason — no manifest knows which board
// a step is on.
func ReturnSlots(step Step, block Block) []expressions.Slot {
	return declaredSlots(block.Outputs, step)
}

func declaredSlots(declarations []Declaration, step Step) []expressions.Slot {
	slots := []expressions.Slot{}
	for _, declaration := range declarations {
		// One nobody filled in is reported as missing by its own rule; resolving
		// an absent value as a Template would name the wrong problem.
		template, ok := step.With[declaration.K].(string)
		if !ok {
			continue
		}
		slots = append(slots, expressions.Slot{
			Name:         declaration.K,
			Template:     template,
			ExpectedType: expressions.ValueType(declaration.T),
		})
	}
	return slots
}

// SlotsForStep is the Slots any step resolves into, whichever kind it is.
//
// One entry point so a runner never has to know that a call, a return and a
// core.set_var are the three verbs a manifest cannot describe.
func SlotsForStep(doc Definition, board BoardID, step Step, manifest Manifest) []expressions.Slot {
	if called, ok := BlockIDOf(step.Use); ok {
		if block := BlockOf(doc, called); block != nil {
			return CallSlots(step, *block)
		}
		return []expressions.Slot{}
	}
	if step.Use == ReturnVerb && board != RootBoard {
		if block := BlockOf(doc, board); block != nil {
			return ReturnSlots(step, *block)
		}
		return []expressions.Slot{}
	}
	if step.Use == SetVarVerb {
		if slot, ok := SetVarSlot(doc, board, step); ok {
			return []expressions.Slot{slot}
		}
		return []expressions.Slot{}
	}
	return SlotsFor(step, manifest)
}

// RepeatSlot is the Slot a core.repeat's Until resolves into.
//
// The mirror of WhenSlot, and for the same reason: a condition is a boolean, and
// no manifest field can say so — FieldKindTypes has no mappable boolean at all,
// because `bool` holds a literal rather than a Template. That is why Until is a
// structural key beside Steps rather than a field under With; under With it
// would type-check as text, so `{{steps.s2.count}}` would pass as a termination
// condition.
//
// A repeat tests this AFTER its body, so the body always runs at least once.
func RepeatSlot(until string) expressions.Slot {
	return expressions.Slot{Name: "until", Template: until, ExpectedType: expressions.TypeBoolean}
}

// SetVarSlot is the Slot a core.set_var's `value` resolves into, typed by the
// variable it names.
//
// The third verb a manifest cannot describe, alongside a call and a core.return,
// and for the same reason: what its field must produce is declared elsewhere in
// the document. Here it is the Board's vars — which is also why a core.set_var
// inside a block can only ever name that block's, since the list is read from
// the Board the step sits on and there is no second one to fall back to.
//
// Not ok when the step names no variable, or names one the Board does not
// declare: both have their own diagnostic, and resolving a Template against a
// type nothing declared would report a mismatch the user cannot act on.
func SetVarSlot(doc Definition, board BoardID, step Step) (expressions.Slot, bool) {
	key, ok := step.With["key"].(string)
	if !ok {
		return expressions.Slot{}, false
	}
	variable := VariableOf(doc, board, key)
	if variable == nil {
		return expressions.Slot{}, false
	}
	template, ok := step.With["value"].(string)
	if !ok {
		return expressions.Slot{}, false
	}
	return expressions.Slot{
		Name: "value", Template: template, ExpectedType: variableType(*variable),
	}, true
}

// VariableSlot is the Slot a variable's initial value resolves into.
//
// A var's Value may hold `{{ … }}`, and until T was declared there was nothing
// to check it against. Not ok for a literal: only a Template is a Slot.
func VariableSlot(variable Variable) (expressions.Slot, bool) {
	template, ok := variable.Value.(string)
	if !ok {
		return expressions.Slot{}, false
	}
	return expressions.Slot{
		Name: variable.Key, Template: template, ExpectedType: variableType(variable),
	}, true
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

// collectUpstream walks one Board, and treats exactly one verb as more than a
// container.
//
// A core.try has two child regions and they are SIBLINGS, so the body cannot see
// the handler and the handler cannot see the body's steps, with no code saying
// so — the same rule that keeps a fork's branches out of each other's scope. It
// is the right rule for the right reason: the body failed somewhere, and which
// of its steps completed before it did is not a fact the document holds, so
// offering them would make scope an intersection over paths.
//
// What IS special is the try step itself. It appears in the upstream list only
// for steps inside its Handler, because that is where its binding means
// something. Its body cannot read it — the body is what produces it — and
// neither can a step after the try, because whether there was a failure at all
// is decided during a run.
func collectUpstream(steps []Step, id string, ancestors []Step) []Step {
	var earlier []Step

	for _, step := range steps {
		if step.ID == id {
			return append(append([]Step{}, ancestors...), earlier...)
		}

		above := append(append([]Step{}, ancestors...), earlier...)
		// The handler is the one region the try itself is in scope for.
		inHandler := append(append([]Step{}, above...), step)
		outside := inHandler
		if step.Use == TryVerb {
			outside = above
		}

		for _, branch := range step.Branches {
			if found := collectUpstream(branch.Steps, id, outside); found != nil {
				return found
			}
		}
		if found := collectUpstream(step.Steps, id, outside); found != nil {
			return found
		}
		if found := collectUpstream(step.Handler, id, inHandler); found != nil {
			return found
		}

		if step.Use != TryVerb {
			earlier = append(earlier, step)
		}
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
	//
	// The first of any repeated key wins, the way every other lookup here
	// resolves one: nothing stops a Host assembling its list from several
	// sources, and the TypeScript half resolves a repeat the same way.
	declared := make(map[string]bool, len(context))
	for _, key := range context {
		if declared[key.K] {
			continue
		}
		declared[key.K] = true
		entries = append(entries, expressions.ScopeEntry{
			Path: "run." + key.K,
			Type: contextKeyType(key),
		})
	}

	// The root check comes FIRST: BoardID is a bare string with "" as the root,
	// so looking a block up by "" would let one whose id is empty answer for the
	// root Board — handing the root a block's params and losing its triggers.
	// The schema forbids an empty id, but this must not depend on validation
	// having run.
	var block *Block
	if board != RootBoard {
		block = BlockOf(doc, board)
		if block == nil {
			return []expressions.ScopeEntry{}
		}
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
			Type: variableToType(variable),
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
	return scopeAt(doc, ref, manifests, context, nil)
}

// scopeAt is ScopeFor plus the set of loops already being resolved.
//
// `item` is typed by reading the loop's own List field, which means typing an
// expression against the loop step's scope — so building one step's scope can
// ask for another's. The walk terminates on its own, because a step's upstream
// is always strictly earlier in the tree than the step itself and a loop can
// therefore never be its own. resolving is not that argument: it is the guard for
// a document where two steps share an id, which the schema permits into a file
// and StepIdDuplicate reports rather than refuses.
func scopeAt(
	doc Definition,
	ref StepRef,
	manifests []Manifest,
	context []ContextKey,
	resolving map[string]bool,
) []expressions.ScopeEntry {
	byUse := make(map[string]Manifest, len(manifests))
	for _, manifest := range manifests {
		byUse[manifest.Use] = manifest
	}

	// Indexed once, beside byUse, for the reason byUse is: stepOutputType asks
	// for a block on every upstream step that is a call, and a linear scan there
	// makes one ScopeFor quadratic in a document with many blocks.
	byID := make(map[string]*Block, len(doc.Blocks))
	for i := range doc.Blocks {
		if _, held := byID[doc.Blocks[i].ID]; !held {
			byID[doc.Blocks[i].ID] = &doc.Blocks[i]
		}
	}

	entries := BoardScope(doc, ref.Board, manifests, context)

	for _, step := range UpstreamOf(doc, ref) {
		manifest := byUse[step.Use]
		entries = append(entries, expressions.ScopeEntry{
			Path: "steps." + step.ID,
			Type: stepOutputType(doc, ref.Board, byID, step, manifest, manifests, context, resolving),
		})
	}

	return entries
}

// TypeAtPath is the type one path names, read out of a scope, or false when
// nothing declares it.
//
// Longest prefix first, because a scope path is dotted and is one entry rather
// than two: `steps.s2` is an entry and `steps` is not, so `steps.s2.messages` has
// to try three segments before two. The same rule validate.go walks a member
// chain by, restated for a caller that has a path and no expression — reading a
// declared type is not checking one, and reaching for the checker would mean
// manufacturing diagnostics nobody asked for in order to throw them away.
func TypeAtPath(scope []expressions.ScopeEntry, path string) (expressions.TypeNode, bool) {
	segments := strings.Split(path, ".")
	for take := len(segments); take > 0; take-- {
		head := strings.Join(segments[:take], ".")
		var node expressions.TypeNode
		found := false
		for _, entry := range scope {
			if entry.Path == head {
				node = entry.Type
				found = true
				break
			}
		}
		if !found {
			continue
		}

		for _, name := range segments[take:] {
			member, held := node.Members[name]
			if !held {
				return expressions.TypeNode{}, false
			}
			node = member
		}
		return node, true
	}
	return expressions.TypeNode{}, false
}

// LoopElementType is what one element of a core.for_each's list is, or false when
// the document does not say.
//
// This is the whole of `t: item`. The loop's List is a `ref` field, so its
// declared type is unknown and the ordinary Slot check learns nothing from it;
// the shape is one level below whatever it points at, which is exactly the `of:`
// the source output declared. False when List is missing, is not a plain
// Reference, names nothing, or names something that is not a list — and false
// means `item` stays `item`, which the checker treats as matching anything.
// Guessing `object` instead would be a shape nothing declared.
func LoopElementType(
	doc Definition,
	board BoardID,
	step Step,
	manifests []Manifest,
	context []ContextKey,
) (expressions.TypeNode, bool) {
	return loopElementType(doc, board, step, manifests, context, nil)
}

func loopElementType(
	doc Definition,
	board BoardID,
	step Step,
	manifests []Manifest,
	context []ContextKey,
	resolving map[string]bool,
) (expressions.TypeNode, bool) {
	template, ok := step.With[ForEachListField].(string)
	if !ok {
		return expressions.TypeNode{}, false
	}
	path := expressions.SourceReference(template)
	if path == "" {
		return expressions.TypeNode{}, false
	}

	key := StepKey(board, step.ID)
	if resolving[key] {
		return expressions.TypeNode{}, false
	}
	deeper := make(map[string]bool, len(resolving)+1)
	for held := range resolving {
		deeper[held] = true
	}
	deeper[key] = true

	scope := scopeAt(doc, StepRef{Board: board, ID: step.ID}, manifests, context, deeper)
	node, found := TypeAtPath(scope, path)
	if !found || node.Type != expressions.TypeList {
		return expressions.TypeNode{}, false
	}
	// A list that declared no `of:` says nothing about its elements, so there is
	// no shape to hand back. ElementOf answers object for one — the right answer
	// for a projection, where the question is what `.name` reads off this, and
	// the wrong one here: it would mark item as an object nothing declared, and
	// every scalar field it is written into would report a mismatch against a
	// shape the document never said.
	if len(node.Members) == 0 {
		return expressions.TypeNode{}, false
	}
	return expressions.ElementOf(node), true
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
		// First-wins, matching the TypeScript half. A repeated output key is a
		// document a hand-edit reaches and DECLARATION_KEY_DUPLICATE only stops
		// Publish, so both languages have to pick the same one of the two — last
		// here and first there types the same call site number in one builder
		// and text in the other.
		if _, taken := node.Members[output.K]; taken {
			continue
		}
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

// variableType reads a variable's type from its declaration.
//
// Read from T rather than from the value beside it: a var's value is only its
// FIRST value, because core.set_var writes the same variable from a step, so a
// type read off the literal in the document is a claim about one moment in an
// execution rather than about the variable (ADR-0013).
//
// A declared type is also decoder-independent, which a type read off the value
// cannot be: yaml.v3 turns `value: 2024-01-01T00:00:00Z` into a time.Time while
// the builder's parser leaves it a string, so reading the value types one scalar
// two ways and the two languages disagree about the same document.
//
// Unknown for a var carrying no T at all: the schema requires one, so this is a
// hand-edit, and refusing to check is the honest answer where guessing `text`
// would refuse a document over a type nothing declared.
func variableType(variable Variable) expressions.ValueType {
	if variable.T == "" {
		return expressions.TypeUnknown
	}
	return expressions.ValueType(variable.T)
}

// variableToType is that, plus the shape Of carries — spelled exactly as a
// declaration's Of is, so one traversal reads both.
func variableToType(variable Variable) expressions.TypeNode {
	node := expressions.TypeNode{Type: variableType(variable)}
	if len(variable.Of) > 0 {
		node.Members = make(map[string]expressions.TypeNode, len(variable.Of))
		for _, member := range variable.Of {
			node.Members[member.K] = declarationToType(member)
		}
	}
	return node
}

// stepOutputType reports a step's outputs as a type.
//
// core.map is the one component whose outputs a manifest cannot declare, because
// they are whatever the user named. It is the third verb Hatua interprets
// structurally, alongside core.fork and core.for_each — and the only one that
// does so by reading a field's value rather than its position in the tree.
func stepOutputType(
	doc Definition,
	board BoardID,
	blocks map[string]*Block,
	step Step,
	manifest Manifest,
	manifests []Manifest,
	context []ContextKey,
	resolving map[string]bool,
) expressions.TypeNode {
	if called, ok := BlockIDOf(step.Use); ok {
		return blockOutputType(blocks[called])
	}
	if step.Use == MappingVerb {
		members := map[string]expressions.TypeNode{}
		for _, entry := range MapEntries(step.With["entries"]) {
			members[entry.Key] = expressions.TypeNode{Type: entry.Type}
		}
		return expressions.TypeNode{Type: expressions.TypeObject, Members: members}
	}

	declared := outputsToType(manifest.Outputs)
	if step.Use != ForEachVerb {
		return declared
	}

	// A loop's binding, and the one output whose type is not in the manifest.
	//
	// Substituted here rather than in outputsToType because it is a property of
	// the STEP and not of the declaration: two core.for_each steps share one
	// manifest and iterate two different lists. Only a top-level output is
	// substituted — `item` nested inside another output's `of:` would be a loop's
	// element appearing as a member of something that is not the loop, which no
	// manifest can mean.
	element, resolved := loopElementType(doc, board, step, manifests, context, resolving)
	if !resolved {
		return declared
	}
	members := make(map[string]expressions.TypeNode, len(declared.Members))
	for key, node := range declared.Members {
		if node.Type == expressions.TypeItem {
			members[key] = element
			continue
		}
		members[key] = node
	}
	return expressions.TypeNode{Type: expressions.TypeObject, Members: members}
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
