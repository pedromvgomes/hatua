package hatua

import (
	"fmt"
	"strings"

	"hatua.dev/go/expressions"
)

// Whether a Workflow Definition is filled in enough to run — the rules that read
// a step against its Component Manifest, the verbs Hatua interprets
// structurally, and the contract a block declares.
//
// The mirror of packages/model/src/validity.ts, rule for rule. Every code and
// what it blocks is declared in schemas/definition-diagnostics.yaml and
// generated into both languages, because `blocks` is part of the contract: a
// code that stopped Publish there and merely informed here would let a workflow
// publish from one builder and not another. conformance/definition/rules/ pins
// the pair.
//
// Nothing below walks doc.Steps. WalkDocument yields every step on every Board,
// so a rule written here covers a block's steps by construction — the
// alternative is a validator that reports nothing about three blocks, silently,
// because it only ever looked at the root.

// Diagnostic is one thing wrong with a definition.
type Diagnostic struct {
	Code    DefinitionCode
	Message string
	// Blocks says what this stops: publish never blocks editing, edit is
	// reserved for what ordinary building cannot produce.
	Blocks Blocks
	StepID string
	// TriggerID is set instead of StepID when the subject is a trigger.
	TriggerID string
	// BlockID says which Board the subject sits on, set ALONGSIDE StepID
	// because ids are Board-local. Set on its own when the subject is the block
	// itself.
	BlockID      string
	ConnectionID string
	FieldKey     string
}

// Validity is every rule's output, indexed the way a caller needs it.
type Validity struct {
	// ByStep holds diagnostics keyed by StepKey — Board and id together,
	// because a block's `ret` and another block's `ret` are two steps.
	ByStep map[string][]Diagnostic
	// ByTrigger holds the same for triggers, which are not steps.
	ByTrigger map[string][]Diagnostic
	// ByBlock holds what belongs to a block rather than to any step in it.
	ByBlock map[string][]Diagnostic
	// All is everything, in the order the rules ran. Returned rather than left
	// to a caller to flatten out of ByStep: a diagnostic about a trigger has no
	// StepID, so flattening the step map silently drops it.
	All []Diagnostic
}

// StepKey is one string naming one step, for a caller that needs a flat key.
//
// Minted here rather than concatenated at each call site, and matching the
// TypeScript `stepKey`: `/` is safe because the schema holds every id to an
// identifier, which cannot contain one.
func StepKey(board BoardID, id string) string {
	if board == RootBoard {
		return id
	}
	return board + "/" + id
}

// raise builds one diagnostic, taking Blocks from the declaration rather than
// restating it.
func raise(code DefinitionCode, subject Diagnostic, fields map[string]string) Diagnostic {
	subject.Code = code
	subject.Message = FormatDefinitionMessage(code, fields)
	subject.Blocks = DefinitionDiagnostics[code].Blocks
	return subject
}

// ValidateDefinition runs every rule over every Board.
//
// Manifests are indexed by Use. A runner holding no manifests still gets the
// structural and block rules; the two that read a manifest report nothing
// rather than guessing.
func ValidateDefinition(doc Definition, manifests []Manifest) Validity {
	byUse := make(map[string]Manifest, len(manifests))
	for _, manifest := range manifests {
		byUse[manifest.Use] = manifest
	}

	all := []Diagnostic{}
	all = append(all, UnknownComponents(doc, byUse)...)
	all = append(all, MissingRequiredFields(doc, byUse)...)
	all = append(all, MalformedContainers(doc, manifests)...)
	all = append(all, BlockRules(doc)...)

	found := Validity{
		ByStep:    map[string][]Diagnostic{},
		ByTrigger: map[string][]Diagnostic{},
		ByBlock:   map[string][]Diagnostic{},
		All:       all,
	}
	for _, d := range all {
		switch {
		case d.StepID != "":
			key := StepKey(d.BlockID, d.StepID)
			found.ByStep[key] = append(found.ByStep[key], d)
		case d.TriggerID != "":
			found.ByTrigger[d.TriggerID] = append(found.ByTrigger[d.TriggerID], d)
		case d.BlockID != "":
			found.ByBlock[d.BlockID] = append(found.ByBlock[d.BlockID], d)
		}
	}
	return found
}

