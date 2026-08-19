package expressions

import (
	"fmt"
	"math"
	"time"
)

// Evaluation.
//
// Two functions and one value object, because a runner should never have to
// restate anything about how a field's type is decided:
//
//	Resolve(ctx, slot)         one Template into one typed value
//	ResolveAll(ctx, slots)     a whole `with:` map, reporting every failure
//	                           together
//
// The strictness is the point, and it is pinned by ADR-0009. Operators never
// coerce. Ordered comparison with nil, or across two types, is an error rather
// than a defensible-looking false. Division by zero is an error rather than an
// infinity, which is what keeps NaN and Inf out of the value space entirely.
// The one deliberate softness is interpolation: a nil inside mixed text renders
// as empty, because that is what mixed text means.
//
// Internally the evaluator panics with *Error and recovers at the two public
// entry points. Threading an error return through every operand of every
// operator would triple the size of this file and, more to the point, would
// make it stop looking like packages/expressions/src/resolve.ts — which is the
// thing a reviewer has to be able to check.

// OnMissing says what a path does when it resolves to nothing. It governs path
// resolution only, never operator semantics, which is what keeps the truth
// tables single-valued: nil still cannot be ordered, whether it came from a
// missing key or from a key holding nil.
type OnMissing string

const (
	OnMissingError OnMissing = "error"
	OnMissingNull  OnMissing = "null"
)

// Slot is a named Template plus the type it must produce.
type Slot struct {
	Name         string
	Template     string
	ExpectedType ValueType
}

// Context is everything an expression can see.
type Context struct {
	// Steps holds step outputs, keyed by step id.
	Steps map[string]Value
	// Triggers holds trigger payloads, addressed as `triggers.<id>.…`.
	Triggers map[string]Value
	// Vars holds workflow variables, addressed as `var.<key>`.
	Vars map[string]Value
	// Trigger names which Trigger fired. Empty means none was supplied.
	Trigger string
	// Now is the clock dt.now() reads. Never the system clock: an expression
	// that reads the wall clock is unfixturable, and two steps in one run would
	// disagree about when "now" was.
	Now       *time.Time
	OnMissing OnMissing
	Functions Registry
}

// FunctionImpl is how a function is implemented. Arguments arrive evaluated,
// arity-checked and type-checked.
type FunctionImpl func(args []Value, ctx Context) Value

// RegisteredFunction pairs a declaration with its implementation. Keeping them
// together is what lets arity and argument types be enforced in one place
// rather than at the top of thirty-four implementations, and it is why a Host's
// functions need no special handling.
type RegisteredFunction struct {
	Spec FunctionSpec
	Impl FunctionImpl
}

// Registry is a set of functions addressable as `namespace.name`.
type Registry map[string]RegisteredFunction

// Resolve evaluates one Slot.
//
// A Template that is exactly one hole keeps the expression's own type — the
// number 24, not the string "24". Anything else interpolates, because mixed
// text can only be text.
func Resolve(ctx Context, slot Slot) (value Value, err error) {
	defer func() {
		if failure := recovered(recover()); failure != nil {
			value, err = nil, inSlot(failure, slot.Name)
		}
	}()
	return resolveTemplate(ctx, slot), nil
}

// ResolveAll evaluates a whole `with:` map in one call.
//
// It reports every failure together rather than stopping at the first, because
// a user fixing one field at a time is a user running the workflow five times
// to find five mistakes.
func ResolveAll(ctx Context, slots []Slot) (map[string]Value, error) {
	values := make(map[string]Value, len(slots))
	var diagnostics []Diagnostic

	for _, slot := range slots {
		value, err := Resolve(ctx, slot)
		if err != nil {
			failure, ok := err.(*Error)
			if !ok {
				return nil, err
			}
			diagnostics = append(diagnostics, failure.Diagnostics...)
			continue
		}
		values[slot.Name] = value
	}

	if len(diagnostics) > 0 {
		return nil, &Error{Diagnostics: diagnostics}
	}
	return values, nil
}

