package runner

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	hatua "hatua.dev/go"
	"hatua.dev/go/expressions"
)

func greetFunctions(t *testing.T) expressions.Registry {
	t.Helper()
	host, err := expressions.HostFunctions(
		[]expressions.FunctionSpec{{
			Namespace: "crm",
			Name:      "greet",
			Qualified: "crm.greet",
			Params:    []expressions.ParamSpec{{Name: "name", Type: expressions.TypeText}},
			Returns:   expressions.TypeText,
		}},
		map[string]expressions.FunctionImpl{
			"crm.greet": func(args []expressions.Value, _ expressions.Context) expressions.Value {
				return "Hello, " + args[0].(string)
			},
		},
	)
	if err != nil {
		t.Fatalf("HostFunctions: %v", err)
	}
	return host
}

func populatedScope(t *testing.T) *Scope {
	t.Helper()
	scope, err := NewScope(greetFunctions(t))
	if err != nil {
		t.Fatalf("NewScope: %v", err)
	}
	scope.SetTrigger("form", map[string]any{"name": "Ada", "count": 3})
	scope.SetParams(map[string]any{"limit": 10})
	scope.SetRun(map[string]any{"id": "run-1", "tenant": "acme"})
	scope.SetVar("threshold", 2.5)
	scope.SetVar("note", nil)
	scope.RecordOutput("s1", map[string]any{
		"total": 42,
		"tags":  []any{"a", "b"},
	})
	scope.SetNow(time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC))
	return scope
}

func TestScopeResolveFields(t *testing.T) {
	cases := []struct {
		name  string
		field any
		want  any
	}{
		{"trigger payload", "{{triggers.form.name}}", "Ada"},
		{"trigger number keeps its type", "{{triggers.form.count}}", 3.0},
		{"which trigger fired", "{{TRIGGER}}", "form"},
		{"param", "{{params.limit}}", 10.0},
		{"step output", "{{steps.s1.total}}", 42.0},
		{"step output list element", "{{steps.s1.tags[1]}}", "b"},
		{"var", "{{var.threshold}}", 2.5},
		{"run context", "{{run.tenant}}", "acme"},
		{"present key holding null", "{{var.note}}", nil},
		{"null falls back through ??", "{{var.note ?? 'none'}}", "none"},
		{"null renders empty in mixed text", "note:{{var.note}}.", "note:."},
		{"host function call", "{{crm.greet(triggers.form.name)}}", "Hello, Ada"},
		{"core function call", "{{text.upper(run.tenant)}}", "ACME"},
		{"clock", "{{dt.now()}}", time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)},
		{"mixed literal and expressions", "Run {{run.id}} saw {{steps.s1.total}} rows", "Run run-1 saw 42 rows"},
		{"plain text", "no expressions here", "no expressions here"},
		{"number passes through", 7, 7},
		{"boolean passes through", true, true},
		{"nil passes through", nil, nil},
		{
			"nested map and list",
			map[string]any{
				"title": "{{triggers.form.name}}",
				"count": 1,
				"items": []any{"{{run.id}}", false, map[string]any{"v": "{{var.threshold}}"}},
			},
			map[string]any{
				"title": "Ada",
				"count": 1,
				"items": []any{"run-1", false, map[string]any{"v": 2.5}},
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			scope := populatedScope(t)
			got, err := scope.ResolveFields(map[string]any{"f": tc.field})
			if err != nil {
				t.Fatalf("ResolveFields: %v", err)
			}
			if !reflect.DeepEqual(got["f"], tc.want) {
				t.Fatalf("f = %#v, want %#v", got["f"], tc.want)
			}
		})
	}
}

