package hatua

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The Go half of the shared conformance corpus. packages/schema runs the same
// files against zod; a fixture passing in one language and failing in the other
// is exactly the divergence this corpus exists to catch.
//
// Generation guarantees the two sides share a shape. Only this guarantees they
// share behaviour.

func corpus(t *testing.T, dir string) []string {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join("..", "..", "conformance", dir, "*.yaml"))
	if err != nil {
		t.Fatalf("globbing %s: %v", dir, err)
	}
	if len(paths) == 0 {
		// A glob matching nothing would make every subtest vacuously pass.
		t.Fatalf("no fixtures found in conformance/%s", dir)
	}
	return paths
}

func read(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	return data
}

func TestDefinitionValid(t *testing.T) {
	for _, path := range corpus(t, "definition/valid") {
		t.Run(filepath.Base(path), func(t *testing.T) {
			if _, err := LoadDefinition(read(t, path)); err != nil {
				t.Fatalf("expected %s to be accepted, got: %v", filepath.Base(path), err)
			}
		})
	}
}

func TestDefinitionInvalid(t *testing.T) {
	for _, path := range corpus(t, "definition/invalid") {
		t.Run(filepath.Base(path), func(t *testing.T) {
			data := read(t, path)
			// The expectation travels in the fixture, so the two cannot drift.
			if !strings.Contains(string(data), "# expect: SCHEMA_INVALID") {
				t.Fatalf("%s is missing its `# expect:` header", filepath.Base(path))
			}
			if _, err := LoadDefinition(data); err == nil {
				t.Fatalf("expected %s to be rejected, but it parsed clean", filepath.Base(path))
			}
		})
	}
}

func TestExecution(t *testing.T) {
	for _, path := range corpus(t, "execution") {
		t.Run(filepath.Base(path), func(t *testing.T) {
			run, err := LoadExecution(read(t, path))
			if err != nil {
				t.Fatalf("expected %s to be accepted, got: %v", filepath.Base(path), err)
			}
			// An execution references its definition; it never embeds one.
			if run.Workflow.Version < 1 {
				t.Fatalf("expected a definition version reference, got %d", run.Workflow.Version)
			}
		})
	}
}

func TestManifest(t *testing.T) {
	for _, path := range corpus(t, "manifest") {
		t.Run(filepath.Base(path), func(t *testing.T) {
			manifests, err := LoadManifests(read(t, path))
			if err != nil {
				t.Fatalf("expected %s to be accepted, got: %v", filepath.Base(path), err)
			}
			if len(manifests) == 0 {
				t.Fatal("expected at least one manifest")
			}
			for _, m := range manifests {
				for _, o := range m.Outputs {
					// Labels are required on outputs, not just fields — the
					// reference tree shows them to users.
					if o.Label == "" {
						t.Fatalf("output %q in %q has no label", o.K, m.Use)
					}
				}
			}
		})
	}
}

func TestLoopIterationsSurviveRoundTrip(t *testing.T) {
	run, err := LoadExecution(read(t, filepath.Join("..", "..", "conformance", "execution", "loop-iterations.yaml")))
	if err != nil {
		t.Fatalf("loading: %v", err)
	}

	var loop *StepRun
	for i := range run.Steps {
		if len(run.Steps[i].Iterations) > 0 {
			loop = &run.Steps[i]
			break
		}
	}
	if loop == nil {
		t.Fatal("expected a step carrying per-iteration records")
	}
	if len(loop.Iterations) != 2 {
		t.Fatalf("expected 2 iterations, got %d", len(loop.Iterations))
	}
	// The whole point of the nested shape: one pass succeeded, another failed.
	if loop.Iterations[0].Status != StepSucceeded || loop.Iterations[1].Status != StepFailed {
		t.Fatalf("expected succeeded then failed, got %s then %s",
			loop.Iterations[0].Status, loop.Iterations[1].Status)
	}
	if loop.Iterations[0].Steps[0].Metadata["tokens"] != 1000 {
		t.Fatalf("expected per-iteration metadata to survive, got %v",
			loop.Iterations[0].Steps[0].Metadata["tokens"])
	}
}