// FieldVisible says whether a field is shown, and therefore whether it can be
// missing.
//
// `when: [otherKey, value]` shows a field only while another field equals a
// value. Counting a hidden field as unfilled would mark a step invalid for a
// field the user cannot see, let alone fill.
func FieldVisible(field Field, values map[string]any) bool {
	if len(field.When) < 2 {
		return true
	}
	return scalarText(values[field.When[0]]) == field.When[1]
}

// scalarText renders a value the way the TypeScript side's String(…) does, so
// the two agree about what a `when` matches.
func scalarText(value any) string {
	switch held := value.(type) {
	case nil:
		return ""
	case string:
		return held
	case bool:
		if held {
			return "true"
		}
		return "false"
	case float64:
		return strings.TrimSuffix(fmt.Sprintf("%v", held), ".0")
	default:
		return fmt.Sprintf("%v", held)
	}
}

// unfilled: empty means empty — absent, nil, or a string of nothing but
// whitespace. `false` and `0` are values.
func unfilled(value any) bool {
	switch held := value.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(held) == ""
	case []any:
		return len(held) == 0
	default:
		return false
	}
}

// MissingRequiredFields reports required fields with nothing in them.
//
// A call and a core.return are checked against a declaration rather than a
// manifest — `block.<id>`'s fields are the block's params, and a return's are
// the block's outputs. Every declaration is required: it IS the contract.
func MissingRequiredFields(doc Definition, byUse map[string]Manifest) []Diagnostic {
	out := []Diagnostic{}

	declared := func(subject Diagnostic, declarations []Declaration, values map[string]any) {
		for _, declaration := range declarations {
			if !unfilled(values[declaration.K]) {
				continue
			}
			subject.FieldKey = declaration.K
			out = append(out, raise(CodeFieldRequired, subject, map[string]string{
				"label": declaration.Label,
			}))
		}
	}

	fromManifest := func(subject Diagnostic, use string, values map[string]any) {
		manifest, held := byUse[use]
		// Unknown components are reported once, by their own rule. Guessing that
		// every field is missing would bury that one diagnostic under ten.
		if !held {
			return
		}
		for _, field := range manifest.Fields {
			if !field.Req || !FieldVisible(field, values) {
				continue
			}
			if !unfilled(values[field.K]) {
				continue
			}
			subject.FieldKey = field.K
			out = append(out, raise(CodeFieldRequired, subject, map[string]string{
				"label": field.Label,
			}))
		}
	}

	WalkDocument(doc, func(ref StepRef, step Step) {
		subject := Diagnostic{StepID: step.ID, BlockID: ref.Board}
		values := step.With

		if called, ok := BlockIDOf(step.Use); ok {
			// A call to a block nothing declares has its own rule; there is no
			// contract to hold its fields to.
			if block := BlockOf(doc, called); block != nil {
				declared(subject, block.Params, values)
			}
			return
		}

		if step.Use == ReturnVerb {
			if ref.Board != RootBoard {
				if block := BlockOf(doc, ref.Board); block != nil {
					declared(subject, block.Outputs, values)
				}
			}
			return
		}

		if step.Use == SetVarVerb {
			// Structural, for the reason a return's fields are: what a
			// core.set_var takes is a var key and a value typed by the var that
			// key names, and no manifest knows which Board a step is on. Its
			// manifest declares no fields at all, so without this a set_var with
			// nothing in it reports nothing.
			for _, field := range setVarFields {
				if !unfilled(values[field.key]) {
					continue
				}
				subject.FieldKey = field.key
				out = append(out, raise(CodeFieldRequired, subject, map[string]string{
					"label": field.label,
				}))
			}
			return
		}

		fromManifest(subject, step.Use, values)
	})

	for _, trigger := range doc.Triggers {
		fromManifest(Diagnostic{TriggerID: trigger.ID}, trigger.Use, trigger.With)
	}

	return out
}

