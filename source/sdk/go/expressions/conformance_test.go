package expressions

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"gopkg.in/yaml.v3"
)

// The Go half of the shared expression corpus.
//
// packages/expressions/src/conformance.test.ts loads the same files. A scenario
// counted by one harness and skipped by the other is exactly the divergence
// this corpus exists to catch, so both write their tally where
// tools/expression/harness can compare them.

const corpusRoot = "../../../conformance/expression"

var counted int

type parseScenario struct {
	Name      string  `yaml:"name"`
	Expr      *string `yaml:"expr"`
	Template  *string `yaml:"template"`
	Sexp      string  `yaml:"sexp"`
	Error     string  `yaml:"error"`
	Offsets   bool    `yaml:"offsets"`
	Reference *any    `yaml:"reference"`
}

type parseFile struct {
	Scenarios []parseScenario `yaml:"scenarios"`
}

// scenarioFiles lists one kind's files, refusing an empty directory: a glob
// matching nothing would make every subtest vacuously pass.
func scenarioFiles(t *testing.T, kind string) []string {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join(corpusRoot, kind, "*.yaml"))
	if err != nil {
		t.Fatalf("globbing %s: %v", kind, err)
	}
	if len(paths) == 0 {
		t.Fatalf("no scenarios in conformance/expression/%s", kind)
	}
	sort.Strings(paths)
	return paths
}

func loadScenarios(t *testing.T, path string, into any) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	if err := yaml.Unmarshal(data, into); err != nil {
		t.Fatalf("parsing %s: %v", path, err)
	}
}

func TestConformanceParse(t *testing.T) {
	for _, path := range scenarioFiles(t, "parse") {
		var file parseFile
		loadScenarios(t, path, &file)
		if len(file.Scenarios) == 0 {
			t.Fatalf("%s declares no scenarios", filepath.Base(path))
		}

		t.Run(filepath.Base(path), func(t *testing.T) {
			for _, scenario := range file.Scenarios {
				counted++
				t.Run(scenario.Name, func(t *testing.T) {
					actual, err := renderScenario(scenario)

					if scenario.Error != "" {
						if err == nil {
							t.Fatalf("expected this to be refused, got %s", actual)
						}
						failure, ok := err.(*Error)
						if !ok || string(failure.Code()) != scenario.Error {
							t.Fatalf("expected %s, got %v", scenario.Error, err)
						}
						return
					}

					if err != nil {
						t.Fatalf("parsing: %v", err)
					}
					if actual != scenario.Sexp {
						t.Fatalf("\n  expected %s\n  got      %s", scenario.Sexp, actual)
					}

					if scenario.Reference != nil && scenario.Template != nil {
						want := ""
						if path, ok := (*scenario.Reference).(string); ok {
							want = path
						}
						if got := SourceReference(*scenario.Template); got != want {
							t.Fatalf("expected reference %q, got %q", want, got)
						}
					}
				})
			}
		})
	}
}

func renderScenario(scenario parseScenario) (string, error) {
	options := SexpOptions{Offsets: scenario.Offsets}

	if scenario.Template != nil {
		template, err := ParseTemplate(*scenario.Template)
		if err != nil {
			return "", err
		}
		return TemplateToSexp(template, options), nil
	}
	if scenario.Expr != nil {
		expr, err := ParseExpression(*scenario.Expr)
		if err != nil {
			return "", err
		}
		return ToSexp(expr, options), nil
	}
	return "", errNoSource
}

var errNoSource = &Error{Diagnostics: []Diagnostic{{
	Message: "scenario needs either `expr` or `template`",
}}}

type slotScenario struct {
	Name     string `yaml:"name"`
	Template string `yaml:"template"`
	Type     string `yaml:"type"`
}

type errorExpectation struct {
	Slot string `yaml:"slot"`
	Code string `yaml:"code"`
}

type evalScenario struct {
	Name string `yaml:"name"`
	// One Slot, the common case.
	Template string `yaml:"template"`
	Type     string `yaml:"type"`
	Value    any    `yaml:"value"`
	Error    string `yaml:"error"`
	// At is where the failure points. Asserted only when the scenario says so.
	At *int `yaml:"at"`
	// Several Slots, resolved together by ResolveAll.
	Slots     []slotScenario     `yaml:"slots"`
	Values    map[string]any     `yaml:"values"`
	Errors    []errorExpectation `yaml:"errors"`
	OnMissing string             `yaml:"on_missing"`
	Now       string             `yaml:"now"`
	Context   map[string]any     `yaml:"context"`
}

type evalFile struct {
	Scenarios []evalScenario `yaml:"scenarios"`
}

