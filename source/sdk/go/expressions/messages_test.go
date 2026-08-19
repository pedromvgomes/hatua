package expressions

import "testing"

// Message *text*, which the conformance corpus deliberately does not assert —
// it compares codes and severities, so two runtimes can agree on a code while
// explaining it differently. errors.go says the wording has to match, because a
// message that reads one way in the builder and another in a runner's logs is a
// support ticket nobody can close, and these are the cases where the two
// implementations reach the same code by different routes.
//
// The TypeScript half is packages/expressions/src/messages.test.ts.

func messageOf(t *testing.T, template string, expected ValueType) string {
	t.Helper()
	_, err := Resolve(
		Context{Functions: CoreFunctions()},
		Slot{Name: "f", Template: template, ExpectedType: expected},
	)
	if err == nil {
		return "did not fail"
	}
	return err.Error()
}

func TestDiagnosticMessagesMatch(t *testing.T) {
	for _, tc := range []struct{ name, template, expected string }{
		{
			// The decoder refuses this up front; JSON.parse yields Infinity and
			// TypeScript catches it afterwards. Different routes, one message.
			name:     "an out-of-range JSON number",
			template: `{{ json.parse('{"n":1e400}') }}`,
			expected: "json.parse cannot accept a number out of range for value.",
		},
		{
			name:     "text that is not JSON at all",
			template: `{{ json.parse('not json') }}`,
			expected: "json.parse cannot accept text that is not JSON for value.",
		},
		{
			name:     "an arity range",
			template: `{{ text.slice('abc') }}`,
			expected: "text.slice takes 2 to 3 arguments, not 1.",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := messageOf(t, tc.template, TypeUnknown); got != tc.expected {
				t.Fatalf("\n  expected %q\n  got      %q", tc.expected, got)
			}
		})
	}
}

func TestArityMessageMatchesAcrossPhases(t *testing.T) {
	found := Validate(`{{ text.slice('abc') }}`, TypeText, CheckContext{Functions: CoreFunctions()})
	if len(found) != 1 {
		t.Fatalf("expected one diagnostic, got %#v", found)
	}
	expected := "text.slice takes 2 to 3 arguments, not 1."
	if found[0].Message != expected {
		t.Fatalf("\n  expected %q\n  got      %q", expected, found[0].Message)
	}

	variadic := Validate("{{ num.min() }}", TypeNumber, CheckContext{Functions: CoreFunctions()})
	if len(variadic) != 1 || variadic[0].Message != "num.min takes at least 1 arguments, not 0." {
		t.Fatalf("unexpected variadic message: %#v", variadic)
	}
}
