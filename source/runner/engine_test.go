package runner

import (
	"context"
	"errors"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	hatua "hatua.dev/go"
	"hatua.dev/go/expressions"
)

// engineManifests declares every verb the engine tests use, core verbs
// included: the validator holds a core verb to a manifest exactly as it holds
// a Host's.
const engineManifests = `
components:
  - kind: trigger
    use: core.manual
    name: Manual
    fields: []
    outputs:
      - { k: name, label: Name, t: text }
      - { k: count, label: Count, t: number }
  - kind: component
    use: core.end
    name: End
    fields: []
    outputs: []
  - kind: component
    use: core.fork
    name: Fork
    fields: []
    outputs: []
  - kind: component
    use: crm.lookup
    name: Look up customer
    fields:
      - { k: name, label: Name, kind: text, req: true }
      - { k: tenant, label: Tenant, kind: text }
    outputs:
      - { k: customer, label: Customer, t: text }
  - kind: component
    use: mail.send
    name: Send mail
    fields:
      - { k: to, label: To, kind: text, req: true }
    outputs:
      - { k: sent, label: Sent, t: text }
  - kind: component
    use: data.shape
    name: Shape
    fields:
      - { k: label, label: Label, kind: text }
      - { k: entries, label: Entries, kind: map }
      - { k: mode, label: Mode, kind: select, options: [{ value: "{{raw}}", label: Raw }] }
    outputs: []
`

var engineContextKeys = []hatua.ContextKey{{K: "tenant", Label: "Tenant", T: "text"}}

func loadDefinition(t *testing.T, yaml string) hatua.Definition {
	t.Helper()
	def, err := hatua.LoadDefinition([]byte(yaml))
	if err != nil {
		t.Fatalf("LoadDefinition: %v", err)
	}
	return *def
}

func loadEngineManifests(t *testing.T) []hatua.Manifest {
	t.Helper()
	manifests, err := hatua.LoadManifests([]byte(engineManifests))
	if err != nil {
		t.Fatalf("LoadManifests: %v", err)
	}
	return manifests
}

// recorder registers Handlers that log every call, so a test can tell which
// Handlers ran and with what fields.
type recorder struct {
	mu    sync.Mutex
	calls []call
}

type call struct {
	verb   string
	fields map[string]any
}

func (r *recorder) handler(verb string, run Handler) Handler {
	return func(ctx context.Context, fields map[string]any) (map[string]any, error) {
		r.mu.Lock()
		r.calls = append(r.calls, call{verb: verb, fields: fields})
		r.mu.Unlock()
		return run(ctx, fields)
	}
}

func (r *recorder) verbs() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []string{}
	for _, c := range r.calls {
		out = append(out, c.verb)
	}
	return out
}

func newEngine(t *testing.T, handlers map[string]Handler) *Engine {
	t.Helper()
	reg := NewRegistry()
	for verb, h := range handlers {
		if err := reg.Register(verb, h); err != nil {
			t.Fatalf("Register(%q): %v", verb, err)
		}
	}
	engine, err := NewEngine(reg, loadEngineManifests(t), WithRunContext(engineContextKeys))
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	return engine
}

func standardHandlers(rec *recorder) map[string]Handler {
	return map[string]Handler{
		"crm.lookup": rec.handler("crm.lookup", func(_ context.Context, f map[string]any) (map[string]any, error) {
			return map[string]any{"customer": "cust-" + f["name"].(string)}, nil
		}),
		"mail.send": rec.handler("mail.send", func(_ context.Context, f map[string]any) (map[string]any, error) {
			return map[string]any{"sent": "to " + f["to"].(string)}, nil
		}),
	}
}

func startInput() RunInput {
	return RunInput{
		Trigger: "start",
		Payload: map[string]any{"name": "Ada"},
		Run:     map[string]any{"tenant": "acme"},
		Now:     time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
	}
}

const flowDefinition = `
id: wf_flow
name: Flow
version: 1
status: published
triggers:
  - id: start
    use: core.manual
steps:
  - id: lookup
    use: crm.lookup
    with:
      name: "{{triggers.start.name}}"
      tenant: "{{run.tenant}}"
  - id: notify
    use: mail.send
    with:
      to: "{{steps.lookup.customer}}"
  - id: done
    use: core.end
`

