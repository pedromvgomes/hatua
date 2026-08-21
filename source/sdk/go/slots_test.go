package hatua

import (
	"testing"

	"hatua.dev/go/expressions"
)

// The bridge between a manifest and the expression language. The TypeScript
// half is packages/model/src/slots.test.ts, and these check the same two places
// the mapping is easy to get wrong: a `map` field, whose value is a list of
// separately-typed entries, and data.map, whose *outputs* come from that same
// list rather than from any manifest.

var emailSend = Manifest{
	Kind: KindComponent,
	Use:  "email.send",
	Name: "Send email",
	Fields: []Field{
		{K: "connection", Label: "Mailbox", Kind: "conn"},
		{K: "to", Label: "To", Kind: "text"},
		{K: "retries", Label: "Retries", Kind: "number"},
	},
}

var mapper = Manifest{
	Kind:   KindComponent,
	Use:    "data.map",
	Name:   "Map values",
	Fields: []Field{{K: "entries", Label: "Entries", Kind: "map"}},
}

func TestSlotsForCarriesTheDeclaredType(t *testing.T) {
	step := Step{ID: "s6", Use: "email.send", With: map[string]any{
		"connection": "mailbox",
		"to":         "{{ var.digest_to }}",
		"retries":    "{{ 1 + 1 }}",
	}}

	slots := SlotsFor(step, emailSend)
	if len(slots) != 2 {
		t.Fatalf("expected two slots, got %d: %#v", len(slots), slots)
	}
	if slots[0].Name != "to" || slots[0].ExpectedType != expressions.TypeText {
		t.Fatalf("unexpected slot %#v", slots[0])
	}
	if slots[1].Name != "retries" || slots[1].ExpectedType != expressions.TypeNumber {
		t.Fatalf("unexpected slot %#v", slots[1])
	}
}

func TestSlotsForGivesEachMapEntryItsOwnType(t *testing.T) {
	step := Step{ID: "s8", Use: "data.map", With: map[string]any{
		"entries": []any{
			map[string]any{"key": "subject", "value": "{{ s2.subject }}", "type": "text"},
			map[string]any{"key": "count", "value": "{{ s2.count }}", "type": "number"},
		},
	}}

	slots := SlotsFor(step, mapper)
	if len(slots) != 2 {
		t.Fatalf("expected two slots, got %d", len(slots))
	}
	if slots[0].Name != "entries.subject" || slots[0].ExpectedType != expressions.TypeText {
		t.Fatalf("unexpected slot %#v", slots[0])
	}
	if slots[1].Name != "entries.count" || slots[1].ExpectedType != expressions.TypeNumber {
		t.Fatalf("unexpected slot %#v", slots[1])
	}
}

func TestSlotsForIgnoresAMalformedEntry(t *testing.T) {
	step := Step{ID: "s8", Use: "data.map", With: map[string]any{
		"entries": []any{map[string]any{"key": "subject"}, "nonsense"},
	}}
	if slots := SlotsFor(step, mapper); len(slots) != 0 {
		t.Fatalf("expected no slots, got %#v", slots)
	}
}

// A branch condition is boolean, which is the whole reason the legacy spelling
// can be refused at design time rather than misread at run time.
func TestWhenSlotIsBoolean(t *testing.T) {
	slot := WhenSlot("{{s2.count}} > 0")
	if slot.ExpectedType != expressions.TypeBoolean {
		t.Fatalf("expected a boolean slot, got %s", slot.ExpectedType)
	}

	doc := Definition{
		Steps: []Step{
			{ID: "s2", Use: "email.fetch"},
			{ID: "s3", Use: "core.fork"},
		},
	}
	manifests := []Manifest{{
		Kind: KindComponent, Use: "email.fetch", Name: "Fetch",
		Outputs: []Output{{K: "count", Label: "Count", T: "number"}},
	}}

	found := expressions.Validate(slot.Template, slot.ExpectedType, expressions.CheckContext{
		Scope: ScopeFor(doc, "s3", manifests, nil),
	})
	if len(found) != 1 || found[0].Code != expressions.CodeExprTypeMismatch {
		t.Fatalf("expected one EXPR_TYPE_MISMATCH, got %#v", found)
	}
	if found[0].Severity != expressions.SeverityError {
		t.Fatalf("expected it to block publish, got %s", found[0].Severity)
	}
}

func TestScopeForDerivesMappingOutputsFromTheStepItself(t *testing.T) {
	doc := Definition{
		Steps: []Step{
			{ID: "s1", Use: "data.map", With: map[string]any{
				"entries": []any{
					map[string]any{"key": "count", "value": "0", "type": "number"},
				},
			}},
			{ID: "s2", Use: "email.send"},
		},
	}

	scope := ScopeFor(doc, "s2", []Manifest{mapper}, nil)
	if len(scope) != 1 || scope[0].Path != "s1" {
		t.Fatalf("unexpected scope %#v", scope)
	}
	if scope[0].Type.Members["count"].Type != expressions.TypeNumber {
		t.Fatalf("expected count to be a number, got %#v", scope[0].Type)
	}

	// And those outputs then type-check downstream like any other step's.
	ctx := expressions.CheckContext{Scope: scope}
	if found := expressions.Validate("{{ s1.count > 0 }}", expressions.TypeBoolean, ctx); len(found) != 0 {
		t.Fatalf("expected a clean check, got %#v", found)
	}
	if found := expressions.Validate("{{ s1.count }}", expressions.TypeBoolean, ctx); len(found) != 1 {
		t.Fatalf("expected the type conflict to be caught, got %#v", found)
	}
}

