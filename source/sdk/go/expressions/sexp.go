package expressions

import (
	"fmt"
	"strings"
)

// The AST as an S-expression.
//
// Parse scenarios have to assert on tree *shape* — precedence and
// associativity are the bugs they exist to catch — and a nested YAML literal of
// the whole node graph is unreadable enough that nobody would notice it
// asserting the wrong thing. `(- (- 1 2) 3)` says "folds left" at a glance.
//
// This is a contract, not a convenience: packages/expressions/src/sexp.ts must
// print the same string for the same source, and the shared scenarios are what
// check that it does.

// SexpOptions controls the rendering. Offsets appends `@offset` to every node;
// only the offset scenarios ask for it.
type SexpOptions struct {
	Offsets bool
}

// TemplateToSexp renders a whole Template.
func TemplateToSexp(template *Template, options SexpOptions) string {
	if len(template.Segments) == 0 {
		return "(template)"
	}
	parts := make([]string, 0, len(template.Segments))
	for _, segment := range template.Segments {
		parts = append(parts, segmentToSexp(segment, options))
	}
	return "(template " + strings.Join(parts, " ") + ")"
}

func segmentToSexp(segment Segment, options SexpOptions) string {
	switch s := segment.(type) {
	case *Text:
		return "(text " + quoteSexp(s.Value) + ")"
	case *Hole:
		return "(hole" + mark(s.At, options) + " " + ToSexp(s.Expr, options) + ")"
	}
	return "(unknown)"
}

// ToSexp renders one Expression.
func ToSexp(node Expression, options SexpOptions) string {
	at := mark(node.Offset(), options)
	nested := func(child Expression) string { return ToSexp(child, options) }

	switch n := node.(type) {
	case *Name:
		return n.Name + at
	case *Literal:
		return literalToSexp(n) + at
	case *Member:
		return "(." + at + " " + nested(n.Object) + " " + n.Name + ")"
	case *Index:
		return "([]" + at + " " + nested(n.Object) + " " + nested(n.Index) + ")"
	case *Project:
		return "(project" + at + " " + nested(n.Object) + ")"
	case *Call:
		parts := []string{nested(n.Object)}
		for _, arg := range n.Args {
			parts = append(parts, nested(arg))
		}
		return "(call" + at + " " + strings.Join(parts, " ") + ")"
	case *Unary:
		op := n.Op
		if op == "-" {
			op = "neg"
		}
		return "(" + op + at + " " + nested(n.Operand) + ")"
	case *Binary:
		return "(" + n.Op + at + " " + nested(n.Left) + " " + nested(n.Right) + ")"
	case *Ternary:
		return "(?:" + at + " " + nested(n.Cond) + " " + nested(n.WhenTrue) + " " + nested(n.WhenFalse) + ")"
	}
	return "(unknown)"
}

func mark(at int, options SexpOptions) string {
	if !options.Offsets {
		return ""
	}
	return fmt.Sprintf("@%d", at)
}

func literalToSexp(literal *Literal) string {
	switch literal.Kind {
	case LiteralText:
		return quoteSexp(literal.Value.(string))
	case LiteralNumber:
		return NumberToText(literal.Value.(float64))
	case LiteralBoolean:
		if literal.Value.(bool) {
			return "true"
		}
		return "false"
	}
	return "null"
}

// quoteSexp is deliberately minimal, and identical in TypeScript: backslash,
// quote and the three whitespace escapes, so a scenario expectation always fits
// on one line.
func quoteSexp(value string) string {
	replacer := strings.NewReplacer(
		`\`, `\\`,
		`"`, `\"`,
		"\n", `\n`,
		"\r", `\r`,
		"\t", `\t`,
	)
	return `"` + replacer.Replace(value) + `"`
}
