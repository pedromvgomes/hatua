package expressions

import (
	"sync"
	"testing"
	"time"

	"gopkg.in/yaml.v3"
)

// Three things the shared corpus cannot reach.
//
// The scenario harness decodes YAML into the value space itself, so it can never
// hand the evaluator an `int`; concurrency has no expression to write it as; and
// a Host-supplied instant with nanosecond precision is not something a scenario
// file can spell.

// A Host feeding decoded YAML straight in is the ordinary case — this SDK's own
// LoadDefinition produces `int` for `count: 24`. Before Normalize, TypeOf
// reported that as `object` and AsText rendered it as "null": a silent wrong
// answer rather than a loud failure.
func TestDecodedYAMLIsNormalizedIntoTheValueSpace(t *testing.T) {
	var decoded map[string]Value
	if err := yaml.Unmarshal([]byte("count: 24\nratio: 0.5\nids: [1, 2]\nmeta: {n: 3}\n"), &decoded); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	if _, isInt := decoded["count"].(int); !isInt {
		t.Fatal("expected the YAML decoder to produce an int, which is the whole premise")
	}

	ctx := Context{Steps: map[string]Value{"s2": decoded}, Functions: CoreFunctions()}

	for _, tc := range []struct{ template, expected string }{
		{"{{ steps.s2.count }}", "24"},
		{"{{ steps.s2.count + 1 }}", "25"},
		{"Hi {{ steps.s2.count }}", "Hi 24"},
		{"{{ steps.s2.ratio }}", "0.5"},
		{"{{ list.len(steps.s2.ids) }}", "2"},
		{"{{ list.join(steps.s2.ids, ',') }}", "1,2"},
		{"{{ steps.s2.meta.n + 1 }}", "4"},
		{"{{ json.stringify(steps.s2.meta) }}", `{"n":3}`},
	} {
		value, err := Resolve(ctx, Slot{Name: "f", Template: tc.template, ExpectedType: TypeText})
		if err != nil {
			t.Fatalf("%s: %v", tc.template, err)
		}
		if value != tc.expected {
			t.Fatalf("%s:\n  expected %q\n  got      %v", tc.template, tc.expected, value)
		}
	}
}

func TestDecodedIntegersCompareAsNumbers(t *testing.T) {
	var decoded map[string]Value
	if err := yaml.Unmarshal([]byte("count: 24\n"), &decoded); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	ctx := Context{Steps: map[string]Value{"s2": decoded}, Functions: CoreFunctions()}

	value, err := Resolve(ctx, Slot{Name: "when", Template: "{{ steps.s2.count > 0 }}", ExpectedType: TypeBoolean})
	if err != nil {
		t.Fatalf("resolving: %v", err)
	}
	if value != true {
		t.Fatalf("expected a decoded integer to order as a number, got %v", value)
	}
}

// A Host puts time.Now() into the Context, which carries nanoseconds. A Date
// cannot, so rendering has to truncate — otherwise the two runtimes print
// different text for the same instant, and the "millisecond precision"
// invariant holds only for instants Hatua itself created.
func TestHostSuppliedInstantsRenderAtMillisecondPrecision(t *testing.T) {
	instant := time.Date(2026, 8, 18, 7, 0, 0, 123456789, time.UTC)
	ctx := Context{
		Steps:     map[string]Value{"s2": map[string]Value{"at": instant}},
		Functions: CoreFunctions(),
	}

	for _, template := range []string{"{{ steps.s2.at }}", "{{ dt.iso(steps.s2.at) }}", "at {{ steps.s2.at }}"} {
		value, err := Resolve(ctx, Slot{Name: "f", Template: template, ExpectedType: TypeText})
		if err != nil {
			t.Fatalf("%s: %v", template, err)
		}
		expected := "2026-08-18T07:00:00.123Z"
		if template == "at {{ steps.s2.at }}" {
			expected = "at " + expected
		}
		if value != expected {
			t.Fatalf("%s:\n  expected %q\n  got      %v", template, expected, value)
		}
	}
}

// A runner resolving two executions at once is the ordinary case. x/text is
// explicit that "a Caser may be stateful and should therefore not be shared
// between goroutines", so a package-level one would be a data race producing
// wrong-cased output rather than a crash. Run this with -race.
func TestCaseMappingIsSafeUnderConcurrency(t *testing.T) {
	ctx := Context{
		Steps:     map[string]Value{"s2": map[string]Value{"subject": "straße"}},
		Functions: CoreFunctions(),
	}

	var group sync.WaitGroup
	for range 64 {
		group.Add(1)
		go func() {
			defer group.Done()
			value, err := Resolve(ctx, Slot{
				Name:         "f",
				Template:     "{{ text.upper(steps.s2.subject) }}",
				ExpectedType: TypeText,
			})
			if err != nil || value != "STRASSE" {
				t.Errorf("expected STRASSE, got %v (err %v)", value, err)
			}
		}()
	}
	group.Wait()
}
