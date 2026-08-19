package expressions

import "fmt"

// Design-time checking.
//
// Diagnostics never block editing. Errors block Publish; warnings inform and
// block nothing. Type checking is gradual — a known incompatibility is an
// error, an unknown type is a warning that defers to run time — because a
// checker that refuses everything it cannot prove is a checker people route
// around.
//
// The TypeScript half is packages/expressions/src/validate.ts, and the
// diagnostics scenarios assert on codes *and severities*: a code that errors
// there and warns here would let a workflow publish from one builder and not
// another.

// CheckContext is what a check needs beyond the template itself.
type CheckContext struct {
	// Scope is what this step may address. Sibling branches are deliberately
	// absent.
	Scope []ScopeEntry
	// Functions is Hatua's registry merged with the Host's.
	Functions Registry
}

// Validate checks one Template against the type its field declares.
//
// It returns everything it found. Callers decide what to do with it: the
// Inspector renders all of them, Publish looks only at the errors.
func Validate(template string, expectedType ValueType, ctx CheckContext) []Diagnostic {
	parsed, err := ParseTemplate(template)
	if err != nil {
		return err.(*Error).Diagnostics
	}

	found := []Diagnostic{}
	if single := singleHole(parsed); single != nil {
		result := walk(single, ctx, &found)
		// A broken expression has already said what is wrong with it. Adding
		// "and its type is unknown" on top would be noise about a consequence,
		// and it would make every unresolvable reference read as two problems.
		if result.kind != walkBroken {
			found = reportMatch(found, settleType(result), expectedType, single.Offset(), "this expression")
		}
		return found
	}

	// Mixed text can only be text, whatever the holes hold. This is what refuses
	// the legacy `when: "{{s2.count}} > 0"` at design time rather than letting a
	// runner mistake the string "24 > 0" for truth.
	for _, segment := range parsed.Segments {
		if hole, ok := segment.(*Hole); ok {
			walk(hole.Expr, ctx, &found)
		}
	}

	// A Template with no holes at all is text just as surely, so `when: "yes"`
	// and a `number` field holding "abc" are known conflicts. Only an *empty*
	// value is exempt: nothing was written, so there is nothing to type, and
	// whether the field may be left empty is `req:`'s business.
	if len(parsed.Segments) > 0 {
		found = reportMatch(found, TypeText, expectedType, 0, "this template")
	}
	return found
}

func reportMatch(found []Diagnostic, actual, declared ValueType, at int, name string) []Diagnostic {
	switch Match(actual, declared) {
	case VerdictMatches:
		return found
	case VerdictConflicts:
		return append(found, NewDiagnostic(CodeExprTypeMismatch, at, map[string]string{
			"name": name, "expected": string(declared), "actual": string(actual),
		}))
	}
	return append(found, NewDiagnostic(CodeExprTypeUnknown, at, map[string]string{
		"name": name, "expected": string(declared),
	}))
}

// ---- inference -------------------------------------------------------------

type walkKind string

const (
	walkValue     walkKind = "value"
	walkUnknown   walkKind = "unknown"
	walkPrefix    walkKind = "prefix"
	walkNamespace walkKind = "namespace"
	walkFunction  walkKind = "function"
	walkBroken    walkKind = "broken"
)

// walkResult is what an expression walks over, mid-path.
//
// walkPrefix exists because scope paths are dotted — `triggers.nightly` is one
// entry, not two — so `triggers` on its own is not yet a value. walkNamespace
// is the same idea for functions, and it is why namespaces need no reserved
// words: the `(` is what tells a call from a path.
type walkResult struct {
	kind      walkKind
	node      TypeNode
	projected bool
	path      string
	name      string
	spec      FunctionSpec
}

// InferType reports an expression's own type, or `unknown` when it cannot be
// determined statically.
func InferType(node Expression, ctx CheckContext, found *[]Diagnostic) ValueType {
	return settleType(walk(node, ctx, found))
}

func settleType(result walkResult) ValueType {
	if result.kind != walkValue {
		return TypeUnknown
	}
	if result.projected {
		return TypeList
	}
	return result.node.Type
}

func known(t ValueType) walkResult {
	return walkResult{kind: walkValue, node: TypeNode{Type: t}}
}

func walk(node Expression, ctx CheckContext, found *[]Diagnostic) walkResult {
	switch n := node.(type) {
	case *Literal:
		return known(ValueType(n.Kind))
	case *Name:
		return walkName(n, ctx, found)
	case *Member:
		return walkMember(n, ctx, found)
	case *Index:
		return walkIndex(n, ctx, found)
	case *Project:
		return walkProject(n, ctx, found)
	case *Call:
		return walkCall(n, ctx, found)
	case *Unary:
		return walkUnary(n, ctx, found)
	case *Binary:
		return walkBinary(n, ctx, found)
	case *Ternary:
		return walkTernary(n, ctx, found)
	}
	return walkResult{kind: walkBroken}
}

