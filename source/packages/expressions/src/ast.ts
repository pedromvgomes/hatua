/**
 * The AST.
 *
 * Every node carries `at`, the offset of its first character in the Template.
 * That is what lets a diagnostic point at the failing sub-expression rather
 * than at the whole field, and it is why the grammar's one per-language rule
 * exists at all — reading the current offset is the single construct pigeon and
 * Peggy spell differently.
 */

export interface TemplateNode {
  readonly kind: 'Template'
  readonly segments: readonly Segment[]
}

export type Segment = TextNode | HoleNode

/** Literal text between holes. */
export interface TextNode {
  readonly kind: 'Text'
  readonly value: string
}

/** One `{{ … }}`. */
export interface HoleNode {
  readonly kind: 'Hole'
  readonly at: number
  readonly expr: Expression
}

export type Expression =
  | NameNode
  | MemberNode
  | IndexNode
  | ProjectNode
  | CallNode
  | UnaryNode
  | BinaryNode
  | TernaryNode
  | LiteralNode

/** A bare identifier: the root of a path, or a function's namespace. */
export interface NameNode {
  readonly kind: 'Name'
  readonly at: number
  readonly name: string
}

export interface MemberNode {
  readonly kind: 'Member'
  readonly at: number
  readonly object: Expression
  readonly name: string
}

export interface IndexNode {
  readonly kind: 'Index'
  readonly at: number
  readonly object: Expression
  readonly index: Expression
}

/** `a[]` — "that field of every element". */
export interface ProjectNode {
  readonly kind: 'Project'
  readonly at: number
  readonly object: Expression
}

/**
 * A call. `object` is whatever the `(` was applied to, which is a Member for
 * every well-formed call — `dt.now()` is Call(Member(Name(dt), now)). Keeping
 * it structural rather than special-casing `namespace.name` is what lets
 * `f(a)(b)` and `json.parse(x)['k']` compose without extra grammar.
 */
export interface CallNode {
  readonly kind: 'Call'
  readonly at: number
  readonly object: Expression
  readonly args: readonly Expression[]
}

export type UnaryOperator = '!' | '-'

export interface UnaryNode {
  readonly kind: 'Unary'
  readonly at: number
  readonly op: UnaryOperator
  readonly operand: Expression
}

export type BinaryOperator =
  | '??'
  | '||'
  | '&&'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'

export interface BinaryNode {
  readonly kind: 'Binary'
  readonly at: number
  readonly op: BinaryOperator
  readonly left: Expression
  readonly right: Expression
}

export interface TernaryNode {
  readonly kind: 'Ternary'
  readonly at: number
  readonly cond: Expression
  readonly then: Expression
  readonly otherwise: Expression
}

export type LiteralType = 'text' | 'number' | 'boolean' | 'null'

export interface LiteralNode {
  readonly kind: 'Literal'
  readonly at: number
  readonly type: LiteralType
  readonly value: string | number | boolean | null
}

/** Every node that carries an offset. */
export type Located = HoleNode | Expression

export const isExpression = (node: Segment | Expression): node is Expression =>
  node.kind !== 'Text' && node.kind !== 'Hole'
