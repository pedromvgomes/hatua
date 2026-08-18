package expressions

// The AST.
//
// Every node carries At, the offset of its first character in the Template.
// That is what lets a diagnostic point at the failing sub-expression rather
// than at the whole field, and it is why the grammar has one per-language rule
// at all — reading the current offset is the single construct pigeon and Peggy
// spell differently.
//
// Keep this in step with packages/expressions/src/ast.ts.

// Template is a whole field value: literal text with expression holes in it.
type Template struct {
	Segments []Segment
}

// Segment is either literal text or one hole.
type Segment interface{ isSegment() }

// Text is literal text between holes.
type Text struct {
	Value string
}

// Hole is one `{{ … }}`.
type Hole struct {
	At   int
	Expr Expression
}

func (*Text) isSegment() {}
func (*Hole) isSegment() {}

// Expression is the code inside one hole, evaluated to a single typed value.
type Expression interface {
	isExpression()
	// Offset is where this sub-expression starts in the Template.
	Offset() int
}

// Name is a bare identifier: the root of a path, or a function's namespace.
type Name struct {
	At   int
	Name string
}

// Member is `object.name`.
type Member struct {
	At     int
	Object Expression
	Name   string
}

// Index is `object[index]`.
type Index struct {
	At     int
	Object Expression
	Index  Expression
}

// Project is `object[]` — "that field of every element".
type Project struct {
	At     int
	Object Expression
}

// Call is `object(args...)`. Object is a *Member for every well-formed call:
// dt.now() is Call(Member(Name(dt), now)). Keeping it structural rather than
// special-casing namespace.name is what lets f(a)(b) and json.parse(x)["k"]
// compose without extra grammar.
type Call struct {
	At     int
	Object Expression
	Args   []Expression
}

// Unary is `!operand` or `-operand`.
type Unary struct {
	At      int
	Op      string
	Operand Expression
}

// Binary is any infix operator.
type Binary struct {
	At    int
	Op    string
	Left  Expression
	Right Expression
}

// Ternary is `cond ? whenTrue : whenFalse`.
//
// The arms are named rather than called Then/Otherwise so the two languages
// share one vocabulary: TypeScript cannot call one of them `then` without
// making every conditional node a thenable.
type Ternary struct {
	At        int
	Cond      Expression
	WhenTrue  Expression
	WhenFalse Expression
}

// LiteralKind is the type a literal denotes.
type LiteralKind string

const (
	LiteralText    LiteralKind = "text"
	LiteralNumber  LiteralKind = "number"
	LiteralBoolean LiteralKind = "boolean"
	LiteralNull    LiteralKind = "null"
)

// Literal is a constant written into the expression.
type Literal struct {
	At    int
	Kind  LiteralKind
	Value Value
}

func (*Name) isExpression()    {}
func (*Member) isExpression()  {}
func (*Index) isExpression()   {}
func (*Project) isExpression() {}
func (*Call) isExpression()    {}
func (*Unary) isExpression()   {}
func (*Binary) isExpression()  {}
func (*Ternary) isExpression() {}
func (*Literal) isExpression() {}

func (n *Name) Offset() int    { return n.At }
func (n *Member) Offset() int  { return n.At }
func (n *Index) Offset() int   { return n.At }
func (n *Project) Offset() int { return n.At }
func (n *Call) Offset() int    { return n.At }
func (n *Unary) Offset() int   { return n.At }
func (n *Binary) Offset() int  { return n.At }
func (n *Ternary) Offset() int { return n.At }
func (n *Literal) Offset() int { return n.At }
