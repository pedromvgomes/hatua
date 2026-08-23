package hatua

import (
	"testing"

	"hatua.dev/go/expressions"
)

// core.repeat and core.set_var, on the side the rules corpus cannot reach.
//
// The corpus compares diagnostics; these follow the other half — what a Slot
// expects and what the checker then says about it. That is where the type
// marking lives, and it is the whole reason a var's type is declared: a
// core.set_var writing a number into a var the builder marked `text` would make
// every downstream check an answer to the wrong question.
//
// packages/model/src/loops.test.ts mirrors these assertion for assertion.

func setVarStep(with map[string]any) Step {
	return Step{ID: "bump", Use: SetVarVerb, With: with}
}

func TestRepeatConditionIsBoolean(t *testing.T) {
	slot := RepeatSlot("{{ var.done }}")
	if slot.Name != "until" || slot.ExpectedType != expressions.TypeBoolean {
		t.Fatalf("expected a boolean `until` slot, got %+v", slot)
	}
}

func TestRepeatConditionRefusesACount(t *testing.T) {
	doc := Definition{
		Vars:  []Variable{{Key: "seen", T: "number", Value: 0}},
		Steps: []Step{{ID: "again", Use: RepeatVerb, Until: "{{ var.seen }}"}},
	}
	ctx := expressions.CheckContext{
		Scope:     ScopeFor(doc, StepRef{Board: RootBoard, ID: "again"}, nil, nil),
		Functions: expressions.CoreFunctions(),
	}

	if found := expressions.Validate("{{ var.seen }}", expressions.TypeBoolean, ctx); len(found) == 0 {
		t.Fatalf("expected a count to be refused where a condition belongs")
	}
	if found := expressions.Validate("{{ var.seen > 3 }}", expressions.TypeBoolean, ctx); len(found) != 0 {
		t.Fatalf("expected a comparison to pass, got %v", found)
	}
}

func TestSetVarSlotIsTypedByTheVariableItNames(t *testing.T) {
	doc := Definition{
		Vars:  []Variable{{Key: "attempt", T: "number", Value: 0}},
		Steps: []Step{setVarStep(map[string]any{"key": "attempt", "value": "{{ 1 + 1 }}"})},
	}

	slot, ok := SetVarSlot(doc, RootBoard, doc.Steps[0])
	if !ok {
		t.Fatalf("expected a slot")
	}
	if slot.Name != "value" || slot.ExpectedType != expressions.TypeNumber {
		t.Fatalf("expected a number `value` slot, got %+v", slot)
	}
}

func TestSetVarSlotIsAbsentWithoutAVariableToTypeIt(t *testing.T) {
	doc := Definition{Vars: []Variable{{Key: "attempt", T: "number", Value: 0}}}

	cases := map[string]map[string]any{
		"a key no board declares": {"key": "attemp", "value": "1"},
		"no key at all":           {"value": "1"},
		"a literal value":         {"key": "attempt", "value": 7},
	}
	for name, with := range cases {
		if _, ok := SetVarSlot(doc, RootBoard, setVarStep(with)); ok {
			t.Fatalf("%s: expected no slot", name)
		}
	}
}

// The end of the argument, from the document to a verdict. A var declared
// `boolean` refuses a number written into it, and the same document with
// `t: number` accepts it — so the marking the builder shows and the value the
// runner produces cannot disagree.
func TestSetVarIsHeldToTheDeclaredType(t *testing.T) {
	refused := Definition{
		Vars:  []Variable{{Key: "attempt", T: "boolean", Value: false}},
		Steps: []Step{setVarStep(map[string]any{"key": "attempt", "value": "{{ 1 + 1 }}"})},
	}
	slot, ok := SetVarSlot(refused, RootBoard, refused.Steps[0])
	if !ok {
		t.Fatalf("expected a slot")
	}
	found := expressions.Validate(slot.Template, slot.ExpectedType, expressions.CheckContext{
		Scope:     ScopeFor(refused, StepRef{Board: RootBoard, ID: "bump"}, nil, nil),
		Functions: expressions.CoreFunctions(),
	})
	if len(found) != 1 || found[0].Code != "EXPR_TYPE_MISMATCH" {
		t.Fatalf("expected one EXPR_TYPE_MISMATCH, got %v", found)
	}

	accepted := Definition{
		Vars:  []Variable{{Key: "attempt", T: "number", Value: 0}},
		Steps: []Step{setVarStep(map[string]any{"key": "attempt", "value": "{{ 1 + 1 }}"})},
	}
	slot, _ = SetVarSlot(accepted, RootBoard, accepted.Steps[0])
	found = expressions.Validate(slot.Template, slot.ExpectedType, expressions.CheckContext{
		Scope:     ScopeFor(accepted, StepRef{Board: RootBoard, ID: "bump"}, nil, nil),
		Functions: expressions.CoreFunctions(),
	})
	if len(found) != 0 {
		t.Fatalf("expected the declared type to accept it, got %v", found)
	}
}