func recovered(value any) *Error {
	if value == nil {
		return nil
	}
	if failure, ok := value.(*Error); ok {
		return failure
	}
	panic(value)
}

func inSlot(failure *Error, slot string) *Error {
	out := make([]Diagnostic, 0, len(failure.Diagnostics))
	for _, d := range failure.Diagnostics {
		out = append(out, d.InSlot(slot))
	}
	return &Error{Diagnostics: out}
}

func resolveTemplate(ctx Context, slot Slot) Value {
	template, err := ParseTemplate(slot.Template)
	if err != nil {
		panic(err.(*Error))
	}

	if single := singleHole(template); single != nil {
		return coerce(Evaluate(single, ctx), slot.ExpectedType, single.Offset())
	}
	return coerce(interpolate(template, ctx), slot.ExpectedType, 0)
}

// singleHole returns the one hole, when the Template is exactly one hole and
// nothing else.
func singleHole(template *Template) Expression {
	if len(template.Segments) != 1 {
		return nil
	}
	if hole, ok := template.Segments[0].(*Hole); ok {
		return hole.Expr
	}
	return nil
}

// interpolate renders a mixed Template.
//
// This is where the one deliberate softness lives: a nil renders as empty
// rather than failing. Everything else must be a scalar — a list interpolated
// into a sentence is far more likely to be a mistake than an intention, and
// json.stringify() says so explicitly when it is not.
func interpolate(template *Template, ctx Context) Value {
	out := ""
	for _, segment := range template.Segments {
		switch s := segment.(type) {
		case *Text:
			out += s.Value
		case *Hole:
			value := Evaluate(s.Expr, ctx)
			if value == nil {
				continue
			}
			if !IsScalar(TypeOf(value)) {
				panic(fail(CodeEvalTypeMismatch, s.At, map[string]string{
					"name":     "this text",
					"expected": "text",
					"actual":   string(TypeOf(value)),
				}))
			}
			out += AsText(value)
		}
	}
	return out
}

// coerce is the slot boundary.
//
// Coercion here is narrow and declared: any scalar into text, nil into
// anything, and otherwise an exact match. text into number is deliberately not
// implicit — that is what num.parse() is for.
func coerce(value Value, expected ValueType, at int) Value {
	if !Satisfies(value, expected) {
		panic(fail(CodeEvalTypeMismatch, at, map[string]string{
			"name":     "this value",
			"expected": string(expected),
			"actual":   string(TypeOf(value)),
		}))
	}
	if expected == TypeText && value != nil {
		if _, ok := value.(string); !ok {
			return AsText(value)
		}
	}
	return value
}

// ---- the evaluator ---------------------------------------------------------

// missing marks a path that resolved to nothing, as distinct from one holding
// nil.
type missing struct{}

// projection is `a[]` — the remaining suffixes apply to every element.
type projection struct{ items []Value }

// Evaluate reduces one Expression to a value.
func Evaluate(node Expression, ctx Context) Value {
	return settle(evaluateRaw(node, ctx), node, ctx)
}

func settle(raw any, node Expression, ctx Context) Value {
	switch value := raw.(type) {
	case missing:
		if ctx.OnMissing == OnMissingNull {
			return nil
		}
		panic(fail(CodeEvalMissingPath, node.Offset(), map[string]string{"name": PathText(node)}))
	case projection:
		return append([]Value{}, value.items...)
	default:
		return raw
	}
}

func evaluateRaw(node Expression, ctx Context) any {
	switch n := node.(type) {
	case *Literal:
		return n.Value
	case *Name:
		return root(n.Name, ctx)
	case *Member:
		return step(evaluateRaw(n.Object, ctx), func(target Value) any { return read(target, n.Name) })
	case *Index:
		key := Evaluate(n.Index, ctx)
		return step(evaluateRaw(n.Object, ctx), func(target Value) any {
			return indexInto(target, key, n.At)
		})
	case *Project:
		return project(evaluateRaw(n.Object, ctx), n.At)
	case *Call:
		return call(n, ctx)
	case *Unary:
		return unary(n.Op, Evaluate(n.Operand, ctx), n.At)
	case *Binary:
		return binary(n, ctx)
	case *Ternary:
		if condition(n.Cond, ctx) {
			return Evaluate(n.WhenTrue, ctx)
		}
		return Evaluate(n.WhenFalse, ctx)
	}
	panic(fmt.Sprintf("unknown expression %T", node))
}