func TestEngineRunsHostStepsToCoreEnd(t *testing.T) {
	rec := &recorder{}
	engine := newEngine(t, standardHandlers(rec))

	result, err := engine.Run(context.Background(), loadDefinition(t, flowDefinition), startInput())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	want := Result{
		Status: StatusSucceeded,
		Steps: []StepResult{
			{ID: "lookup", Use: "crm.lookup", Output: map[string]any{"customer": "cust-Ada"}},
			{ID: "notify", Use: "mail.send", Output: map[string]any{"sent": "to cust-Ada"}},
			{ID: "done", Use: "core.end"},
		},
		Ended: true,
	}
	if !reflect.DeepEqual(result, want) {
		t.Fatalf("result =\n%#v\nwant\n%#v", result, want)
	}
}

func TestEngineResolvesTriggerRunContextAndStepOutputs(t *testing.T) {
	rec := &recorder{}
	engine := newEngine(t, standardHandlers(rec))

	if _, err := engine.Run(context.Background(), loadDefinition(t, flowDefinition), startInput()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(rec.calls) != 2 {
		t.Fatalf("calls = %v, want two", rec.verbs())
	}
	if got, want := rec.calls[0].fields, map[string]any{"name": "Ada", "tenant": "acme"}; !reflect.DeepEqual(got, want) {
		t.Errorf("lookup fields = %#v, want %#v", got, want)
	}
	if got, want := rec.calls[1].fields, map[string]any{"to": "cust-Ada"}; !reflect.DeepEqual(got, want) {
		t.Errorf("notify fields = %#v, want %#v", got, want)
	}
}

func TestEngineSucceedsWhenStepsRunOut(t *testing.T) {
	rec := &recorder{}
	engine := newEngine(t, standardHandlers(rec))
	def := loadDefinition(t, flowDefinition)
	def.Steps = def.Steps[:2]

	result, err := engine.Run(context.Background(), def, startInput())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if result.Status != StatusSucceeded || result.Ended || len(result.Steps) != 2 {
		t.Fatalf("result = %+v, want succeeded with two Steps and not ended", result)
	}
}

func TestEngineCoreEndStopsLaterSteps(t *testing.T) {
	rec := &recorder{}
	engine := newEngine(t, standardHandlers(rec))
	def := loadDefinition(t, `
id: wf_end
name: End early
version: 1
status: published
triggers:
  - id: start
    use: core.manual
steps:
  - id: lookup
    use: crm.lookup
    with:
      name: "{{triggers.start.name}}"
  - id: stop
    use: core.end
  - id: notify
    use: mail.send
    with:
      to: "{{steps.lookup.customer}}"
`)

	result, err := engine.Run(context.Background(), def, startInput())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !result.Ended || result.Status != StatusSucceeded {
		t.Fatalf("result = %+v, want succeeded through core.end", result)
	}
	if got := rec.verbs(); !slices.Equal(got, []string{"crm.lookup"}) {
		t.Fatalf("handlers called = %v, want only crm.lookup", got)
	}
}

func TestEngineHandlerErrorFailsTheRun(t *testing.T) {
	rec := &recorder{}
	handlers := standardHandlers(rec)
	boom := errors.New("crm is down")
	handlers["crm.lookup"] = rec.handler("crm.lookup", func(context.Context, map[string]any) (map[string]any, error) {
		return nil, boom
	})
	engine := newEngine(t, handlers)

	result, err := engine.Run(context.Background(), loadDefinition(t, flowDefinition), startInput())
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want it to wrap the Handler's error", err)
	}
	var stepErr *StepError
	if !errors.As(err, &stepErr) || stepErr.StepID != "lookup" || stepErr.Use != "crm.lookup" {
		t.Fatalf("err = %#v, want a *StepError naming lookup", err)
	}
	if result.Status != StatusFailed || result.FailedStep != "lookup" || result.Err != err {
		t.Fatalf("result = %+v, want failed at lookup carrying the error", result)
	}
	if len(result.Steps) != 0 || result.Ended {
		t.Fatalf("result.Steps = %v, Ended = %v; want no completed Steps", result.Steps, result.Ended)
	}
	if got := rec.verbs(); !slices.Equal(got, []string{"crm.lookup"}) {
		t.Fatalf("handlers called = %v, want only crm.lookup", got)
	}
}

func TestEngineCancelledBeforeTheRun(t *testing.T) {
	rec := &recorder{}
	engine := newEngine(t, standardHandlers(rec))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	result, err := engine.Run(ctx, loadDefinition(t, flowDefinition), startInput())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want it to wrap context.Canceled", err)
	}
	if result.Status != StatusCancelled || len(result.Steps) != 0 || result.FailedStep != "" {
		t.Fatalf("result = %+v, want cancelled with no Steps", result)
	}
	if got := rec.verbs(); len(got) != 0 {
		t.Fatalf("handlers called = %v, want none", got)
	}
}