func TestConformanceEval(t *testing.T) {
	functions := CoreFunctions()

	for _, path := range scenarioFiles(t, "eval") {
		var file evalFile
		loadScenarios(t, path, &file)
		if len(file.Scenarios) == 0 {
			t.Fatalf("%s declares no scenarios", filepath.Base(path))
		}

		t.Run(filepath.Base(path), func(t *testing.T) {
			for _, scenario := range file.Scenarios {
				counted++
				t.Run(scenario.Name, func(t *testing.T) {
					ctx := scenarioContext(t, scenario)
					ctx.Functions = functions

					if scenario.Slots != nil {
						checkResolveAll(t, scenario, ctx)
						return
					}

					slot := Slot{
						Name:         "field",
						Template:     scenario.Template,
						ExpectedType: slotType(scenario.Type),
					}
					value, err := Resolve(ctx, slot)

					if scenario.Error != "" {
						failure, ok := err.(*Error)
						if !ok {
							t.Fatalf("expected %s, got value %v (err %v)", scenario.Error, value, err)
						}
						if string(failure.Code()) != scenario.Error {
							t.Fatalf("expected %s, got %s (%v)", scenario.Error, failure.Code(), err)
						}
						// Every evaluation failure names the slot it happened in: the
						// Host decides what to do about it, and cannot without being
						// told where.
						if failure.Diagnostics[0].Slot != "field" {
							t.Fatalf("expected the diagnostic to name its slot, got %q",
								failure.Diagnostics[0].Slot)
						}
						if scenario.At != nil && failure.Diagnostics[0].At != *scenario.At {
							t.Fatalf("expected the failure at offset %d, got %d",
								*scenario.At, failure.Diagnostics[0].At)
						}
						return
					}

					if err != nil {
						t.Fatalf("resolving: %v", err)
					}
					if actual, want := canon(value), canon(decodeValue(scenario.Value)); actual != want {
						t.Fatalf("\n  expected %s\n  got      %s", want, actual)
					}
				})
			}
		})
	}
}

func slotType(declared string) ValueType {
	if declared == "" {
		return TypeText
	}
	return ValueType(declared)
}

// checkResolveAll pins the behaviour of resolving a whole `with:` map at once.
//
// What matters across languages is that it reports *every* failure rather than
// stopping at the first — a user fixing one field at a time is a user running
// the workflow five times to find five mistakes.
func checkResolveAll(t *testing.T, scenario evalScenario, ctx Context) {
	t.Helper()

	slots := make([]Slot, 0, len(scenario.Slots))
	for _, declared := range scenario.Slots {
		slots = append(slots, Slot{
			Name:         declared.Name,
			Template:     declared.Template,
			ExpectedType: slotType(declared.Type),
		})
	}

	values, err := ResolveAll(ctx, slots)

	if scenario.Errors != nil {
		failure, ok := err.(*Error)
		if !ok {
			t.Fatalf("expected failures, got %v (err %v)", values, err)
		}
		actual := make([]string, 0, len(failure.Diagnostics))
		for _, d := range failure.Diagnostics {
			actual = append(actual, d.Slot+":"+string(d.Code))
		}
		want := make([]string, 0, len(scenario.Errors))
		for _, expected := range scenario.Errors {
			want = append(want, expected.Slot+":"+expected.Code)
		}
		if strings.Join(actual, " ") != strings.Join(want, " ") {
			t.Fatalf("\n  expected %v\n  got      %v", want, actual)
		}
		return
	}

	if err != nil {
		t.Fatalf("resolving: %v", err)
	}
	if len(values) != len(scenario.Values) {
		t.Fatalf("expected %d values, got %d", len(scenario.Values), len(values))
	}
	for name, expected := range scenario.Values {
		if actual, want := canon(values[name]), canon(decodeValue(expected)); actual != want {
			t.Fatalf("%s:\n  expected %s\n  got      %s", name, want, actual)
		}
	}
}

func scenarioContext(t *testing.T, scenario evalScenario) Context {
	t.Helper()

	ctx := Context{OnMissing: OnMissingError}
	if scenario.OnMissing == "null" {
		ctx.OnMissing = OnMissingNull
	}
	if scenario.Now != "" {
		parsed, err := time.Parse(time.RFC3339, scenario.Now)
		if err != nil {
			t.Fatalf("%s: bad clock %q", scenario.Name, scenario.Now)
		}
		ctx.Now = &parsed
	}

	for key, raw := range scenario.Context {
		switch key {
		case "steps":
			ctx.Steps = decodeValue(raw).(map[string]Value)
		case "triggers":
			ctx.Triggers = decodeValue(raw).(map[string]Value)
		case "var":
			ctx.Vars = decodeValue(raw).(map[string]Value)
		case "run":
			ctx.Run = decodeValue(raw).(map[string]Value)
		case "TRIGGER":
			ctx.Trigger = raw.(string)
		default:
			t.Fatalf("%s: unknown context key %q", scenario.Name, key)
		}
	}
	return ctx
}

