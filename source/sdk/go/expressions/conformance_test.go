package expressions

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"

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
	Name     string  `yaml:"name"`
	Expr     *string `yaml:"expr"`
	Template *string `yaml:"template"`
	Sexp     string  `yaml:"sexp"`
	Error    string  `yaml:"error"`
	Offsets  bool    `yaml:"offsets"`
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