func TestEngineCancelledBetweenSteps(t *testing.T) {
	rec := &recorder{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	handlers := standardHandlers(rec)
	lookup := handlers["crm.lookup"]
	handlers["crm.lookup"] = func(ctx context.Context, f map[string]any) (map[string]any, error) {
		cancel()
		return lookup(ctx, f)
	}
	engine := newEngine(t, handlers)

	result, err := engine.Run(ctx, loadDefinition(t, flowDefinition), startInput())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want it to wrap context.Canceled", err)
	}
	if result.Status != StatusCancelled || result.FailedStep != "" {
		t.Fatalf("result = %+v, want cancelled between Steps", result)
	}
	if len(result.Steps) != 1 || result.Steps[0].ID != "lookup" {
		t.Fatalf("result.Steps = %v, want only lookup", result.Steps)
	}
	if got := rec.verbs(); !slices.Equal(got, []string{"crm.lookup"}) {
		t.Fatalf("handlers called = %v, want only crm.lookup", got)
	}
}

func TestEngineCancelledDuringAStep(t *testing.T) {
	rec := &recorder{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	handlers := standardHandlers(rec)
	handlers["crm.lookup"] = rec.handler("crm.lookup", func(ctx context.Context, _ map[string]any) (map[string]any, error) {
		cancel()
		<-ctx.Done()
		return nil, errors.New("lookup abandoned")
	})
	engine := newEngine(t, handlers)

	result, err := engine.Run(ctx, loadDefinition(t, flowDefinition), startInput())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want it to wrap context.Canceled", err)
	}
	var stepErr *StepError
	if !errors.As(err, &stepErr) || stepErr.StepID != "lookup" {
		t.Fatalf("err = %v, want it to carry the Step's error", err)
	}
	if result.Status != StatusCancelled || result.FailedStep != "lookup" || len(result.Steps) != 0 {
		t.Fatalf("result = %+v, want cancelled at lookup", result)
	}
	if got := rec.verbs(); !slices.Equal(got, []string{"crm.lookup"}) {
		t.Fatalf("handlers called = %v, want only crm.lookup", got)
	}
}

func TestEngineRefusesAnInvalidDefinition(t *testing.T) {
	rec := &recorder{}
	engine := newEngine(t, standardHandlers(rec))
	def := loadDefinition(t, flowDefinition)
	// `to` is a required field; leaving it out is a publish-blocking
	// diagnostic.
	def.Steps[1].With = nil

	result, err := engine.Run(context.Background(), def, startInput())
	var invalid *InvalidDefinitionError
	if !errors.As(err, &invalid) {
		t.Fatalf("err = %v, want *InvalidDefinitionError", err)
	}
	found := slices.ContainsFunc(invalid.Diagnostics, func(d hatua.Diagnostic) bool {
		return d.Code == hatua.CodeFieldRequired && d.StepID == "notify" && d.FieldKey == "to"
	})
	if !found {
		t.Fatalf("diagnostics = %+v, want FIELD_REQUIRED on notify.to", invalid.Diagnostics)
	}
	if !reflect.DeepEqual(result, Result{}) {
		t.Fatalf("result = %+v, want the zero Result", result)
	}
	if got := rec.verbs(); len(got) != 0 {
		t.Fatalf("handlers called = %v, want none", got)
	}
}

func TestEngineRefusesAReferenceWithoutRunContextKeys(t *testing.T) {
	reg := NewRegistry()
	for verb, h := range standardHandlers(&recorder{}) {
		if err := reg.Register(verb, h); err != nil {
			t.Fatalf("Register: %v", err)
		}
	}
	engine, err := NewEngine(reg, loadEngineManifests(t))
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}

	_, err = engine.Run(context.Background(), loadDefinition(t, flowDefinition), startInput())
	var invalid *InvalidDefinitionError
	if !errors.As(err, &invalid) {
		t.Fatalf("err = %v, want *InvalidDefinitionError for an undeclared run.tenant", err)
	}
}