func scopeEntry(ctx CheckContext, path string) (ScopeEntry, bool) {
	for _, entry := range ctx.Scope {
		if entry.Path == path {
			return entry, true
		}
	}
	return ScopeEntry{}, false
}

func scopePrefix(ctx CheckContext, path string) bool {
	for _, entry := range ctx.Scope {
		if len(entry.Path) > len(path)+1 && entry.Path[:len(path)+1] == path+"." {
			return true
		}
	}
	return false
}

func walkName(node *Name, ctx CheckContext, found *[]Diagnostic) walkResult {
	if entry, ok := scopeEntry(ctx, node.Name); ok {
		return walkResult{kind: walkValue, node: entry.Type}
	}
	if scopePrefix(ctx, node.Name) {
		return walkResult{kind: walkPrefix, path: node.Name}
	}
	for qualified := range ctx.Functions {
		if len(qualified) > len(node.Name)+1 && qualified[:len(node.Name)+1] == node.Name+"." {
			return walkResult{kind: walkNamespace, name: node.Name}
		}
	}

	*found = append(*found, NewDiagnostic(CodeExprUnknownReference, node.At,
		map[string]string{"name": node.Name}))
	return walkResult{kind: walkBroken}
}

func walkMember(node *Member, ctx CheckContext, found *[]Diagnostic) walkResult {
	target := walk(node.Object, ctx, found)

	switch target.kind {
	case walkPrefix:
		path := target.path + "." + node.Name
		if entry, ok := scopeEntry(ctx, path); ok {
			return walkResult{kind: walkValue, node: entry.Type}
		}
		if scopePrefix(ctx, path) {
			return walkResult{kind: walkPrefix, path: path}
		}
		*found = append(*found, NewDiagnostic(CodeExprUnknownReference, node.At,
			map[string]string{"name": path}))
		return walkResult{kind: walkBroken}

	case walkNamespace:
		qualified := target.name + "." + node.Name
		if registered, ok := ctx.Functions[qualified]; ok {
			return walkResult{kind: walkFunction, spec: registered.Spec}
		}
		*found = append(*found, NewDiagnostic(CodeExprUnknownFunction, node.At,
			map[string]string{"name": qualified}))
		return walkResult{kind: walkBroken}

	case walkValue:
		return member(target, node.Name)

	case walkBroken:
		return target
	}
	return walkResult{kind: walkUnknown}
}

// member reads a declared member.
//
// An object with no declared members is opaque, not empty: json.parse(…) and a
// manifest output typed `object` with no `of:` both land here, and both defer to
// run time rather than refusing every field name.
func member(target walkResult, name string) walkResult {
	shape := target.node
	if target.projected {
		shape = ElementOf(target.node)
	}
	if shape.Type == TypeUnknown || shape.Type == TypeItem || shape.Members == nil {
		return walkResult{kind: walkUnknown}
	}
	declared, ok := shape.Members[name]
	if !ok {
		return walkResult{kind: walkUnknown}
	}
	return walkResult{kind: walkValue, node: declared, projected: target.projected}
}

func walkIndex(node *Index, ctx CheckContext, found *[]Diagnostic) walkResult {
	target := walk(node.Object, ctx, found)
	InferType(node.Index, ctx, found)
	if target.kind != walkValue {
		if target.kind == walkBroken {
			return target
		}
		return walkResult{kind: walkUnknown}
	}

	// Indexing a list selects one element; indexing an object reads a key whose
	// name is not statically known, so nothing about it is either.
	if target.node.Type == TypeList {
		return walkResult{kind: walkValue, node: ElementOf(target.node), projected: target.projected}
	}
	return walkResult{kind: walkUnknown}
}

func walkProject(node *Project, ctx CheckContext, found *[]Diagnostic) walkResult {
	target := walk(node.Object, ctx, found)
	if target.kind != walkValue {
		if target.kind == walkBroken {
			return target
		}
		return walkResult{kind: walkUnknown}
	}

	if target.node.Type != TypeList && target.node.Type != TypeUnknown {
		*found = append(*found, NewDiagnostic(CodeExprOperandType, node.At, map[string]string{
			"op": "[]", "expected": "list", "actual": string(target.node.Type),
		}))
		return walkResult{kind: walkBroken}
	}
	return walkResult{kind: walkValue, node: ElementOf(target.node), projected: true}
}

