package hatua

import (
	"testing"

	"hatua.dev/go/expressions"
)

// The bridge between a manifest and the expression language. The TypeScript
// half is packages/model/src/slots.test.ts, and these check the same two places
// the mapping is easy to get wrong: a `map` field, whose value is a list of
// separately-typed entries, and core.map, whose *outputs* come from that same
// list rather than from any manifest.

var emailSend = Manifest{
	Kind: KindComponent,
	Use:  "component.email.send",
	Name: "Send email",
	Fields: []Field{
		{K: "connection", Label: "Mailbox", Kind: "conn"},
		{K: "to", Label: "To", Kind: "text"},
		{K: "retries", Label: "Retries", Kind: "number"},
	},
}

var mapper = Manifest{
	Kind:   KindComponent,
	Use:    "core.map",
	Name:   "Map values",
	Fields: []Field{{K: "entries", Label: "Entries", Kind: "map"}},
}

func TestSlotsForCarriesTheDeclaredType(t *testing.T) {
	step := Step{ID: "s6", Use: "component.email.send", With: map[string]any{
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
	step := Step{ID: "s8", Use: "core.map", With: map[string]any{
		"entries": []any{
			map[string]any{"key": "subject", "value": "{{ steps.s2.subject }}", "type": "text"},
			map[string]any{"key": "count", "value": "{{ steps.s2.count }}", "type": "number"},
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
	step := Step{ID: "s8", Use: "core.map", With: map[string]any{
		"entries": []any{map[string]any{"key": "subject"}, "nonsense"},
	}}
	if slots := SlotsFor(step, mapper); len(slots) != 0 {
		t.Fatalf("expected no slots, got %#v", slots)
	}
}

// A branch condition is boolean, which is the whole reason the legacy spelling
// can be refused at design time rather than misread at run time.
func TestWhenSlotIsBoolean(t *testing.T) {
	slot := WhenSlot("{{steps.s2.count}} > 0")
	if slot.ExpectedType != expressions.TypeBoolean {
		t.Fatalf("expected a boolean slot, got %s", slot.ExpectedType)
	}

	doc := Definition{
		Steps: []Step{
			{ID: "s2", Use: "component.email.fetch"},
			{ID: "s3", Use: "core.fork"},
		},
	}
	manifests := []Manifest{{
		Kind: KindComponent, Use: "component.email.fetch", Name: "Fetch",
		Outputs: []Output{{K: "count", Label: "Count", T: "number"}},
	}}

	found := expressions.Validate(slot.Template, slot.ExpectedType, expressions.CheckContext{
		Scope: ScopeFor(doc, StepRef{ID: "s3"}, manifests, nil),
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
			{ID: "s1", Use: "core.map", With: map[string]any{
				"entries": []any{
					map[string]any{"key": "count", "value": "0", "type": "number"},
				},
			}},
			{ID: "s2", Use: "component.email.send"},
		},
	}

	scope := ScopeFor(doc, StepRef{ID: "s2"}, []Manifest{mapper}, nil)
	if len(scope) != 1 || scope[0].Path != "steps.s1" {
		t.Fatalf("unexpected scope %#v", scope)
	}
	if scope[0].Type.Members["count"].Type != expressions.TypeNumber {
		t.Fatalf("expected count to be a number, got %#v", scope[0].Type)
	}

	// And those outputs then type-check downstream like any other step's.
	ctx := expressions.CheckContext{Scope: scope}
	if found := expressions.Validate("{{ steps.s1.count > 0 }}", expressions.TypeBoolean, ctx); len(found) != 0 {
		t.Fatalf("expected a clean check, got %#v", found)
	}
	if found := expressions.Validate("{{ steps.s1.count }}", expressions.TypeBoolean, ctx); len(found) != 1 {
		t.Fatalf("expected the type conflict to be caught, got %#v", found)
	}
}

func TestUpstreamOfExcludesSiblingBranches(t *testing.T) {
	doc := Definition{
		Steps: []Step{
			{ID: "s2", Use: "component.email.fetch"},
			{ID: "s3", Use: "core.fork", Branches: []Branch{
				{Label: "Has mail", Steps: []Step{{ID: "s4", Use: "component.agent.act"}}},
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

	if got := ids(UpstreamOf(doc, StepRef{ID: "s7"})); len(got) != 2 || got[0] != "s2" || got[1] != "s3" {
		t.Fatalf("expected [s2 s3], got %v", got)
	}
	if got := ids(UpstreamOf(doc, StepRef{ID: "s2"})); len(got) != 0 {
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
		Triggers: []Trigger{{ID: "nightly", Use: "component.schedule.cron"}},
		Vars:     []Variable{{Key: "digest_to", Value: "ops@example.com"}},
		Steps:    []Step{{ID: "s1", Use: "component.email.fetch"}, {ID: "s2", Use: "component.email.send"}},
	}
	context := []ContextKey{
		{K: "id", Label: "Run id", T: "text"},
		{K: "tenant", Label: "Tenant", T: "object", Of: []ContextKey{
			{K: "name", Label: "Tenant name", T: "text"},
		}},
	}

	paths := map[string]expressions.TypeNode{}
	for _, entry := range BoardScope(doc, RootBoard, nil, context) {
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
		Triggers: []Trigger{{ID: "nightly", Use: "component.schedule.cron"}},
		Steps:    []Step{{ID: "s1", Use: "component.email.fetch"}, {ID: "s2", Use: "component.email.send"}},
	}
	context := []ContextKey{{K: "id", Label: "Run id", T: "text"}}

	unpositioned := BoardScope(doc, RootBoard, nil, context)
	positioned := ScopeFor(doc, StepRef{ID: "s2"}, nil, context)

	if len(positioned) != len(unpositioned)+1 {
		t.Fatalf("expected one step on top, got %#v", positioned)
	}
	for i, entry := range unpositioned {
		if positioned[i].Path != entry.Path {
			t.Fatalf("scope %d diverged: %q vs %q", i, positioned[i].Path, entry.Path)
		}
	}
	if positioned[len(unpositioned)].Path != "steps.s1" {
		t.Fatalf("expected steps.s1 last, got %q", positioned[len(unpositioned)].Path)
	}
}

// A step called `run` does not shadow the Run Context and is not shadowed by
// it. Every root is a bucket of its own (ADR-0014), so `run.tenant` and
// `steps.run.tenant` name different values and no resolution order can decide
// which of them a workflow means.
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

// A block reads only what it declares, plus the Run Context.
//
// The mirror of packages/model/src/blocks.test.ts. conformance/ pins the
// expression half of this in both languages; what these check is the half a
// corpus cannot reach — that ScopeFor roots its walk at the Board an id sits on,
// so a block scopes the same way in a runner as it does in the builder.
func blockDoc() Definition {
	return Definition{
		ID: "wf", Name: "W", Version: 1, Status: StatusDraft,
		Triggers: []Trigger{{ID: "nightly", Use: "core.schedule"}},
		Vars:     []Variable{{Key: "digest_to", Value: "me@dane.dev"}},
		Blocks: []Block{{
			ID: "archive_entry",
			Params: []Declaration{{
				K: "entry", Label: "Entry", T: "object",
				Of: []Declaration{{K: "headline", Label: "Headline", T: "text"}},
			}},
			Outputs: []Declaration{{K: "url", Label: "Archive URL", T: "text"}},
			Vars:    []Variable{{Key: "attempt_note", Value: ""}},
			Steps: []Step{
				{ID: "put", Use: "component.s3.upload"},
				{ID: "ret", Use: ReturnVerb},
			},
		}},
		Steps: []Step{
			{ID: "s2", Use: "component.email.fetch"},
			{ID: "audit_1", Use: "block.archive_entry"},
			{ID: "s9", Use: "core.end"},
		},
	}
}

func paths(entries []expressions.ScopeEntry) []string {
	out := make([]string, 0, len(entries))
	for _, entry := range entries {
		out = append(out, entry.Path)
	}
	return out
}

func has(entries []expressions.ScopeEntry, path string) bool {
	for _, entry := range entries {
		if entry.Path == path {
			return true
		}
	}
	return false
}

func TestBoardsYieldTheRootAndEveryBlock(t *testing.T) {
	seen := []string{}
	WalkDocument(blockDoc(), func(ref StepRef, _ Step) {
		seen = append(seen, ref.Board+"/"+ref.ID)
	})

	want := []string{"/s2", "/audit_1", "/s9", "archive_entry/put", "archive_entry/ret"}
	if len(seen) != len(want) {
		t.Fatalf("expected %v, got %v", want, seen)
	}
	for i := range want {
		if seen[i] != want[i] {
			t.Fatalf("expected %v, got %v", want, seen)
		}
	}
}

func TestBlockScopeOffersOnlyWhatItDeclares(t *testing.T) {
	doc := blockDoc()
	context := []ContextKey{{K: "tenant", Label: "Tenant", T: "text"}}
	scope := BoardScope(doc, "archive_entry", nil, context)

	want := []string{"run.tenant", "params.entry", "var.attempt_note"}
	if got := paths(scope); len(got) != len(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for i, path := range want {
		if paths(scope)[i] != path {
			t.Fatalf("expected %v, got %v", want, paths(scope))
		}
	}
}

// The contract. If a step outside the block ever reaches this scope, it has
// stopped being an exact walk and `blocks:` is the jump ADR-0013 refuses.
func TestScopeForRootsTheWalkAtTheBlock(t *testing.T) {
	doc := blockDoc()
	scope := ScopeFor(doc, StepRef{Board: "archive_entry", ID: "ret"}, nil, nil)

	if !has(scope, "steps.put") {
		t.Fatalf("expected the block's own step, got %v", paths(scope))
	}
	for _, outside := range []string{"steps.s2", "steps.audit_1", "var.digest_to", "triggers.nightly"} {
		if has(scope, outside) {
			t.Fatalf("expected %q to be out of scope inside a block, got %v", outside, paths(scope))
		}
	}
}

func TestACallIsTypedByTheBlockItNames(t *testing.T) {
	doc := blockDoc()
	scope := ScopeFor(doc, StepRef{Board: RootBoard, ID: "s9"}, nil, nil)

	var call *expressions.ScopeEntry
	for i := range scope {
		if scope[i].Path == "steps.audit_1" {
			call = &scope[i]
		}
	}
	if call == nil {
		t.Fatalf("expected the call to be in scope, got %v", paths(scope))
	}
	if call.Type.Members["url"].Type != expressions.TypeText {
		t.Fatalf("expected the declared output, got %#v", call.Type)
	}
}

func TestABlockParameterKeepsItsDeclaredShape(t *testing.T) {
	scope := BoardScope(blockDoc(), "archive_entry", nil, nil)
	for _, entry := range scope {
		if entry.Path != "params.entry" {
			continue
		}
		if entry.Type.Members["headline"].Type != expressions.TypeText {
			t.Fatalf("expected a nested text member, got %#v", entry.Type)
		}
		return
	}
	t.Fatalf("expected params.entry in %v", paths(scope))
}