func TestScopeResolveFieldsErrorsNameTheField(t *testing.T) {
	cases := []struct {
		name   string
		fields map[string]any
		want   []string
	}{
		{
			"absent key",
			map[string]any{"subject": "{{triggers.form.missing}}"},
			[]string{"subject"},
		},
		{
			"step that has not run",
			map[string]any{"subject": "{{steps.s9.total}}"},
			[]string{"subject"},
		},
		{
			"unknown function",
			map[string]any{"subject": "{{crm.unknown()}}"},
			[]string{"subject"},
		},
		{
			"unknown root",
			map[string]any{"subject": "{{s1.total}}"},
			[]string{"subject"},
		},
		{
			"nested map and list",
			map[string]any{"body": map[string]any{"rows": []any{"ok", "{{var.absent}}"}}},
			[]string{"body.rows[1]"},
		},
		{
			"every failing field",
			map[string]any{"a": "{{var.absent}}", "b": "fine", "c": "x {{run.absent}}"},
			[]string{"a", "c"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			scope := populatedScope(t)
			got, err := scope.ResolveFields(tc.fields)
			if err == nil {
				t.Fatalf("ResolveFields = %#v, want an error", got)
			}
			if got != nil {
				t.Fatalf("ResolveFields returned %#v beside its error", got)
			}

			var fields []string
			collectTemplateErrors(t, err, &fields)
			if !reflect.DeepEqual(fields, tc.want) {
				t.Fatalf("failing fields = %v, want %v", fields, tc.want)
			}
			for _, field := range tc.want {
				if !strings.Contains(err.Error(), "field "+field+":") {
					t.Fatalf("error %q does not name field %q", err, field)
				}
			}
		})
	}
}

// collectTemplateErrors gathers the Field of every *TemplateError in err, in order,
// and checks each carries an *expressions.Error whose diagnostics name the
// same slot.
func collectTemplateErrors(t *testing.T, err error, out *[]string) {
	t.Helper()
	if joined, ok := err.(interface{ Unwrap() []error }); ok {
		for _, inner := range joined.Unwrap() {
			collectTemplateErrors(t, inner, out)
		}
		return
	}
	var fieldErr *TemplateError
	if !errors.As(err, &fieldErr) {
		t.Fatalf("error %v is not a *TemplateError", err)
	}
	var exprErr *expressions.Error
	if !errors.As(err, &exprErr) {
		t.Fatalf("error %v does not wrap an *expressions.Error", err)
	}
	for _, d := range exprErr.Diagnostics {
		if d.Slot != fieldErr.Field {
			t.Fatalf("diagnostic slot = %q, want %q", d.Slot, fieldErr.Field)
		}
	}
	*out = append(*out, fieldErr.Field)
}

func TestScopeResolveFieldsLeavesInputUnchanged(t *testing.T) {
	scope := populatedScope(t)
	fields := map[string]any{"body": map[string]any{"rows": []any{"{{run.id}}"}}}
	if _, err := scope.ResolveFields(fields); err != nil {
		t.Fatalf("ResolveFields: %v", err)
	}
	want := map[string]any{"body": map[string]any{"rows": []any{"{{run.id}}"}}}
	if !reflect.DeepEqual(fields, want) {
		t.Fatalf("input = %#v, want %#v", fields, want)
	}
}

func TestScopeEmptyNamespacesAreMissing(t *testing.T) {
	scope, err := NewScope(nil)
	if err != nil {
		t.Fatalf("NewScope: %v", err)
	}
	for _, template := range []string{
		"{{triggers.form}}", "{{params.limit}}", "{{run.id}}", "{{var.x}}", "{{steps.s1}}", "{{TRIGGER}}",
	} {
		if _, err := scope.ResolveFields(map[string]any{"f": template}); err == nil {
			t.Errorf("%s resolved in an empty Scope, want a missing-path error", template)
		}
	}
	if _, err := scope.ResolveFields(map[string]any{"f": "{{dt.now()}}"}); err == nil {
		t.Errorf("dt.now() resolved without a clock, want an error")
	}
}

