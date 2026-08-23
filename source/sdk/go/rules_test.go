package hatua

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// The definition rules, held against the corpus TypeScript runs.
//
// packages/model/src/rules.conformance.test.ts reads the same files and renders
// each diagnostic the same way. These rules are cross-field and
// manifest-dependent, none is expressible in JSON Schema, each is implemented
// once per language, and this corpus is the only thing keeping the two saying
// the same thing about the same document.

type ruleExpectation struct {
	Code      string `yaml:"code"`
	Blocks    string `yaml:"blocks"`
	StepID    string `yaml:"stepId"`
	TriggerID string `yaml:"triggerId"`
	BlockID   string `yaml:"blockId"`
	FieldKey  string `yaml:"fieldKey"`
}

type ruleScenario struct {
	Name       string            `yaml:"name"`
	Definition Definition        `yaml:"definition"`
	Manifests  []Manifest        `yaml:"manifests"`
	Expect     []ruleExpectation `yaml:"expect"`
}

type ruleCorpus struct {
	Manifests []Manifest     `yaml:"manifests"`
	Scenarios []ruleScenario `yaml:"scenarios"`
}

// render is one diagnostic as one comparable line, matching the TypeScript
// harness field for field. Absent subjects render empty.
func render(code, blocks, step, trigger, block, field string) string {
	return strings.Join([]string{code, blocks, step, trigger, block, field}, "|")
}

func TestDefinitionRules(t *testing.T) {
	dir := filepath.Join("..", "..", "conformance", "definition", "rules")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("reading %s: %v", dir, err)
	}

	files := 0
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".yaml") {
			continue
		}
		files++

		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			t.Fatalf("reading %s: %v", entry.Name(), err)
		}

		var corpus ruleCorpus
		// KnownFields off: the corpus carries prose (`about:`) the harnesses do
		// not read, and a scenario may state only the subjects it checks.
		if err := yaml.Unmarshal(data, &corpus); err != nil {
			t.Fatalf("parsing %s: %v", entry.Name(), err)
		}

		t.Run(entry.Name(), func(t *testing.T) {
			for _, scenario := range corpus.Scenarios {
				t.Run(scenario.Name, func(t *testing.T) {
					manifests := scenario.Manifests
					if manifests == nil {
						manifests = corpus.Manifests
					}

					found := ValidateDefinition(scenario.Definition, manifests).All

					got := make([]string, 0, len(found))
					for _, d := range found {
						got = append(got, render(
							string(d.Code), string(d.Blocks),
							d.StepID, d.TriggerID, d.BlockID, d.FieldKey,
						))
					}
					want := make([]string, 0, len(scenario.Expect))
					for _, e := range scenario.Expect {
						want = append(want, render(
							e.Code, e.Blocks,
							e.StepID, e.TriggerID, e.BlockID, e.FieldKey,
						))
					}
					sort.Strings(got)
					sort.Strings(want)

					if len(got) != len(want) {
						t.Fatalf("expected %v, got %v", want, got)
					}
					for i := range want {
						if got[i] != want[i] {
							t.Fatalf("expected %v, got %v", want, got)
						}
					}
				})
			}
		})
	}

	if files == 0 {
		t.Fatalf("no rule scenarios found in %s", dir)
	}
}
