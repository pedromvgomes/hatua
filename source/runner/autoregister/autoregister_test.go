package autoregister

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"

	"hatua.dev/runner"
)

// reset empties the collection so each test starts from nothing.
func reset(t *testing.T) {
	t.Helper()
	mu.Lock()
	entries = nil
	mu.Unlock()
	t.Cleanup(func() {
		mu.Lock()
		entries = nil
		mu.Unlock()
	})
}

func constant(out string) runner.Handler {
	return func(context.Context, map[string]any) (map[string]any, error) {
		return map[string]any{"out": out}, nil
	}
}

func run(t *testing.T, r *runner.Registry, verb string) any {
	t.Helper()
	h, err := r.Lookup(verb)
	if err != nil {
		t.Fatalf("Lookup(%q): %v", verb, err)
	}
	out, err := h(context.Background(), nil)
	if err != nil {
		t.Fatalf("handler %q: %v", verb, err)
	}
	return out["out"]
}

func TestApplyRegistersCollectedHandlers(t *testing.T) {
	reset(t)
	Add("a", constant("A"))
	type empty struct{}
	AddNode("b", runner.Node[empty, map[string]any](func(context.Context, empty) (map[string]any, error) {
		return map[string]any{"out": "B"}, nil
	}))

	r := runner.NewRegistry()
	if err := Apply(r); err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if got := run(t, r, "a"); got != "A" {
		t.Errorf("a = %v, want A", got)
	}
	if got := run(t, r, "b"); got != "B" {
		t.Errorf("b = %v, want B", got)
	}
}

func TestApplyGivesEveryRegistryTheFullSet(t *testing.T) {
	reset(t)
	Add("a", constant("A"))
	Add("b", constant("B"))

	r1, r2 := runner.NewRegistry(), runner.NewRegistry()
	for i, r := range []*runner.Registry{r1, r2} {
		if err := Apply(r); err != nil {
			t.Fatalf("Apply #%d: %v", i, err)
		}
		if got := fmt.Sprint(r.Verbs()); got != "[a b]" {
			t.Errorf("registry %d verbs = %s, want [a b]", i, got)
		}
	}
}

func TestApplyReportsDuplicateVerbAcrossAdds(t *testing.T) {
	reset(t)
	Add("a", constant("first"))
	Add("a", constant("second"))

	r := runner.NewRegistry()
	err := Apply(r)
	if !errors.Is(err, runner.ErrDuplicateVerb) {
		t.Fatalf("Apply = %v, want ErrDuplicateVerb", err)
	}
	if got := run(t, r, "a"); got != "first" {
		t.Errorf("a = %v, want the first registration to stand", got)
	}
}

func TestApplyReportsEveryFailureJoined(t *testing.T) {
	reset(t)
	Add("", constant("x"))
	Add("nil", nil)
	Add("ok", constant("ok"))

	r := runner.NewRegistry()
	err := Apply(r)
	if !errors.Is(err, runner.ErrEmptyVerb) || !errors.Is(err, runner.ErrNilHandler) {
		t.Fatalf("Apply = %v, want ErrEmptyVerb and ErrNilHandler", err)
	}
	if got := run(t, r, "ok"); got != "ok" {
		t.Errorf("ok = %v, want the valid handler registered despite the others", got)
	}
}

func TestApplyReportsInvalidNodeType(t *testing.T) {
	reset(t)
	AddNode("bad", runner.Node[int, map[string]any](func(context.Context, int) (map[string]any, error) {
		return nil, nil
	}))

	err := Apply(runner.NewRegistry())
	if !errors.Is(err, runner.ErrInputType) {
		t.Fatalf("Apply = %v, want ErrInputType", err)
	}
	var ve *runner.VerbError
	if !errors.As(err, &ve) || ve.Verb != "bad" {
		t.Errorf("Apply = %v, want a VerbError naming bad", err)
	}
}

func TestApplyReportsVerbAlreadyInRegistry(t *testing.T) {
	reset(t)
	Add("a", constant("collected"))

	r := runner.NewRegistry()
	if err := r.Register("a", constant("held")); err != nil {
		t.Fatal(err)
	}
	if err := Apply(r); !errors.Is(err, runner.ErrDuplicateVerb) {
		t.Fatalf("Apply = %v, want ErrDuplicateVerb", err)
	}
	if got := run(t, r, "a"); got != "held" {
		t.Errorf("a = %v, want the held handler to stand", got)
	}
}

func TestAddIsSafeForConcurrentUse(t *testing.T) {
	reset(t)
	const n = 50
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			Add(fmt.Sprintf("verb-%d", i), constant("x"))
		}()
	}
	wg.Wait()

	r := runner.NewRegistry()
	if err := Apply(r); err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if got := len(r.Verbs()); got != n {
		t.Errorf("registered %d verbs, want %d", got, n)
	}
}
