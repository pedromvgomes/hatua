/**
 * The AST as an S-expression.
 *
 * Parse scenarios have to assert on tree *shape* — precedence and
 * associativity are the bugs they exist to catch — and a nested YAML literal of
 * the whole node graph is unreadable enough that nobody would notice it
 * asserting the wrong thing. `(- (- 1 2) 3)` says "folds left" at a glance.
 *
 * This is a contract, not a convenience: `sdk/go/expressions/sexp.go` must
 * print the same string for the same source, and the shared scenarios are what
 * check that it does.
 */
import type { Expression, Segment, TemplateNode } from './ast.js'
import { numberToText } from './value.js'

export interface SexpOptions {
  /** Append `@offset` to every node. Only the offset scenarios ask for this. */
  readonly offsets?: boolean
}

export function templateToSexp(template: TemplateNode, options: SexpOptions = {}): string {
  const parts = template.segments.map((segment) => segmentToSexp(segment, options))
  return `(template ${parts.join(' ')})`.replace('(template )', '(template)')
}

function segmentToSexp(segment: Segment, options: SexpOptions): string {
  if (segment.kind === 'Text') return `(text ${quote(segment.value)})`
  return `(hole${mark(segment.at, options)} ${toSexp(segment.expr, options)})`
}

export function toSexp(node: Expression, options: SexpOptions = {}): string {
  const at = mark(node.at, options)
  const nested = (child: Expression) => toSexp(child, options)

  switch (node.kind) {
    case 'Name':
      return `${node.name}${at}`
    case 'Literal':
      return `${literal(node.type, node.value)}${at}`
    case 'Member':
      return `(.${at} ${nested(node.object)} ${node.name})`
    case 'Index':
      return `([]${at} ${nested(node.object)} ${nested(node.index)})`
    case 'Project':
      return `(project${at} ${nested(node.object)})`
    case 'Call':
      return `(call${at} ${[node.object, ...node.args].map(nested).join(' ')})`
    case 'Unary':
      return `(${node.op === '-' ? 'neg' : node.op}${at} ${nested(node.operand)})`
    case 'Binary':
      return `(${node.op}${at} ${nested(node.left)} ${nested(node.right)})`
    case 'Ternary':
      return `(?:${at} ${nested(node.cond)} ${nested(node.then)} ${nested(node.otherwise)})`
  }
}

const mark = (at: number, options: SexpOptions): string => (options.offsets ? `@${at}` : '')

function literal(type: string, value: string | number | boolean | null): string {
  if (type === 'text') return quote(String(value))
  if (type === 'number') return numberToText(value as number)
  return String(value)
}

/**
 * Deliberately minimal, and identical in Go: backslash, quote and the three
 * whitespace escapes, so a scenario expectation always fits on one line.
 */
function quote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}