// decodeValue turns what YAML produced into the value space: every number is a
// float64, and `{ $datetime: … }` is how a scenario writes an instant YAML
// cannot.
func decodeValue(raw any) Value {
	switch value := raw.(type) {
	case int:
		return float64(value)
	case int64:
		return float64(value)
	case []any:
		out := make([]Value, 0, len(value))
		for _, item := range value {
			out = append(out, decodeValue(item))
		}
		return out
	case map[string]any:
		if marker, ok := value["$datetime"].(string); ok && len(value) == 1 {
			parsed, err := time.Parse(time.RFC3339, marker)
			if err != nil {
				return nil
			}
			return parsed.UTC().Truncate(time.Millisecond)
		}
		out := make(map[string]Value, len(value))
		for key, item := range value {
			out[key] = decodeValue(item)
		}
		return out
	}
	return raw
}

// canon renders a value so an expectation compares the same way in both
// languages. Deliberately not the evaluator's own Equals: a bug there would
// then hide itself.
func canon(value Value) string {
	switch v := value.(type) {
	case nil:
		return "null"
	case bool:
		if v {
			return "true"
		}
		return "false"
	case float64:
		return NumberToText(v)
	case string:
		return strconv.Quote(v)
	case time.Time:
		return "@" + DatetimeToText(v)
	case []Value:
		parts := make([]string, 0, len(v))
		for _, item := range v {
			parts = append(parts, canon(item))
		}
		return "[" + strings.Join(parts, ",") + "]"
	case map[string]Value:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			parts = append(parts, strconv.Quote(key)+":"+canon(v[key]))
		}
		return "{" + strings.Join(parts, ",") + "}"
	}
	return "?"
}

type diagnosticExpectation struct {
	Code     string `yaml:"code"`
	Severity string `yaml:"severity"`
}

type diagnosticScenario struct {
	Name     string                  `yaml:"name"`
	Template string                  `yaml:"template"`
	Type     string                  `yaml:"type"`
	Scope    []ScopeEntry            `yaml:"scope"`
	Expect   []diagnosticExpectation `yaml:"expect"`
}

type diagnosticFile struct {
	Scenarios []diagnosticScenario `yaml:"scenarios"`
}

func TestConformanceDiagnostics(t *testing.T) {
	functions := CoreFunctions()

	for _, path := range scenarioFiles(t, "diagnostics") {
		var file diagnosticFile
		loadScenarios(t, path, &file)
		if len(file.Scenarios) == 0 {
			t.Fatalf("%s declares no scenarios", filepath.Base(path))
		}

		t.Run(filepath.Base(path), func(t *testing.T) {
			for _, scenario := range file.Scenarios {
				counted++
				t.Run(scenario.Name, func(t *testing.T) {
					expected := TypeText
					if scenario.Type != "" {
						expected = ValueType(scenario.Type)
					}

					found := Validate(scenario.Template, expected, CheckContext{
						Scope:     scenario.Scope,
						Functions: functions,
					})

					// Codes *and* severities. A code that errors here and warns
					// in TypeScript would let a workflow publish from one
					// builder and not another.
					actual := make([]string, 0, len(found))
					for _, d := range found {
						actual = append(actual, string(d.Code)+":"+string(d.Severity))
					}
					want := make([]string, 0, len(scenario.Expect))
					for _, d := range scenario.Expect {
						want = append(want, d.Code+":"+d.Severity)
					}
					sort.Strings(actual)
					sort.Strings(want)

					if strings.Join(actual, " ") != strings.Join(want, " ") {
						t.Fatalf("\n  expected %v\n  got      %v", want, actual)
					}
				})
			}
		})
	}
}

// TestMain writes the tally the cross-language harness compares. Ordinary `go
// test` runs are unaffected: with the variable unset it does nothing.
func TestMain(m *testing.M) {
	code := m.Run()
	if path := os.Getenv("HATUA_SCENARIO_COUNT_FILE"); path != "" {
		tally, _ := json.Marshal(map[string]any{"language": "go", "scenarios": counted})
		_ = os.WriteFile(path, tally, 0o644)
	}
	os.Exit(code)
}
