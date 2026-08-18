/**
 * The AST constructors the generated parser calls.
 *
 * Every action in `expression.peg` is exactly `return <helper>(...)`, which is
 * what makes one action body simultaneously valid Go and valid JavaScript and
 * is therefore what lets both parsers be generated from one grammar. All the
 * per-language awkwardness — pigeon hands back `[]byte` where Peggy hands back
 * a string, sequences arrive as nested arrays — is absorbed here, in a file
 * whose Go counterpart is `sdk/go/expressions/nodes.go`.
 *
 * Keep the two in step. A helper that builds a different shape on one side is
 * a divergence the parse scenarios exist to catch, but only if it is caught.
 */
import type {
  BinaryNode,
  BinaryOperator,
  CallNode,
  Expression,
  HoleNode,
  IndexNode,
  LiteralNode,
  MemberNode,
  NameNode,
  ProjectNode,
  Segment,
  TemplateNode,
  TernaryNode,
  TextNode,
  UnaryNode,
  UnaryOperator,
} from './ast.js'

/** What the parser hands an action: a match, a list of matches, or nothing. */
type Matched = unknown

function flatten(value: Matched): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(flatten).join('')
  return String(value)
}

function list(value: Matched): Matched[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function atOf(node: Matched): number {
  return node && typeof node === 'object' && 'at' in node ? (node as { at: number }).at : 0
}

/** Flatten whatever a match produced into a string. Stands in for Peggy's `$`. */
export function str(...parts: Matched[]): string {
  return flatten(parts)
}

export function templateNode(segs: Matched): TemplateNode {
  return { kind: 'Template', segments: list(segs) as Segment[] }
}

export function holeNode(at: Matched, expr: Matched): HoleNode {
  return { kind: 'Hole', at: at as number, expr: expr as Expression }
}

export function textNode(chars: Matched): TextNode {
  return { kind: 'Text', value: flatten(chars) }
}

export function ternaryNode(cond: Matched, tail: Matched): Expression {
  const parts = list(tail)
  // `( QMark Ternary Colon Ternary )?` — absent means this was not a ternary
  // at all, and the condition is the whole expression.
  if (parts.length === 0) return cond as Expression
  const node: TernaryNode = {
    kind: 'Ternary',
    at: atOf(cond),
    cond: cond as Expression,
    whenTrue: parts[1] as Expression,
    whenFalse: parts[3] as Expression,
  }
  return node
}

/**
 * Fold `head ( op operand )*` left. PEG has no left recursion, so precedence is
 * an explicit rule cascade and associativity is decided here — which is
 * precisely why the parse scenarios are separate from the eval ones.
 */
export function binaryNode(head: Matched, tail: Matched): Expression {
  let node = head as Expression
  for (const item of list(tail)) {
    const pair = list(item)
    const built: BinaryNode = {
      kind: 'Binary',
      at: atOf(node),
      op: flatten(pair[0]) as BinaryOperator,
      left: node,
      right: pair[1] as Expression,
    }
    node = built
  }
  return node
}

export function unaryNode(at: Matched, op: Matched, operand: Matched): UnaryNode {
  return {
    kind: 'Unary',
    at: at as number,
    op: flatten(op) as UnaryOperator,
    operand: operand as Expression,
  }
}

/** Parentheses group; they leave no node behind. */
export function parenNode(expr: Matched): Expression {
  return expr as Expression
}

/** A suffix before its object is known. */
type PartialSuffix = { kind: string; at: number; object?: Expression } & Record<string, unknown>

export function postfixNode(base: Matched, suffixes: Matched): Expression {
  let node = base as Expression
  for (const suffix of list(suffixes)) {
    const partial = suffix as PartialSuffix
    partial.object = node
    node = partial as unknown as Expression
  }
  return node
}

export function memberSuffix(at: Matched, name: Matched): Omit<MemberNode, 'object'> {
  return { kind: 'Member', at: at as number, name: flatten(name) }
}

export function projectSuffix(at: Matched): Omit<ProjectNode, 'object'> {
  return { kind: 'Project', at: at as number }
}

export function indexSuffix(at: Matched, index: Matched): Omit<IndexNode, 'object'> {
  return { kind: 'Index', at: at as number, index: index as Expression }
}

export function callSuffix(at: Matched, args: Matched): Omit<CallNode, 'object'> {
  return { kind: 'Call', at: at as number, args: list(args) as Expression[] }
}

export function argList(head: Matched, tail: Matched): Matched[] {
  const out: Matched[] = [head]
  for (const item of list(tail)) out.push(list(item)[1])
  return out
}

export function nameNode(at: Matched, name: Matched): NameNode {
  return { kind: 'Name', at: at as number, name: flatten(name) }
}

export function nullNode(at: Matched): LiteralNode {
  return { kind: 'Literal', at: at as number, type: 'null', value: null }
}

export function boolNode(at: Matched, value: Matched): LiteralNode {
  return { kind: 'Literal', at: at as number, type: 'boolean', value: flatten(value) === 'true' }
}

export function numberNode(at: Matched, int: Matched, frac: Matched, exp: Matched): LiteralNode {
  const raw = flatten(int) + flatten(frac) + flatten(exp)
  return { kind: 'Literal', at: at as number, type: 'number', value: Number(raw) }
}

export function stringNode(at: Matched, chars: Matched): LiteralNode {
  return { kind: 'Literal', at: at as number, type: 'text', value: flatten(chars) }
}

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '\\': '\\',
  "'": "'",
  '"': '"',
}

export function escapeChar(char: Matched): string {
  const key = flatten(char)
  const value = ESCAPES[key]
  // Deliberately loud. An unrecognised escape is far more likely to be a typo
  // than an intention, and silently yielding the character would hide it.
  if (value === undefined) throw new Error(`unknown escape \\${key}`)
  return value
}