func walkCall(node *Call, ctx CheckContext, found *[]Diagnostic) walkResult {
	callee := walk(node.Object, ctx, found)

	args := make([]ValueType, 0, len(node.Args))
	for _, arg := range node.Args {
		args = append(args, InferType(arg, ctx, found))
	}

	if callee.kind != walkFunction {
		if callee.kind != walkBroken {
			*found = append(*found, NewDiagnostic(CodeExprUnknownFunction, node.At,
				map[string]string{"name": "this call"}))
		}
		return walkResult{kind: walkBroken}
	}

	spec := callee.spec
	variadic := len(spec.Params) > 0 && spec.Params[len(spec.Params)-1].Variadic

	// A variadic parameter is "one or more", not "zero or more".
	required := 0
	for _, param := range spec.Params {
		if !param.Optional {
			required++
		}
	}

	if len(args) < required || (!variadic && len(args) > len(spec.Params)) {
		expected := fmt.Sprint(len(spec.Params))
		if variadic {
			expected = fmt.Sprintf("at least %d", required)
		}
		*found = append(*found, NewDiagnostic(CodeExprArityMismatch, node.At, map[string]string{
			"name": spec.Qualified, "expected": expected, "actual": fmt.Sprint(len(args)),
		}))
		return known(spec.Returns)
	}

	for index, actual := range args {
		param := spec.Params[min(index, len(spec.Params)-1)]
		if Match(actual, param.Type) == VerdictConflicts {
			*found = append(*found, NewDiagnostic(CodeExprArgumentType, node.At, map[string]string{
				"name": spec.Qualified, "param": param.Name,
				"expected": string(param.Type), "actual": string(actual),
			}))
		}
	}

	return known(spec.Returns)
}

func walkUnary(node *Unary, ctx CheckContext, found *[]Diagnostic) walkResult {
	operand := InferType(node.Operand, ctx, found)
	expected := TypeNumber
	if node.Op == "!" {
		expected = TypeBoolean
	}
	requireType(found, operand, expected, node.Op, node.At)
	return known(expected)
}

func walkBinary(node *Binary, ctx CheckContext, found *[]Diagnostic) walkResult {
	left := InferType(node.Left, ctx, found)
	right := InferType(node.Right, ctx, found)

	switch node.Op {
	case "??":
		// The fallback's type is the arms' type when they agree, and unknown
		// when they do not — which is honest rather than picking the left one.
		if left == right {
			return known(left)
		}
		return known(TypeUnknown)

	case "&&", "||":
		requireType(found, left, TypeBoolean, node.Op, node.At)
		requireType(found, right, TypeBoolean, node.Op, node.At)
		return known(TypeBoolean)

	case "==", "!=":
		return known(TypeBoolean)

	case "<", "<=", ">", ">=":
		orderable := true
		for _, operand := range []ValueType{left, right} {
			if !CanOrder(operand) {
				orderable = false
				*found = append(*found, NewDiagnostic(CodeExprOperandType, node.At, map[string]string{
					"op": node.Op, "expected": "number, text or datetime", "actual": string(operand),
				}))
			}
		}
		// Only complain that the two sides disagree once both are things that
		// could have been ordered at all. Telling someone a list is unorderable
		// *and* that it does not match the text beside it is two squiggles about
		// one mistake, and the second is a consequence of the first.
		if orderable && left != TypeUnknown && right != TypeUnknown && left != right {
			*found = append(*found, NewDiagnostic(CodeExprOperandType, node.At, map[string]string{
				"op": node.Op, "expected": string(left), "actual": string(right),
			}))
		}
		return known(TypeBoolean)
	}

	requireType(found, left, TypeNumber, node.Op, node.At)
	requireType(found, right, TypeNumber, node.Op, node.At)
	return known(TypeNumber)
}

func walkTernary(node *Ternary, ctx CheckContext, found *[]Diagnostic) walkResult {
	cond := InferType(node.Cond, ctx, found)
	requireType(found, cond, TypeBoolean, "? :", node.At)

	whenTrue := InferType(node.WhenTrue, ctx, found)
	whenFalse := InferType(node.WhenFalse, ctx, found)
	if whenTrue == whenFalse {
		return known(whenTrue)
	}
	return known(TypeUnknown)
}

// requireType checks an operator's operand.
//
// Only a *known* conflict is reported: operators never coerce, so a known wrong
// type can only ever fail, while an unknown one is left to the run-time check
// rather than blocking a publish over something that may well be right.
func requireType(found *[]Diagnostic, actual, expected ValueType, op string, at int) {
	if actual == TypeUnknown || actual == TypeItem || actual == TypeNull || actual == expected {
		return
	}
	*found = append(*found, NewDiagnostic(CodeExprOperandType, at, map[string]string{
		"op": op, "expected": string(expected), "actual": string(actual),
	}))
}