// setVarFields is what a core.set_var takes. Labels rather than keys in the
// message, matching every other required-field diagnostic — the sentence is read
// by someone looking at a form, not at YAML.
var setVarFields = []struct{ key, label string }{
	{"key", "Variable"},
	{"value", "Value"},
}

// listReferenceOf is the path a loop's List names, when it names exactly one
// value and nothing else.
func listReferenceOf(step Step) string {
	template, ok := step.With[ForEachListField].(string)
	if !ok {
		return ""
	}
	return expressions.SourceReference(template)
}

// loopListType is the declared type of what a loop's List names.
//
// Deliberately the same read LoopElementType performs, one step short of taking
// the element: the diagnostic and the binding must agree about which lists are
// lists, and two readings of one field are two answers waiting to disagree — a
// loop reported as iterating a number while `item` resolved anyway, or the
// reverse.
func loopListType(
	doc Definition,
	board BoardID,
	step Step,
	manifests []Manifest,
) (expressions.TypeNode, bool) {
	path := listReferenceOf(step)
	if path == "" {
		return expressions.TypeNode{}, false
	}
	return TypeAtPath(ScopeFor(doc, StepRef{Board: board, ID: step.ID}, manifests, nil), path)
}

// UnknownComponents reports a step or a trigger whose verb nothing declares.
//
// The two roots fail differently, so they are two codes. A `component.*` or
// `core.*` verb nothing declares blocks editing, because building cannot produce
// it. A `block.*` verb naming nothing blocks Publish only: renaming or deleting
// a block is ordinary building.
func UnknownComponents(doc Definition, byUse map[string]Manifest) []Diagnostic {
	out := []Diagnostic{}

	WalkDocument(doc, func(ref StepRef, step Step) {
		if called, ok := BlockIDOf(step.Use); ok {
			if BlockOf(doc, called) != nil {
				return
			}
			out = append(out, raise(
				CodeBlockUnknown,
				Diagnostic{StepID: step.ID, BlockID: ref.Board},
				map[string]string{"name": called},
			))
			return
		}
		if _, held := byUse[step.Use]; held {
			return
		}
		out = append(out, raise(
			CodeComponentUnknown,
			Diagnostic{StepID: step.ID, BlockID: ref.Board},
			map[string]string{"use": step.Use},
		))
	})

	for _, trigger := range doc.Triggers {
		if _, held := byUse[trigger.Use]; held {
			continue
		}
		out = append(out, raise(
			CodeComponentUnknown,
			Diagnostic{TriggerID: trigger.ID},
			map[string]string{"use": trigger.Use},
		))
	}

	return out
}

