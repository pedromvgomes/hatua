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

// A loop's binding is one ELEMENT, and an element exists only while an iteration
// is running. After the loop there is no element — not the last one, which the
// file does not say, and not none, which has no type — so the loop is upstream
// of its own body and of nothing after it. The same rule a core.try follows.
//
// The TypeScript half is the "is out of scope for a Step after the loop" case in
// packages/model/src/loops.test.ts. A runner that offered `item` past the loop
// while the builder refused it is exactly the divergence the SDK exists to
// prevent.
func TestUpstreamOfDropsALoopAfterItsBody(t *testing.T) {
	doc := Definition{
		Steps: []Step{
			{ID: "fetch", Use: "component.inbox.fetch"},
			{ID: "each", Use: ForEachVerb, With: map[string]any{"list": "{{ steps.fetch.messages }}"},
				Steps: []Step{{ID: "inner", Use: "component.email.send"}}},
			{ID: "later", Use: "component.email.send"},
		},
	}

	ids := func(steps []Step) []string {
		out := make([]string, 0, len(steps))
		for _, step := range steps {
			out = append(out, step.ID)
		}
		return out
	}

	// Inside the body the loop is upstream: that is where `item` means something.
	if got := ids(UpstreamOf(doc, StepRef{ID: "inner"})); len(got) != 2 || got[1] != "each" {
		t.Fatalf("expected the loop upstream of its own body, got %v", got)
	}
	// After it, the loop is gone and the Step before it is not: what is withdrawn
	// is the binding, not everything above it.
	got := ids(UpstreamOf(doc, StepRef{ID: "later"}))
	if len(got) != 1 || got[0] != "fetch" {
		t.Fatalf("expected [fetch] after the loop, got %v", got)
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

// A call and a return are the two verbs no manifest can describe, so SlotsFor
// alone yields nothing for either — a runner asking only that would evaluate
// nothing at a call site at all.
func TestSlotsForStepReadsACallAgainstTheBlockItNames(t *testing.T) {
	doc := blockDoc()
	doc.Steps[1].With = map[string]any{"entry": "{{ steps.s2 }}"}

	slots := SlotsForStep(doc, RootBoard, doc.Steps[1], Manifest{})
	if len(slots) != 1 {
		t.Fatalf("expected the block's one parameter, got %#v", slots)
	}
	if slots[0].Name != "entry" || slots[0].ExpectedType != expressions.TypeObject {
		t.Fatalf("expected entry typed by the declaration, got %#v", slots[0])
	}
}

func TestSlotsForStepReadsAReturnAgainstItsBoard(t *testing.T) {
	doc := blockDoc()
	doc.Blocks[0].Steps[1].With = map[string]any{"url": "{{ steps.put.location }}"}

	slots := SlotsForStep(doc, "archive_entry", doc.Blocks[0].Steps[1], Manifest{})
	if len(slots) != 1 {
		t.Fatalf("expected the block's one output, got %#v", slots)
	}
	if slots[0].Name != "url" || slots[0].ExpectedType != expressions.TypeText {
		t.Fatalf("expected url typed by the declaration, got %#v", slots[0])
	}
}

// BoardID is a bare string with "" as the root, so a block whose id is empty
// must not be able to answer for the root Board.
func TestRootBoardIsNotHijackedByAnEmptyBlockID(t *testing.T) {
	doc := blockDoc()
	doc.Blocks = append(doc.Blocks, Block{
		ID:     "",
		Params: []Declaration{{K: "smuggled", Label: "Smuggled", T: "text"}},
		Vars:   []Variable{{Key: "sneaky", Value: "x"}},
	})

	scope := BoardScope(doc, RootBoard, nil, nil)
	if has(scope, "params.smuggled") || has(scope, "var.sneaky") {
		t.Fatalf("an empty block id answered for the root Board: %v", paths(scope))
	}
	if !has(scope, "triggers.nightly") || !has(scope, "var.digest_to") {
		t.Fatalf("the root Board lost its own scope: %v", paths(scope))
	}
}

// core.try and the `item` binding, on the side the rules corpus cannot reach.
//
// The corpus compares diagnostics. What a container BINDS is a type, and a type
// reaches a user through scope and the checker — so it is asserted here, and in
// packages/model/src/loops.test.ts assertion for assertion.

func bindingManifests() []Manifest {
	return []Manifest{
		{
			Kind: "component",
			Use:  "component.inbox.fetch",
			Name: "Fetch inbox",
			Outputs: []Output{
				{K: "messages", Label: "Messages", T: "list", Of: []Output{
					{K: "subject", Label: "Subject", T: "text"},
				}},
				{K: "count", Label: "Count", T: "number"},
				{K: "tags", Label: "Tags", T: "list"},
			},
		},
		{
			Kind:   "component",
			Use:    "core.for_each",
			Name:   "For each",
			Fields: []Field{{K: "list", Label: "List", Kind: "ref", Req: true}},
			// The escape hatch, and the reason this file exists: `item` is not a
			// shape the manifest holds.
			Outputs: []Output{{K: "item", Label: "Item", T: "item"}},
		},
		{
			Kind: "component",
			Use:  "core.try",
			Name: "Try",
			Outputs: []Output{
				{K: "error", Label: "Error", T: "object", Of: []Output{
					{K: "message", Label: "Message", T: "text"},
				}},
			},
		},
		{Kind: "component", Use: "component.email.send", Name: "Send"},
	}
}

func triedDoc() Definition {
	return Definition{
		ID: "wf", Name: "W", Version: 1, Status: StatusDraft,
		Steps: []Step{
			{ID: "before", Use: "component.email.send"},
			{
				ID:      "guard",
				Use:     TryVerb,
				Steps:   []Step{{ID: "body", Use: "component.email.send"}},
				Handler: []Step{{ID: "rescue", Use: "component.email.send"}},
			},
			{ID: "after", Use: "component.email.send"},
		},
	}
}

// The handler's children see the try, and therefore the failure they are
// handling.
func TestATryBindsItsFailureToTheHandlerAlone(t *testing.T) {
	doc := triedDoc()

	handler := ScopeFor(doc, StepRef{Board: RootBoard, ID: "rescue"}, bindingManifests(), nil)
	if !has(handler, "steps.guard") {
		t.Fatalf("expected the try in a handler child's scope: %v", paths(handler))
	}
	found := expressions.Validate("{{ steps.guard.error.message }}", expressions.TypeText,
		expressions.CheckContext{Scope: handler, Functions: expressions.CoreFunctions()})
	if len(found) != 0 {
		t.Fatalf("expected the failure to type-check, got %v", found)
	}

	// The body PRODUCES the failure, so reading it there would be reading a value
	// that cannot exist where it stands.
	body := ScopeFor(doc, StepRef{Board: RootBoard, ID: "body"}, bindingManifests(), nil)
	if has(body, "steps.guard") {
		t.Fatalf("the body saw the failure it produces: %v", paths(body))
	}

	// Past the try, whether there was a failure at all is a run-time fact.
	after := ScopeFor(doc, StepRef{Board: RootBoard, ID: "after"}, bindingManifests(), nil)
	if has(after, "steps.guard") {
		t.Fatalf("a step after the try saw the failure: %v", paths(after))
	}
}

// The two regions are siblings, which is what a fork's branches already are:
// which of the body's steps completed before the failure is not a property of
// the document.
func TestATrysRegionsCannotSeeEachOther(t *testing.T) {
	doc := triedDoc()

	handler := ScopeFor(doc, StepRef{Board: RootBoard, ID: "rescue"}, bindingManifests(), nil)
	if has(handler, "steps.body") {
		t.Fatalf("a handler child read the body's steps: %v", paths(handler))
	}
	body := ScopeFor(doc, StepRef{Board: RootBoard, ID: "body"}, bindingManifests(), nil)
	if has(body, "steps.rescue") {
		t.Fatalf("a body child read the handler's steps: %v", paths(body))
	}
}

func loopingDoc(list string) Definition {
	return Definition{
		ID: "wf", Name: "W", Version: 1, Status: StatusDraft,
		Steps: []Step{
			{ID: "fetch", Use: "component.inbox.fetch"},
			{
				ID:    "each",
				Use:   ForEachVerb,
				With:  map[string]any{ForEachListField: "{{ " + list + " }}"},
				Steps: []Step{{ID: "s1", Use: "component.email.send"}},
			},
		},
	}
}

func TestItemIsOneElementOfTheListItsFieldNames(t *testing.T) {
	doc := loopingDoc("steps.fetch.messages")

	element, ok := LoopElementType(doc, RootBoard, doc.Steps[1], bindingManifests(), nil)
	if !ok {
		t.Fatalf("expected the loop's element type to resolve")
	}
	if element.Type != expressions.TypeObject || element.Members["subject"].Type != expressions.TypeText {
		t.Fatalf("expected the source output's members, got %#v", element)
	}

	scope := ScopeFor(doc, StepRef{Board: RootBoard, ID: "s1"}, bindingManifests(), nil)
	if found := expressions.Validate("{{ steps.each.item.subject }}", expressions.TypeText,
		expressions.CheckContext{Scope: scope, Functions: expressions.CoreFunctions()}); len(found) != 0 {
		t.Fatalf("expected a member of the item to type-check, got %v", found)
	}
	if found := expressions.Validate("{{ steps.each.item.subject }}", expressions.TypeNumber,
		expressions.CheckContext{Scope: scope, Functions: expressions.CoreFunctions()}); len(found) == 0 {
		t.Fatalf("expected a text member to be refused where a number is declared")
	}
}

// The whole reason the binding is an output of the container rather than a bare
// token: two loops are two step ids, so nesting needs no shadowing rule.
func TestNestedLoopsEachResolveTheirOwnItem(t *testing.T) {
	manifests := append(bindingManifests(), Manifest{
		Kind: "component",
		Use:  "component.inbox.threads",
		Name: "Threads",
		Outputs: []Output{{K: "threads", Label: "Threads", T: "list", Of: []Output{
			{K: "entries", Label: "Entries", T: "list", Of: []Output{
				{K: "body", Label: "Body", T: "text"},
			}},
		}}},
	})

	doc := Definition{
		ID: "wf", Name: "W", Version: 1, Status: StatusDraft,
		Steps: []Step{
			{ID: "fetch", Use: "component.inbox.threads"},
			{
				ID:   "outer",
				Use:  ForEachVerb,
				With: map[string]any{ForEachListField: "{{ steps.fetch.threads }}"},
				Steps: []Step{{
					ID:    "inner",
					Use:   ForEachVerb,
					With:  map[string]any{ForEachListField: "{{ steps.outer.item.entries }}"},
					Steps: []Step{{ID: "s1", Use: "component.email.send"}},
				}},
			},
		},
	}

	scope := ScopeFor(doc, StepRef{Board: RootBoard, ID: "s1"}, manifests, nil)
	context := expressions.CheckContext{Scope: scope, Functions: expressions.CoreFunctions()}
	if found := expressions.Validate("{{ steps.inner.item.body }}", expressions.TypeText, context); len(found) != 0 {
		t.Fatalf("expected the inner item to resolve through the outer one, got %v", found)
	}
	// The outer loop's element is still its own shape — an inner `item` hides
	// nothing, because the two live under different step ids.
	if found := expressions.Validate("{{ steps.outer.item.entries }}", expressions.TypeList, context); len(found) != 0 {
		t.Fatalf("the inner loop shadowed the outer one's item: %v", found)
	}
}

// Not ok rather than a guess. `item` then stays `item`, which the checker treats
// as matching anything — the honest answer where `object` would be a shape
// nothing declared, and where the wrongness is reported by CodeLoopListNotAList
// rather than smuggled into a type.
func TestItemIsUnresolvedWhenTheListIsNotOne(t *testing.T) {
	for _, list := range []string{
		"steps.fetch.count",             // a number, not a list
		"json.parse(steps.fetch.count)", // not a plain Reference
		"steps.gone.messages",           // names nothing
	} {
		doc := loopingDoc(list)
		if _, ok := LoopElementType(doc, RootBoard, doc.Steps[1], bindingManifests(), nil); ok {
			t.Fatalf("expected %q to leave item unresolved", list)
		}
	}

	// And a loop with no list field at all.
	doc := loopingDoc("steps.fetch.messages")
	doc.Steps[1].With = nil
	if _, ok := LoopElementType(doc, RootBoard, doc.Steps[1], bindingManifests(), nil); ok {
		t.Fatalf("expected a loop with no list to leave item unresolved")
	}
}

// A list with no `of:` is a list whose elements the document says nothing about,
// which is not the same as a list of objects with no members. `item` stays
// `item` and matches anything, so writing one into a text field is accepted and
// checked at run time — EXPR_TYPE_UNKNOWN, a warning.
//
// Answering object here marks `item` as a shape nothing declared, and then every
// scalar field it is written into reports EXPR_TYPE_MISMATCH: an error that
// refuses Publish on a document that is correct. The TypeScript half asserts the
// same thing in `packages/model/src/loops.test.ts`, because a builder and a
// runner disagreeing about `item` is the whole reason this file exists.
func TestLoopElementTypeIsUnresolvedWhenTheListDeclaredNoOf(t *testing.T) {
	doc := loopingDoc("steps.fetch.tags")

	if _, ok := LoopElementType(doc, RootBoard, doc.Steps[1], bindingManifests(), nil); ok {
		t.Fatalf("expected a list with no `of:` to leave item unresolved")
	}

	scope := ScopeFor(doc, StepRef{Board: RootBoard, ID: "s1"}, bindingManifests(), nil)
	found := expressions.Validate("{{ steps.each.item }}", expressions.TypeText,
		expressions.CheckContext{Scope: scope, Functions: expressions.CoreFunctions()})
	if len(found) != 1 || found[0].Code != "EXPR_TYPE_UNKNOWN" {
		t.Fatalf("expected item to be accepted and checked at run time, got %v", found)
	}
}

// A repeated output key, which the schema permits into a file and
// DECLARATION_KEY_DUPLICATE only stops at Publish — so both languages have to
// pick the same one of the two while the document is being edited.
//
// First-wins, matching BlockOf and CyclicBlocks and the TypeScript half. Which
// one is picked matters less than that one answer exists: last here and first
// there types the same call site number in one builder and text in the other.
func TestBlockOutputTypeTakesTheFirstOfARepeatedKey(t *testing.T) {
	block := Block{
		ID: "twice",
		Outputs: []Declaration{
			{K: "out", Label: "Out", T: "text"},
			{K: "out", Label: "Out", T: "number"},
		},
	}

	node := blockOutputType(&block)
	if node.Members["out"].Type != expressions.TypeText {
		t.Fatalf("expected the first declaration to win, got %#v", node.Members["out"])
	}
}