func TestEngineRefusesUnregisteredVerbsUpFront(t *testing.T) {
	rec := &recorder{}
	engine := newEngine(t, map[string]Handler{})

	result, err := engine.Run(context.Background(), loadDefinition(t, flowDefinition), startInput())
	var missing *MissingHandlersError
	if !errors.As(err, &missing) {
		t.Fatalf("err = %v, want *MissingHandlersError", err)
	}
	if want := []string{"crm.lookup", "mail.send"}; !slices.Equal(missing.Verbs, want) {
		t.Fatalf("missing verbs = %v, want %v", missing.Verbs, want)
	}
	if !errors.Is(err, ErrUnregisteredVerb) {
		t.Fatalf("err = %v, want it to match ErrUnregisteredVerb", err)
	}
	if !reflect.DeepEqual(result, Result{}) || len(rec.verbs()) != 0 {
		t.Fatalf("result = %+v, want the zero Result and no Handler called", result)
	}
}

func TestEngineRefusesUnsupportedStepsUpFront(t *testing.T) {
	rec := &recorder{}
	engine := newEngine(t, standardHandlers(rec))
	def := loadDefinition(t, `
id: wf_fork
name: Fork
version: 1
status: published
triggers:
  - id: start
    use: core.manual
steps:
  - id: lookup
    use: crm.lookup
    with:
      name: "{{triggers.start.name}}"
  - id: split
    use: core.fork
    branches:
      - label: One
        steps:
          - id: one
            use: mail.send
            with:
              to: "{{steps.lookup.customer}}"
      - label: Other
        steps:
          - id: other
            use: core.end
`)

	result, err := engine.Run(context.Background(), def, startInput())
	var unsupported *UnsupportedStepError
	if !errors.As(err, &unsupported) {
		t.Fatalf("err = %v, want *UnsupportedStepError", err)
	}
	if unsupported.StepID != "split" || unsupported.Use != "core.fork" {
		t.Fatalf("unsupported = %+v, want split / core.fork", unsupported)
	}
	if !errors.Is(err, ErrUnsupportedStep) {
		t.Fatalf("err = %v, want it to match ErrUnsupportedStep", err)
	}
	if !reflect.DeepEqual(result, Result{}) {
		t.Fatalf("result = %+v, want the zero Result", result)
	}
	if got := rec.verbs(); len(got) != 0 {
		t.Fatalf("handlers called = %v, want none", got)
	}
}

func TestEngineRefusesAnUndeclaredTrigger(t *testing.T) {
	rec := &recorder{}
	engine := newEngine(t, standardHandlers(rec))
	in := startInput()
	in.Trigger = "webhook"

	_, err := engine.Run(context.Background(), loadDefinition(t, flowDefinition), in)
	if !errors.Is(err, ErrUnknownTrigger) {
		t.Fatalf("err = %v, want ErrUnknownTrigger", err)
	}
	if got := rec.verbs(); len(got) != 0 {
		t.Fatalf("handlers called = %v, want none", got)
	}
}

