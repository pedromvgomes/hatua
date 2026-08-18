package expressions

import "testing"

// The smoke test. It exists so `make build` has something to verify against
// from the very first generation — the whole point of generate → verify →
// promote is that the destination is only ever written by output that passed,
// and that is only true if a suite exists before the parser does.
//
// The real coverage lives in the shared scenarios under
// conformance/expression/, which run against TypeScript too.

func TestParseTemplateLiteralText(t *testing.T) {
	template, err := ParseTemplate("hello")
	if err != nil {
		t.Fatalf("parsing: %v", err)
	}
	if len(template.Segments) != 1 {
		t.Fatalf("expected one segment, got %d", len(template.Segments))
	}
	text, ok := template.Segments[0].(*Text)
	if !ok || text.Value != "hello" {
		t.Fatalf("expected literal text, got %#v", template.Segments[0])
	}
}

func TestParseTemplateHoleOffset(t *testing.T) {
	template, err := ParseTemplate("{{ s2.count }}")
	if err != nil {
		t.Fatalf("parsing: %v", err)
	}
	hole, ok := template.Segments[0].(*Hole)
	if !ok {
		t.Fatalf("expected a hole, got %#v", template.Segments[0])
	}
	if hole.At != 3 {
		t.Fatalf("expected the hole to start at 3, got %d", hole.At)
	}
	if _, ok := hole.Expr.(*Member); !ok {
		t.Fatalf("expected a member access, got %#v", hole.Expr)
	}
}

// `{{ '{{' }}` is not special-cased anywhere: it is a hole holding a text
// literal, and it falls out of the grammar.
func TestParseTemplateEscapedBraces(t *testing.T) {
	template, err := ParseTemplate("{{ '{{' }}")
	if err != nil {
		t.Fatalf("parsing: %v", err)
	}
	hole := template.Segments[0].(*Hole)
	literal, ok := hole.Expr.(*Literal)
	if !ok || literal.Kind != LiteralText || literal.Value != "{{" {
		t.Fatalf("expected the text literal `{{`, got %#v", hole.Expr)
	}
}

func TestParseTemplateUnclosedHole(t *testing.T) {
	if _, err := ParseTemplate("unclosed {{ a"); err == nil {
		t.Fatal("expected an unclosed hole to be refused")
	}
}

func TestParseExpressionPrecedence(t *testing.T) {
	expr, err := ParseExpression("1 + 2 * 3")
	if err != nil {
		t.Fatalf("parsing: %v", err)
	}
	sum, ok := expr.(*Binary)
	if !ok || sum.Op != "+" {
		t.Fatalf("expected `+` at the root, got %#v", expr)
	}
	product, ok := sum.Right.(*Binary)
	if !ok || product.Op != "*" {
		t.Fatalf("expected `*` bound tighter, got %#v", sum.Right)
	}
}

func TestParseExpressionAssociativity(t *testing.T) {
	expr, err := ParseExpression("1 - 2 - 3")
	if err != nil {
		t.Fatalf("parsing: %v", err)
	}
	outer := expr.(*Binary)
	if _, ok := outer.Left.(*Binary); !ok {
		t.Fatalf("expected `-` to fold left, got %#v", outer)
	}

	conditional, err := ParseExpression("a ? b : c ? d : e")
	if err != nil {
		t.Fatalf("parsing: %v", err)
	}
	if _, ok := conditional.(*Ternary).WhenFalse.(*Ternary); !ok {
		t.Fatal("expected the conditional to fold right")
	}
}