// MalformedContainers holds the verbs Hatua interprets structurally to what
// they mean. Read from the tree rather than from a manifest, because a manifest
// cannot express them: a fork's branches and a loop's body are positions in the
// document, not fields under `with:`.
func MalformedContainers(doc Definition, manifests []Manifest) []Diagnostic {
	out := []Diagnostic{}

	WalkDocument(doc, func(ref StepRef, step Step) {
		subject := Diagnostic{StepID: step.ID, BlockID: ref.Board}

		if step.Use == ForkVerb {
			// Two codes rather than one message with a branch in it: an empty
			// fork was never configured, a one-branch fork is half-built.
			switch {
			case len(step.Branches) == 0:
				out = append(out, raise(CodeForkHasNoBranches, subject, nil))
			case len(step.Branches) < 2:
				out = append(out, raise(CodeForkNeedsTwoBranches, subject, nil))
			}

			// A condition fork is first-match-wins, so a branch with no `when`
			// before the end swallows every branch after it. The LAST branch may
			// be unconditional — that is the fallback.
			conditional := false
			for _, branch := range step.Branches {
				if branch.When != "" {
					conditional = true
				}
			}
			if conditional {
				for i, branch := range step.Branches {
					if branch.When != "" || i == len(step.Branches)-1 {
						continue
					}
					out = append(out, raise(CodeBranchUnreachableAfter, subject, map[string]string{
						"label": branch.Label,
					}))
				}
			}
		}

		// One code for both loop verbs: the mistake is the same and so is the
		// fix, and the message names neither.
		if (step.Use == ForEachVerb || step.Use == RepeatVerb) && len(step.Steps) == 0 {
			out = append(out, raise(CodeLoopHasNoBody, subject, nil))
		}

		// Read from the tree rather than from With, because that is where it
		// lives: FieldKindTypes has no mappable boolean, so a condition under
		// With would type-check as text — see RepeatSlot.
		if step.Use == RepeatVerb && strings.TrimSpace(step.Until) == "" {
			out = append(out, raise(CodeRepeatHasNoCondition, subject, nil))
		}

		// A core.try is two regions, so it is two codes.
		//
		// Not CodeLoopHasNoBody, which reads "this loop repeats nothing" — the
		// right sentence about a for_each and the wrong one about a verb that is
		// not a loop. The fork's pair settled this shape already: separate codes
		// where the missing half differs, because the sentence that helps differs
		// with it.
		if step.Use == TryVerb {
			if len(step.Steps) == 0 {
				out = append(out, raise(CodeTryHasNoBody, subject, nil))
			}
			if len(step.Handler) == 0 {
				out = append(out, raise(CodeTryHasNoHandler, subject, nil))
			}
		}

		// The rule that makes `t: item` observable.
		//
		// List is a `ref` field and FieldKindTypes maps `ref` to unknown, so the
		// ordinary Slot check accepts anything written there — which is how a loop
		// pointed at a number type-checks clean while `item` quietly resolves to
		// nothing and matches everything downstream. Only a statically-KNOWN
		// conflict is reported, matching the lattice everywhere else.
		if step.Use == ForEachVerb {
			if named, found := loopListType(doc, ref.Board, step, manifests); found &&
				named.Type != expressions.TypeList &&
				named.Type != expressions.TypeUnknown &&
				named.Type != expressions.TypeItem {
				name := listReferenceOf(step)
				if name == "" {
					name = ForEachListField
				}
				subject.FieldKey = ForEachListField
				out = append(out, raise(CodeLoopListNotAList, subject, map[string]string{
					"name":   name,
					"actual": string(named.Type),
				}))
				subject.FieldKey = ""
			}
		}

		if step.Use == SetVarVerb {
			key, named := step.With["key"].(string)
			// A missing key is CodeFieldRequired's to report. Resolving an
			// absent one against the Board would say no variable is called ""
			// which names a variable the user never wrote.
			if named && key != "" && VariableOf(doc, ref.Board, key) == nil {
				subject.FieldKey = "key"
				out = append(out, raise(CodeVarUnknown, subject, map[string]string{"name": key}))
			}
		}
	})

	return out
}

// alwaysReturns says whether a step list, read from its own root level, always
// reaches a return.
//
// A fork discharges the obligation only when EVERY branch does and the fork is
// exhaustive — a falsy `when` on the last branch, matching how
// MalformedContainers reads one.
//
// The two loop verbs answer differently, and the difference is the whole rule. A
// core.for_each never discharges it: the list may be empty and the body may
// never run. A core.repeat does, because it tests its Until AFTER the body and
// therefore always runs it once. One question — is this region guaranteed to run
// at all — which is the sibling-branch argument applied to time rather than to
// paths.
func alwaysReturns(steps []Step) bool {
	for _, step := range steps {
		if step.Use == ReturnVerb {
			return true
		}
		if step.Use == RepeatVerb {
			if alwaysReturns(step.Steps) {
				return true
			}
			continue
		}
		// A core.try discharges the obligation only when BOTH regions do.
		//
		// The body always runs, so on its own it would look like a repeat. But a
		// failure part-way through the body is exactly what a try exists to admit,
		// and that path leaves the body without finishing it and enters the handler
		// instead. So the guarantee is the conjunction: every path out of a try
		// goes through the body OR through the handler, and a region that may skip
		// its return leaves one of them open. That is the fork's all-branches
		// reasoning, asked of two regions where one of them is conditional.
		if step.Use == TryVerb {
			if alwaysReturns(step.Steps) && alwaysReturns(step.Handler) {
				return true
			}
			continue
		}
		if step.Use != ForkVerb || len(step.Branches) == 0 {
			continue
		}
		if step.Branches[len(step.Branches)-1].When != "" {
			continue
		}
		every := true
		for _, branch := range step.Branches {
			if !alwaysReturns(branch.Steps) {
				every = false
				break
			}
		}
		if every {
			return true
		}
	}
	return false
}