func TestUpstreamOfExcludesSiblingBranches(t *testing.T) {
	doc := Definition{
		Steps: []Step{
			{ID: "s2", Use: "email.fetch"},
			{ID: "s3", Use: "core.fork", Branches: []Branch{
				{Label: "Has mail", Steps: []Step{{ID: "s4", Use: "agent.act"}}},
				{Label: "Otherwise", Steps: []Step{{ID: "s7", Use: "core.end"}}},
			}},
		},
	}

	ids := func(steps []Step) []string {
		out := make([]string, 0, len(steps))
		for _, step := range steps {
			out = append(out, step.ID)
		}
		return out
	}

	if got := ids(UpstreamOf(doc, "s7")); len(got) != 2 || got[0] != "s2" || got[1] != "s3" {
		t.Fatalf("expected [s2 s3], got %v", got)
	}
	if got := ids(UpstreamOf(doc, "s2")); len(got) != 0 {
		t.Fatalf("expected nothing upstream of the first step, got %v", got)
	}
}

// WorkflowScope is what a value with no position in the tree may read: a
// workflow variable's own value is not reached by running anything, so no step
// is guaranteed to have run by the time it is evaluated.
//
// The TypeScript half is packages/model/src/scope.test.ts. A runner and the
// builder disagreeing about what `run.` resolves to is precisely the divergence
// the SDK exists to prevent.
func TestWorkflowScopeOffersRunContextAndNoStepOutput(t *testing.T) {
	doc := Definition{
		Triggers: []Trigger{{ID: "nightly", Use: "schedule.cron"}},
		Vars:     []Variable{{Key: "digest_to", Value: "ops@example.com"}},
		Steps:    []Step{{ID: "s1", Use: "email.fetch"}, {ID: "s2", Use: "email.send"}},
	}
	context := []ContextKey{
		{K: "id", Label: "Run id", T: "text"},
		{K: "tenant", Label: "Tenant", T: "object", Of: []ContextKey{
			{K: "name", Label: "Tenant name", T: "text"},
		}},
	}

	paths := map[string]expressions.TypeNode{}
	for _, entry := range WorkflowScope(doc, nil, context) {
		paths[entry.Path] = entry.Type
	}

	for _, want := range []string{"run.id", "run.tenant", "triggers.nightly", "var.digest_to"} {
		if _, ok := paths[want]; !ok {
			t.Fatalf("expected %q in scope, got %#v", want, paths)
		}
	}
	if _, ok := paths["s1"]; ok {
		t.Fatalf("a value with no position must not see a step output: %#v", paths)
	}
	if paths["run.tenant"].Members["name"].Type != expressions.TypeText {
		t.Fatalf("expected `of` to nest, got %#v", paths["run.tenant"])
	}
}

// ScopeFor is WorkflowScope plus the upstream steps, and nothing else: one
// definition of the unpositioned half, two readers.
func TestScopeForIsWorkflowScopePlusTheSteps(t *testing.T) {
	doc := Definition{
		Triggers: []Trigger{{ID: "nightly", Use: "schedule.cron"}},
		Steps:    []Step{{ID: "s1", Use: "email.fetch"}, {ID: "s2", Use: "email.send"}},
	}
	context := []ContextKey{{K: "id", Label: "Run id", T: "text"}}

	unpositioned := WorkflowScope(doc, nil, context)
	positioned := ScopeFor(doc, "s2", nil, context)

	if len(positioned) != len(unpositioned)+1 {
		t.Fatalf("expected one step on top, got %#v", positioned)
	}
	for i, entry := range unpositioned {
		if positioned[i].Path != entry.Path {
			t.Fatalf("scope %d diverged: %q vs %q", i, positioned[i].Path, entry.Path)
		}
	}
	if positioned[len(unpositioned)].Path != "s1" {
		t.Fatalf("expected s1 last, got %q", positioned[len(unpositioned)].Path)
	}
}

// The `run` root resolves out of its own map, not out of the steps: a step may
// legitimately be called `run`, and resolving one root by looking in two places
// is how a workflow starts depending on which of them the runner checked first.
func TestRunContextResolvesFromItsOwnRoot(t *testing.T) {
	value, err := expressions.Resolve(expressions.Context{
		Run:   map[string]expressions.Value{"tenant": "acme"},
		Steps: map[string]expressions.Value{"run": map[string]expressions.Value{"tenant": "nope"}},
	}, expressions.Slot{Name: "to", Template: "{{ run.tenant }}", ExpectedType: expressions.TypeText})

	if err != nil {
		t.Fatalf("resolving: %v", err)
	}
	if value != "acme" {
		t.Fatalf("expected acme, got %#v", value)
	}
}