func TestEngineSeedsAVariableWithoutAHoleAsItsText(t *testing.T) {
	var got map[string]any
	engine := newEngine(t, map[string]Handler{
		"mail.send": func(_ context.Context, f map[string]any) (map[string]any, error) {
			got = f
			return map[string]any{"sent": "yes"}, nil
		},
	})
	def := loadDefinition(t, `
id: wf_vars
name: Vars
version: 1
status: published
triggers:
  - id: start
    use: core.manual
vars:
  - key: recipient
    t: text
    value: ops@example.com
steps:
  - id: notify
    use: mail.send
    with:
      to: "{{var.recipient}}"
`)

	if _, err := engine.Run(context.Background(), def, startInput()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if want := map[string]any{"to": "ops@example.com"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("fields = %#v, want %#v", got, want)
	}
}

// shapeEngine returns an Engine whose data.shape Handler is a typed Node with
// a string Label, recording the fields it is called with into got.
func shapeEngine(t *testing.T, got *map[string]any, called *bool) *Engine {
	t.Helper()
	type shapeIn struct {
		Label   string
		Entries map[string]any
		Mode    string
	}
	shape, err := Node[shapeIn, map[string]any](func(_ context.Context, in shapeIn) (map[string]any, error) {
		*called = true
		*got = map[string]any{"label": in.Label, "entries": in.Entries, "mode": in.Mode}
		return map[string]any{}, nil
	}).Handler()
	if err != nil {
		t.Fatalf("Handler: %v", err)
	}
	return newEngine(t, map[string]Handler{"data.shape": shape})
}

func countInput() RunInput {
	in := startInput()
	in.Payload = map[string]any{"name": "Ada", "count": 3}
	return in
}

func TestEngineCoercesANumberInATextFieldToText(t *testing.T) {
	var got map[string]any
	var called bool
	engine := shapeEngine(t, &got, &called)
	def := loadDefinition(t, `
id: wf_text
name: Text
version: 1
status: published
triggers:
  - id: start
    use: core.manual
steps:
  - id: shape
    use: data.shape
    with:
      label: "{{triggers.start.count}}"
`)

	if _, err := engine.Run(context.Background(), def, countInput()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got["label"] != "3" {
		t.Fatalf("label = %#v, want the text \"3\"", got["label"])
	}
}

func TestEngineHandsAMapFieldOverAsAKeyedObject(t *testing.T) {
	var got map[string]any
	var called bool
	engine := shapeEngine(t, &got, &called)
	def := loadDefinition(t, `
id: wf_map
name: Map
version: 1
status: published
triggers:
  - id: start
    use: core.manual
steps:
  - id: shape
    use: data.shape
    with:
      mode: "{{raw}}"
      entries:
        - { key: who, value: "{{triggers.start.name}}", type: text }
        - { key: total, value: "{{triggers.start.count}}", type: number }
        - { key: shown, value: "{{triggers.start.count}}", type: text }
`)

	if _, err := engine.Run(context.Background(), def, countInput()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	want := map[string]any{
		"label":   "",
		"entries": map[string]any{"who": "Ada", "total": float64(3), "shown": "3"},
		"mode":    "{{raw}}",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("fields = %#v, want %#v", got, want)
	}
}

func TestEngineResolvesVariableTemplatesInDeclarationOrder(t *testing.T) {
	var got map[string]any
	var called bool
	engine := shapeEngine(t, &got, &called)
	def := loadDefinition(t, `
id: wf_var_templates
name: Variable templates
version: 1
status: published
triggers:
  - id: start
    use: core.manual
vars:
  - key: first
    t: number
    value: "{{ 1 + 1 }}"
  - key: second
    t: text
    value: "{{ var.first }} for {{ triggers.start.name }}"
steps:
  - id: shape
    use: data.shape
    with:
      label: "{{var.second}}"
      entries:
        - { key: first, value: "{{var.first}}", type: number }
`)

	if _, err := engine.Run(context.Background(), def, countInput()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	want := map[string]any{
		"label":   "2 for Ada",
		"entries": map[string]any{"first": float64(2)},
		"mode":    "",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("fields = %#v, want %#v", got, want)
	}
}

func TestEngineSeedsNonStringVariablesWithTheirLiteralValues(t *testing.T) {
	var got map[string]any
	var called bool
	engine := shapeEngine(t, &got, &called)
	def := loadDefinition(t, `
id: wf_var_literals
name: Variable literals
version: 1
status: published
triggers:
  - id: start
    use: core.manual
vars:
  - key: limit
    t: number
    value: 5
  - key: ratio
    t: number
    value: 0.5
  - key: on
    t: boolean
    value: true
  - key: tags
    t: list
    value: [a, 2, false]
  - key: config
    t: object
    value:
      retries: 3
      verbose: true
      nested: { name: x }
steps:
  - id: shape
    use: data.shape
    with:
      entries:
        - { key: limit, value: "{{var.limit}}", type: number }
        - { key: ratio, value: "{{var.ratio}}", type: number }
        - { key: on, value: "{{var.on}}", type: boolean }
        - { key: tags, value: "{{var.tags}}", type: list }
        - { key: config, value: "{{var.config}}", type: object }
`)

	if _, err := engine.Run(context.Background(), def, countInput()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	want := map[string]any{
		"limit": float64(5),
		"ratio": 0.5,
		"on":    true,
		"tags":  []any{"a", float64(2), false},
		"config": map[string]any{
			"retries": float64(3),
			"verbose": true,
			"nested":  map[string]any{"name": "x"},
		},
	}
	if !called {
		t.Fatal("the Handler did not run")
	}
	if !reflect.DeepEqual(got["entries"], want) {
		t.Fatalf("entries = %#v, want %#v", got["entries"], want)
	}
}

func TestEngineRefusesARunWhoseVariableTemplateFails(t *testing.T) {
	var got map[string]any
	var called bool
	engine := shapeEngine(t, &got, &called)
	def := loadDefinition(t, `
id: wf_var_fails
name: Variable fails
version: 1
status: published
triggers:
  - id: start
    use: core.manual
vars:
  - key: ratio
    t: number
    value: "{{ 1 / 0 }}"
steps:
  - id: shape
    use: data.shape
    with:
      label: "{{var.ratio}}"
`)

	result, err := engine.Run(context.Background(), def, countInput())
	var varErr *VariableError
	if !errors.As(err, &varErr) || varErr.Key != "ratio" {
		t.Fatalf("err = %v, want a *VariableError naming ratio", err)
	}
	if !reflect.DeepEqual(result, Result{}) {
		t.Fatalf("result = %+v, want the zero Result", result)
	}
	if called {
		t.Fatal("a Handler ran, want none")
	}
}

// greetEngine returns an Engine given greetFunctions through WithFunctions,
// whose data.shape Handler records the fields it is called with into got.
func greetEngine(t *testing.T, got *map[string]any) *Engine {
	t.Helper()
	reg := NewRegistry()
	err := reg.Register("data.shape", func(_ context.Context, fields map[string]any) (map[string]any, error) {
		*got = fields
		return map[string]any{}, nil
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	engine, err := NewEngine(reg, loadEngineManifests(t), WithFunctions(greetFunctions(t)))
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	return engine
}

func TestEngineCallsAHostFunctionFromAVariable(t *testing.T) {
	var got map[string]any
	engine := greetEngine(t, &got)
	def := loadDefinition(t, `
id: wf_host_var
name: Host function in a variable
version: 1
status: published
triggers:
  - id: start
    use: core.manual
vars:
  - key: greeting
    t: text
    value: "{{ crm.greet(triggers.start.name) }}"
steps:
  - id: shape
    use: data.shape
    with:
      label: "{{var.greeting}}"
`)

	if _, err := engine.Run(context.Background(), def, startInput()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got["label"] != "Hello, Ada" {
		t.Fatalf("label = %#v, want %q", got["label"], "Hello, Ada")
	}
}

// The SDK's validator checks a Step's Templates against the core functions
// alone, since no manifest kind declares a Host function, so a Step field
// calling one names nothing in scope and is refused before the run starts. A
// variable's value is not checked, which is why a Host function is reachable
// from there.
func TestEngineRefusesAHostFunctionCalledFromAStepField(t *testing.T) {
	var got map[string]any
	engine := greetEngine(t, &got)
	def := loadDefinition(t, `
id: wf_host_step
name: Host function in a step
version: 1
status: published
triggers:
  - id: start
    use: core.manual
steps:
  - id: shape
    use: data.shape
    with:
      label: "{{ crm.greet(triggers.start.name) }}"
`)

	_, err := engine.Run(context.Background(), def, startInput())
	var invalid *InvalidDefinitionError
	if !errors.As(err, &invalid) {
		t.Fatalf("err = %v, want *InvalidDefinitionError", err)
	}
	found := slices.ContainsFunc(invalid.Diagnostics, func(d hatua.Diagnostic) bool {
		return d.Code == hatua.DefinitionCode(expressions.CodeExprUnknownReference) &&
			d.StepID == "shape" && d.FieldKey == "label"
	})
	if !found {
		t.Fatalf("diagnostics = %+v, want EXPR_UNKNOWN_REFERENCE on shape.label", invalid.Diagnostics)
	}
	if got != nil {
		t.Fatalf("data.shape ran with %#v, want no Handler called", got)
	}
}

func TestNewEngineRefusesAHostFunctionShadowingACoreOne(t *testing.T) {
	host := expressions.Registry{"text.upper": expressions.CoreFunctions()["text.upper"]}
	if _, err := NewEngine(NewRegistry(), nil, WithFunctions(host)); err == nil {
		t.Fatal("NewEngine accepted a Host function named text.upper")
	}
}

func TestNewEngineRejectsANilRegistry(t *testing.T) {
	if _, err := NewEngine(nil, nil); !errors.Is(err, ErrNilRegistry) {
		t.Fatalf("err = %v, want ErrNilRegistry", err)
	}
}

func TestInvalidDefinitionErrorNamesTheFirstDiagnostic(t *testing.T) {
	err := &InvalidDefinitionError{Diagnostics: []hatua.Diagnostic{{
		Code: hatua.CodeFieldRequired, Message: "To is required.", StepID: "notify",
	}}}
	if msg := err.Error(); !strings.Contains(msg, `"notify"`) || !strings.Contains(msg, "To is required.") {
		t.Fatalf("Error() = %q, want it to name the step and the message", msg)
	}
}