// step applies a suffix, mapping over a projection and propagating absence.
func step(target any, apply func(Value) any) any {
	switch value := target.(type) {
	case missing:
		return missing{}
	case projection:
		items := make([]Value, 0, len(value.items))
		for _, item := range value.items {
			switch result := apply(item).(type) {
			case missing:
				items = append(items, nil)
			case projection:
				items = append(items, append([]Value{}, result.items...))
			default:
				items = append(items, result)
			}
		}
		return projection{items: items}
	default:
		return apply(target)
	}
}

func root(name string, ctx Context) any {
	switch name {
	case "TRIGGER":
		if ctx.Trigger == "" {
			return missing{}
		}
		return ctx.Trigger
	case "triggers":
		return asObject(ctx.Triggers)
	case "var":
		return asObject(ctx.Vars)
	}
	if value, ok := ctx.Steps[name]; ok {
		return value
	}
	return missing{}
}

func asObject(source map[string]Value) Value {
	if source == nil {
		return map[string]Value{}
	}
	return source
}

// read: reading a property of nil yields nil again — there is one absent value.
func read(target Value, name string) any {
	if target == nil {
		return nil
	}
	object, ok := target.(map[string]Value)
	if !ok {
		return missing{}
	}
	if value, present := object[name]; present {
		return value
	}
	return missing{}
}

func indexInto(target Value, key Value, at int) any {
	if target == nil {
		return nil
	}

	switch index := key.(type) {
	case float64:
		items, ok := target.([]Value)
		if !ok {
			panic(fail(CodeEvalOperandType, at, map[string]string{
				"op": "[]", "expected": "list", "actual": string(TypeOf(target)),
			}))
		}
		position := int(index)
		if position < 0 {
			position += len(items)
		}
		if position < 0 || position >= len(items) {
			return missing{}
		}
		return items[position]
	case string:
		return read(target, index)
	}

	panic(fail(CodeEvalOperandType, at, map[string]string{
		"op": "[]", "expected": "number or text", "actual": string(TypeOf(key)),
	}))
}

func project(target any, at int) any {
	switch value := target.(type) {
	case missing:
		return missing{}
	case projection:
		return value
	case nil:
		return nil
	case []Value:
		return projection{items: value}
	}
	panic(fail(CodeEvalOperandType, at, map[string]string{
		"op": "[]", "expected": "list", "actual": string(TypeOf(target)),
	}))
}

// ---- operators -------------------------------------------------------------

func unary(op string, operand Value, at int) Value {
	if op == "!" {
		value, ok := operand.(bool)
		if !ok {
			panic(operandType("!", "boolean", operand, at))
		}
		return !value
	}
	value, ok := operand.(float64)
	if !ok {
		panic(operandType("-", "number", operand, at))
	}
	return -value
}

func binary(node *Binary, ctx Context) Value {
	// `??` is the only fallback in the language, and the only place a nil on the
	// left is an ordinary outcome rather than a problem.
	if node.Op == "??" {
		if left := Evaluate(node.Left, ctx); left != nil {
			return left
		}
		return Evaluate(node.Right, ctx)
	}

	// Short-circuiting is deliberate: `has_mail && s2.count > 0` must not
	// evaluate the right-hand side when there is no mail.
	if node.Op == "&&" || node.Op == "||" {
		left := boolean(Evaluate(node.Left, ctx), node.Op, node.Left.Offset())
		if node.Op == "&&" && !left {
			return false
		}
		if node.Op == "||" && left {
			return true
		}
		return boolean(Evaluate(node.Right, ctx), node.Op, node.Right.Offset())
	}

	left := Evaluate(node.Left, ctx)
	right := Evaluate(node.Right, ctx)

	switch node.Op {
	case "==":
		return Equals(left, right)
	case "!=":
		return !Equals(left, right)
	case "<", "<=", ">", ">=":
		return compare(node.Op, left, right, node.At)
	}
	return arithmetic(node.Op, left, right, node.At)
}