func TestScopeContextIsASnapshot(t *testing.T) {
	scope, err := NewScope(nil)
	if err != nil {
		t.Fatalf("NewScope: %v", err)
	}
	scope.RecordOutput("s1", map[string]any{"n": 1})
	ctx := scope.Context()
	scope.RecordOutput("s2", map[string]any{"n": 2})
	scope.SetVar("v", "x")

	if _, ok := ctx.Steps["s2"]; ok {
		t.Fatalf("Context gained a Step recorded after it was taken")
	}
	if _, ok := ctx.Vars["v"]; ok {
		t.Fatalf("Context gained a variable set after it was taken")
	}
	if ctx.OnMissing != expressions.OnMissingError {
		t.Fatalf("OnMissing = %q, want %q", ctx.OnMissing, expressions.OnMissingError)
	}
}

func TestScopeSetTriggerReplacesTheFiredTrigger(t *testing.T) {
	scope, err := NewScope(nil)
	if err != nil {
		t.Fatalf("NewScope: %v", err)
	}
	scope.SetTrigger("first", map[string]any{"v": 1})
	scope.SetTrigger("second", map[string]any{"v": 2})
	ctx := scope.Context()
	if ctx.Trigger != "second" {
		t.Fatalf("Trigger = %q, want %q", ctx.Trigger, "second")
	}
	if _, ok := ctx.Triggers["first"]; ok {
		t.Fatalf("Triggers still holds the replaced Trigger")
	}
}

func TestNewScopeRefusesAHostFunctionShadowingACoreOne(t *testing.T) {
	core := expressions.CoreFunctions()
	host := expressions.Registry{"text.upper": core["text.upper"]}
	if _, err := NewScope(host); err == nil {
		t.Fatalf("NewScope accepted a Host function named text.upper")
	}
}

var shapeManifest = hatua.Manifest{
	Use: "data.shape",
	Fields: []hatua.Field{
		{K: "label", Kind: "text"},
		{K: "limit", Kind: "number"},
		{K: "source", Kind: "ref"},
		{K: "entries", Kind: "map"},
		{K: "enabled", Kind: "bool"},
	},
}

func TestScopeResolveStepTypesFieldsByTheManifest(t *testing.T) {
	scope := populatedScope(t)
	step := hatua.Step{ID: "shape", Use: "data.shape", With: map[string]any{
		"label":  "{{steps.s1.total}}",
		"limit":  "",
		"source": "{{steps.s1.tags}}",
		"entries": []any{
			map[string]any{"key": "who", "value": "{{triggers.form.name}}", "type": "text"},
			map[string]any{"key": "n", "value": "{{params.limit}}", "type": "number"},
			"malformed",
		},
		"enabled": "{{not a template}}",
		"extra":   "{{undeclared}}",
	}}

	got, err := scope.ResolveStep(step, shapeManifest)
	if err != nil {
		t.Fatalf("ResolveStep: %v", err)
	}
	want := map[string]any{
		"label":   "42",
		"limit":   nil,
		"source":  []any{"a", "b"},
		"entries": map[string]any{"who": "Ada", "n": float64(10)},
		"enabled": "{{not a template}}",
		"extra":   "{{undeclared}}",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ResolveStep =\n%#v\nwant\n%#v", got, want)
	}
	if _, isList := step.With["entries"].([]any); !isList {
		t.Fatal("ResolveStep modified the Step's with: map")
	}
}

func TestScopeResolveStepErrorsNameTheSlot(t *testing.T) {
	scope := populatedScope(t)
	step := hatua.Step{ID: "shape", Use: "data.shape", With: map[string]any{
		"limit": "{{triggers.form.name}}",
		"entries": []any{
			map[string]any{"key": "n", "value": "{{triggers.form.name}}", "type": "number"},
		},
	}}

	got, err := scope.ResolveStep(step, shapeManifest)
	if got != nil || err == nil {
		t.Fatalf("ResolveStep = %#v, %v; want only an error", got, err)
	}
	var fields []string
	collectTemplateErrors(t, err, &fields)
	if want := []string{"entries.n", "limit"}; !reflect.DeepEqual(fields, want) {
		t.Fatalf("failing fields = %v, want %v", fields, want)
	}
}
