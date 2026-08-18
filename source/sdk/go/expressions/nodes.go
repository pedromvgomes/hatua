package expressions

import (
	"fmt"
	"strconv"
	"strings"
)

// The AST constructors the generated parser calls.
//
// Every action in expression.peg is exactly `return <helper>(...)`, which is
// what makes one action body simultaneously valid Go and valid JavaScript and
// is therefore what lets both parsers be generated from one grammar. All the
// per-language awkwardness — pigeon hands back []byte where Peggy hands back a
// string, sequences arrive as nested slices — is absorbed here, in a file whose
// TypeScript counterpart is packages/expressions/src/nodes.ts.
//
// Keep the two in step. A helper that builds a different shape on one side is a
// divergence the parse scenarios exist to catch, but only if it is caught.
//
// Every helper returns (any, error) because that is a pigeon action's
// signature: `return helper(x)` has to be a valid return statement.

func flatten(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case []byte:
		return string(v)
	case []any:
		var out strings.Builder
		for _, item := range v {
			out.WriteString(flatten(item))
		}
		return out.String()
	}
	return fmt.Sprint(value)
}

func list(value any) []any {
	if value == nil {
		return nil
	}
	if items, ok := value.([]any); ok {
		return items
	}
	return []any{value}
}

func offsetOfNode(node any) int {
	if expr, ok := node.(Expression); ok {
		return expr.Offset()
	}
	return 0
}

// str flattens whatever a match produced into a string. It stands in for
// Peggy's `$`, which pigeon has no equivalent of.
func str(parts ...any) (any, error) { return flatten(parts), nil }

func templateNode(segs any) (any, error) {
	template := &Template{Segments: []Segment{}}
	for _, item := range list(segs) {
		segment, ok := item.(Segment)
		if !ok {
			return nil, fmt.Errorf("unknown template segment %T", item)
		}
		template.Segments = append(template.Segments, segment)
	}
	return template, nil
}

func holeNode(at, expr any) (any, error) {
	return &Hole{At: at.(int), Expr: expr.(Expression)}, nil
}

func textNode(chars any) (any, error) {
	return &Text{Value: flatten(chars)}, nil
}

func ternaryNode(cond, tail any) (any, error) {
	parts := list(tail)
	// `( QMark Ternary Colon Ternary )?` — absent means this was not a ternary
	// at all, and the condition is the whole expression.
	if len(parts) == 0 {
		return cond, nil
	}
	return &Ternary{
		At:        offsetOfNode(cond),
		Cond:      cond.(Expression),
		WhenTrue:  parts[1].(Expression),
		WhenFalse: parts[3].(Expression),
	}, nil
}

// binaryNode folds `head ( op operand )*` left. PEG has no left recursion, so
// precedence is an explicit rule cascade and associativity is decided here —
// which is precisely why the parse scenarios are separate from the eval ones.
func binaryNode(head, tail any) (any, error) {
	node := head.(Expression)
	for _, item := range list(tail) {
		pair := list(item)
		node = &Binary{
			At:    node.Offset(),
			Op:    flatten(pair[0]),
			Left:  node,
			Right: pair[1].(Expression),
		}
	}
	return node, nil
}

func unaryNode(at, op, operand any) (any, error) {
	return &Unary{At: at.(int), Op: flatten(op), Operand: operand.(Expression)}, nil
}

// parenNode: parentheses group; they leave no node behind.
func parenNode(expr any) (any, error) { return expr, nil }

func postfixNode(base, suffixes any) (any, error) {
	node := base.(Expression)
	for _, suffix := range list(suffixes) {
		switch s := suffix.(type) {
		case *Member:
			s.Object = node
			node = s
		case *Index:
			s.Object = node
			node = s
		case *Project:
			s.Object = node
			node = s
		case *Call:
			s.Object = node
			node = s
		default:
			return nil, fmt.Errorf("unknown postfix suffix %T", suffix)
		}
	}
	return node, nil
}

func memberSuffix(at, name any) (any, error) {
	return &Member{At: at.(int), Name: flatten(name)}, nil
}

func projectSuffix(at any) (any, error) {
	return &Project{At: at.(int)}, nil
}

func indexSuffix(at, index any) (any, error) {
	return &Index{At: at.(int), Index: index.(Expression)}, nil
}

func callSuffix(at, args any) (any, error) {
	call := &Call{At: at.(int), Args: []Expression{}}
	for _, arg := range list(args) {
		call.Args = append(call.Args, arg.(Expression))
	}
	return call, nil
}

func argList(head, tail any) (any, error) {
	out := []any{head}
	for _, item := range list(tail) {
		out = append(out, list(item)[1])
	}
	return out, nil
}

func nameNode(at, name any) (any, error) {
	return &Name{At: at.(int), Name: flatten(name)}, nil
}

func nullNode(at any) (any, error) {
	return &Literal{At: at.(int), Kind: LiteralNull, Value: nil}, nil
}

func boolNode(at, value any) (any, error) {
	return &Literal{At: at.(int), Kind: LiteralBoolean, Value: flatten(value) == "true"}, nil
}

func numberNode(at, integer, frac, exp any) (any, error) {
	raw := flatten(integer) + flatten(frac) + flatten(exp)
	parsed, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return nil, err
	}
	return &Literal{At: at.(int), Kind: LiteralNumber, Value: parsed}, nil
}

func stringNode(at, chars any) (any, error) {
	return &Literal{At: at.(int), Kind: LiteralText, Value: flatten(chars)}, nil
}

var escapes = map[string]string{
	"n":  "\n",
	"t":  "\t",
	"r":  "\r",
	"\\": "\\",
	"'":  "'",
	"\"": "\"",
}

func escapeChar(char any) (any, error) {
	key := flatten(char)
	value, ok := escapes[key]
	// Deliberately loud. An unrecognised escape is far more likely to be a typo
	// than an intention, and silently yielding the character would hide it.
	if !ok {
		return nil, fmt.Errorf("unknown escape \\%s", key)
	}
	return value, nil
}