func condition(node Expression, ctx Context) bool {
	return boolean(Evaluate(node, ctx), "? :", node.Offset())
}

func boolean(value Value, op string, at int) bool {
	result, ok := value.(bool)
	if !ok {
		panic(operandType(op, "boolean", value, at))
	}
	return result
}

// Equals implements `==`, which is total: every pair of values has an answer,
// and no value is ever converted to reach it. Two different types are simply
// not equal.
func Equals(left, right Value) bool {
	kind := TypeOf(left)
	if kind != TypeOf(right) {
		return false
	}

	switch kind {
	case TypeNull:
		return true
	case TypeDatetime:
		return left.(time.Time).Equal(right.(time.Time))
	case TypeList:
		a, b := left.([]Value), right.([]Value)
		if len(a) != len(b) {
			return false
		}
		for i := range a {
			if !Equals(a[i], b[i]) {
				return false
			}
		}
		return true
	case TypeObject:
		a, aok := left.(map[string]Value)
		b, bok := right.(map[string]Value)
		if !aok || !bok || len(a) != len(b) {
			return false
		}
		for key, value := range a {
			other, present := b[key]
			if !present || !Equals(value, other) {
				return false
			}
		}
		return true
	}
	return left == right
}

// compare is strict on both counts.
//
// Comparing with nil has no defensible answer — `null < 1` is neither true nor
// false — so it is an error rather than a quiet false that a branch then acts
// on. Comparing across types is the same problem wearing a different hat.
func compare(op string, left, right Value, at int) bool {
	if left == nil || right == nil {
		panic(fail(CodeEvalCompareNull, at, map[string]string{"op": op}))
	}

	kind := TypeOf(left)
	if kind != TypeOf(right) {
		panic(fail(CodeEvalCompareTypes, at, map[string]string{
			"op": op, "expected": string(kind), "actual": string(TypeOf(right)),
		}))
	}

	switch kind {
	case TypeNumber:
		return ordered(op, left.(float64), right.(float64))
	case TypeText:
		return ordered(op, left.(string), right.(string))
	case TypeDatetime:
		return ordered(op, left.(time.Time).UnixNano(), right.(time.Time).UnixNano())
	}

	panic(fail(CodeEvalOperandType, at, map[string]string{
		"op": op, "expected": "number, text or datetime", "actual": string(kind),
	}))
}

func ordered[T int64 | float64 | string](op string, left, right T) bool {
	switch op {
	case "<":
		return left < right
	case "<=":
		return left <= right
	case ">":
		return left > right
	}
	return left >= right
}

// arithmetic: `+` is numeric only. There is no string concatenation operator;
// text.concat is it.
func arithmetic(op string, left, right Value, at int) Value {
	a, ok := left.(float64)
	if !ok {
		panic(operandType(op, "number", left, at))
	}
	b, ok := right.(float64)
	if !ok {
		panic(operandType(op, "number", right, at))
	}

	switch op {
	case "+":
		return a + b
	case "-":
		return a - b
	case "*":
		return a * b
	case "/":
		if b == 0 {
			panic(fail(CodeEvalDivisionByZero, at, nil))
		}
		return a / b
	}
	if b == 0 {
		panic(fail(CodeEvalDivisionByZero, at, nil))
	}
	// math.Mod, never `%`: the operands are float64 and the remainder takes the
	// sign of the dividend, exactly as it does in JavaScript.
	return math.Mod(a, b)
}

// ---- calls -----------------------------------------------------------------