// A var declared on the wrong Board is out of reach rather than resolved
// differently, which is what makes core.set_var Board-scoped by construction
// rather than by a rule.
func TestSetVarInsideABlockCannotReachTheWorkflowsVariables(t *testing.T) {
	doc := Definition{
		Vars: []Variable{{Key: "attempt", T: "number", Value: 0}},
		Blocks: []Block{{
			ID:    "ask",
			Vars:  []Variable{{Key: "note", T: "text", Value: ""}},
			Steps: []Step{setVarStep(map[string]any{"key": "attempt", "value": "{{ 1 + 1 }}"})},
		}},
	}

	if _, ok := SetVarSlot(doc, "ask", doc.Blocks[0].Steps[0]); ok {
		t.Fatalf("expected the workflow's variable to be out of reach from inside a block")
	}
}

func TestVariableTypeComesFromItsDeclaration(t *testing.T) {
	if got := variableType(Variable{Key: "a", T: "number", Value: "not a number"}); got != expressions.TypeNumber {
		t.Fatalf("expected number, got %v", got)
	}
	// Nothing declares one, so nothing is guessed from the value beside it.
	if got := variableType(Variable{Key: "a", Value: 7}); got != expressions.TypeUnknown {
		t.Fatalf("expected unknown, got %v", got)
	}
}

func TestVariableSlotChecksTheInitialValue(t *testing.T) {
	slot, ok := VariableSlot(Variable{Key: "attempt", T: "number", Value: "{{ 1 + 1 }}"})
	if !ok || slot.Name != "attempt" || slot.ExpectedType != expressions.TypeNumber {
		t.Fatalf("expected a number slot named attempt, got %+v (%v)", slot, ok)
	}
	// A literal is not a Template, so there is no Slot and nothing to check.
	if _, ok := VariableSlot(Variable{Key: "attempt", T: "number", Value: 0}); ok {
		t.Fatalf("expected no slot for a literal")
	}
}

func TestVariableOfShapesAMemberRead(t *testing.T) {
	doc := Definition{
		Vars: []Variable{{
			Key:   "entry",
			T:     "object",
			Of:    []Declaration{{K: "headline", Label: "Headline", T: "text"}},
			Value: "",
		}},
		Steps: []Step{{ID: "s1", Use: "component.email.send"}},
	}
	ctx := expressions.CheckContext{
		Scope:     ScopeFor(doc, StepRef{Board: RootBoard, ID: "s1"}, nil, nil),
		Functions: expressions.CoreFunctions(),
	}

	if found := expressions.Validate("{{ var.entry.headline }}", expressions.TypeText, ctx); len(found) != 0 {
		t.Fatalf("expected a declared member to resolve, got %v", found)
	}
	if found := expressions.Validate("{{ var.entry.headline }}", expressions.TypeNumber, ctx); len(found) == 0 {
		t.Fatalf("expected a text member to be refused where a number belongs")
	}
}

// A variable's declared type is held to the same set a block's declarations are.
//
// The loader is a layer above the rules corpus — that corpus calls
// ValidateDefinition directly and never reaches Validate() — so a type the
// loader accepts and the JSON Schema refuses is a document this SDK loads and
// the builder will not open. `unknown` and `item` are the sharp cases: the
// checker treats both as matching everything, so accepting one switches the type
// gate off for that variable while the builder still draws a marking beside it.
func TestVariableTypeIsHeldToTheDeclaredSet(t *testing.T) {
	document := func(declared string) string {
		return "id: wf\nname: W\nversion: 1\nstatus: draft\n" +
			"vars:\n  - { key: attempt, t: " + declared + ", value: 0 }\nsteps: []\n"
	}

	for _, declared := range []string{"unknown", "item", "Text", "str", ""} {
		if _, err := LoadDefinition([]byte(document(declared))); err == nil {
			t.Fatalf("expected t: %q to be refused", declared)
		}
	}

	for _, declared := range []string{"text", "number", "boolean", "datetime", "object", "list"} {
		if _, err := LoadDefinition([]byte(document(declared))); err != nil {
			t.Fatalf("expected t: %q to load, got: %v", declared, err)
		}
	}
}

// A variable's `of` carries the same nested shape a declaration's does, so its
// members are held to the same contract rather than to none.
func TestVariableMembersAreHeldToTheSameContract(t *testing.T) {
	const bad = `id: wf
name: W
version: 1
status: draft
vars:
  - key: entry
    t: object
    of:
      - { k: headline, label: Headline, t: nonsense }
    value: ""
steps: []
`
	if _, err := LoadDefinition([]byte(bad)); err == nil {
		t.Fatalf("expected a member declaring an unusable type to be refused")
	}

	const missingLabel = `id: wf
name: W
version: 1
status: draft
vars:
  - key: entry
    t: object
    of:
      - { k: headline, t: text }
    value: ""
steps: []
`
	if _, err := LoadDefinition([]byte(missingLabel)); err == nil {
		t.Fatalf("expected a member with no label to be refused")
	}

	const good = `id: wf
name: W
version: 1
status: draft
vars:
  - key: entry
    t: object
    of:
      - { k: headline, label: Headline, t: text }
    value: ""
steps: []
`
	if _, err := LoadDefinition([]byte(good)); err != nil {
		t.Fatalf("expected a well-formed member to load, got: %v", err)
	}
}
