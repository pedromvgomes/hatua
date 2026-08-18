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
		Scope: ScopeFor(doc, "s3", manifests),
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

	scope := ScopeFor(doc, "s2", []Manifest{mapper})
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