func call(node *Call, ctx Context) Value {
	name := PathText(node.Object)
	registered, ok := ctx.Functions[name]
	if !ok {
		panic(fail(CodeEvalUnknownFunction, node.At, map[string]string{"name": name}))
	}

	args := make([]Value, 0, len(node.Args))
	for _, arg := range node.Args {
		args = append(args, Evaluate(arg, ctx))
	}
	checked := checkArguments(registered.Spec, args, node.At)

	// An implementation reports what went wrong but has no idea where it was
	// called from — dt.parse knows the timestamp is unreadable, not that it sits
	// at offset 40 of a subject line. The call site is the only place that knows,
	// so it stamps the position on the way past.
	defer func() {
		if failure := recovered(recover()); failure != nil {
			panic(locate(failure, node.At))
		}
	}()
	return registered.Impl(checked, ctx)
}

// locate gives a failure a position, for diagnostics raised somewhere that had
// none.
func locate(failure *Error, at int) *Error {
	located := make([]Diagnostic, 0, len(failure.Diagnostics))
	for _, d := range failure.Diagnostics {
		if d.At == 0 {
			d.At = at
		}
		located = append(located, d)
	}
	return &Error{Diagnostics: located}
}

// checkArguments enforces arity and argument types once, for every function.
//
// `unknown` parameters accept anything including nil; everything else refuses
// nil, so `text.upper(s2.name)` on an absent name fails loudly instead of
// inventing a value. `?? ""` is how a caller says otherwise, and it is the only
// fallback in the language.
func checkArguments(spec FunctionSpec, args []Value, at int) []Value {
	variadic := len(spec.Params) > 0 && spec.Params[len(spec.Params)-1].Variadic

	required := 0
	for _, param := range spec.Params {
		if !param.Optional && !param.Variadic {
			required++
		}
	}

	if len(args) < required || (!variadic && len(args) > len(spec.Params)) {
		expected := arityText(required, len(spec.Params))
		if variadic {
			expected = fmt.Sprintf("at least %d", required)
		}
		panic(fail(CodeEvalArityMismatch, at, map[string]string{
			"name": spec.Qualified, "expected": expected, "actual": fmt.Sprint(len(args)),
		}))
	}

	out := make([]Value, 0, len(args))
	for index, arg := range args {
		param := spec.Params[min(index, len(spec.Params)-1)]
		if param.Type == TypeUnknown {
			out = append(out, arg)
			continue
		}
		if arg == nil || !Satisfies(arg, param.Type) {
			panic(fail(CodeEvalBadArgument, at, map[string]string{
				"name": spec.Qualified, "param": param.Name, "actual": string(TypeOf(arg)),
			}))
		}
		// `text` is the universal sink here too, so `text.concat(s2.count, "!")`
		// needs no converter — but the implementation still only ever sees text.
		if param.Type == TypeText {
			if _, ok := arg.(string); !ok {
				arg = AsText(arg)
			}
		}
		out = append(out, arg)
	}
	return out
}

func arityText(required, most int) string {
	if required == most {
		return fmt.Sprint(required)
	}
	return fmt.Sprintf("%d to %d", required, most)
}

// ---- plumbing --------------------------------------------------------------

// PathText reconstructs the source path, for a diagnostic that has to name what
// failed.
func PathText(node Expression) string {
	switch n := node.(type) {
	case *Name:
		return n.Name
	case *Member:
		return PathText(n.Object) + "." + n.Name
	case *Project:
		return PathText(n.Object) + "[]"
	case *Index:
		return PathText(n.Object) + "[…]"
	case *Call:
		return PathText(n.Object) + "()"
	}
	return "this expression"
}

func fail(code Code, at int, args map[string]string) *Error {
	return newError(NewDiagnostic(code, at, args))
}

func operandType(op, expected string, actual Value, at int) *Error {
	return fail(CodeEvalOperandType, at, map[string]string{
		"op": op, "expected": expected, "actual": string(TypeOf(actual)),
	})
}