// stepLists yields every step list in a tree — the root, each branch's, each
// loop body's, and each core.try's handler.
//
// A region missing from here is a region CodeStepAfterReturn never looks at, so
// a step sitting after a core.return inside a handler would be reported by
// neither language and published by both.
func stepLists(steps []Step, visit func([]Step)) {
	visit(steps)
	for _, step := range steps {
		for _, branch := range step.Branches {
			stepLists(branch.Steps, visit)
		}
		stepLists(step.Steps, visit)
		stepLists(step.Handler, visit)
	}
}

// BlockRules reports what a block carries: repeated names, recursion, where a
// return may sit, and whether one is reached.
//
// Recursion is answered here rather than by a runner's depth limit because
// ADR-0013 refuses it at design time, so both builders refuse the same document
// rather than one of them discovering it in production.
func BlockRules(doc Definition) []Diagnostic {
	out := []Diagnostic{}

	declaredBlocks := map[string]bool{}
	for _, block := range doc.Blocks {
		// A call resolves to the first block under an id, so a second is
		// unreachable — and every other reader would have to agree about which
		// one `block.x` meant.
		if declaredBlocks[block.ID] {
			out = append(out, raise(
				CodeBlockIdDuplicate,
				Diagnostic{BlockID: block.ID},
				map[string]string{"name": block.ID},
			))
		}
		declaredBlocks[block.ID] = true

		for _, side := range []struct {
			name         string
			declarations []Declaration
		}{{"parameter", block.Params}, {"output", block.Outputs}} {
			named := map[string]bool{}
			for _, declaration := range side.declarations {
				if named[declaration.K] {
					out = append(out, raise(
						CodeDeclarationKeyDuplicate,
						Diagnostic{BlockID: block.ID},
						map[string]string{
							"side":  side.name,
							"block": block.ID,
							"name":  declaration.K,
						},
					))
				}
				named[declaration.K] = true
			}
		}
	}

	for _, id := range CyclicBlocks(doc) {
		out = append(out, raise(
			CodeBlockRecursion,
			Diagnostic{BlockID: id},
			map[string]string{"name": id},
		))
	}

	for _, board := range Boards(doc) {
		seen := map[string]bool{}
		WalkSteps(board.Steps, func(step Step) {
			// Ids are scoped to a Board, so two blocks may each hold a `ret`.
			// Two on ONE board make `{{steps.ret}}` name two things, which is
			// the one case a Board cannot disambiguate.
			if seen[step.ID] {
				out = append(out, raise(
					CodeStepIdDuplicate,
					Diagnostic{StepID: step.ID, BlockID: board.ID},
					map[string]string{"name": step.ID},
				))
			}
			seen[step.ID] = true

			if step.Use == ReturnVerb && board.ID == RootBoard {
				out = append(out, raise(CodeReturnOutsideBlock, Diagnostic{StepID: step.ID}, nil))
			}
		})

		stepLists(board.Steps, func(list []Step) {
			stops := -1
			for i := range list {
				if alwaysReturns(list[i : i+1]) {
					stops = i
					break
				}
			}
			if stops == -1 {
				return
			}
			for _, step := range list[stops+1:] {
				out = append(out, raise(
					CodeStepAfterReturn,
					Diagnostic{StepID: step.ID, BlockID: board.ID},
					nil,
				))
			}
		})

		// A block that declares nothing publishes nothing and needs no return:
		// blocks used for their effects alone are the ordinary case.
		if board.Block != nil && len(board.Block.Outputs) > 0 && !alwaysReturns(board.Steps) {
			out = append(out, raise(
				CodeBlockPathWithoutReturn,
				Diagnostic{BlockID: board.ID},
				map[string]string{"name": board.Block.ID},
			))
		}
	}

	return out
}
