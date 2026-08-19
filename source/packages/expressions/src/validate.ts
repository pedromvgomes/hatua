/**
 * Design-time checking.
 *
 * Diagnostics never block editing. *Errors* block Publish; *warnings* inform and
 * block nothing. Type checking is gradual — a known incompatibility is an
 * error, an unknown type is a warning that defers to run time — because a
 * checker that refuses everything it cannot prove is a checker people route
 * around.
 *
 * The Go half is `sdk/go/expressions/validate.go`, and the diagnostics scenarios
 * assert on codes *and severities*: a code that errors here and warns there
 * would let a workflow publish from one builder and not another.
 */
import type { FunctionSpec } from '#generated/builtins.js'
import type { Expression, TemplateNode } from './ast.js'
import { type Diagnostic, diagnostic } from './errors.js'
import { tryParseTemplate } from './parse.js'
import type { FunctionRegistry } from './resolve.js'
import { canOrder, elementOf, match, type ScopeEntry, type TypeNode } from './types.js'
import type { ValueType } from './value.js'

export interface CheckContext {
  /** What this step may address. Sibling branches are deliberately absent. */
  readonly scope: readonly ScopeEntry[]
  /** Hatua's functions merged with the Host's. */
  readonly functions: FunctionRegistry
}

/**
 * Check one Template against the type its field declares.
 *
 * Returns everything it found. Callers decide what to do with it: the Inspector
 * renders all of them, Publish looks only at the errors.
 */
export function validate(
  template: string,
  expectedType: ValueType,
  context: CheckContext,
): Diagnostic[] {
  const parsed = tryParseTemplate(template)
  if (!parsed.ok) return [...parsed.diagnostics]
  return checkTemplate(parsed.template, expectedType, context)
}

function checkTemplate(
  template: TemplateNode,
  expectedType: ValueType,
  context: CheckContext,
): Diagnostic[] {
  const found: Diagnostic[] = []
  const [only] = template.segments
  const single = template.segments.length === 1 && only?.kind === 'Hole' ? only : null

  if (single) {
    const result = walk(single.expr, context, found)
    // A broken expression has already said what is wrong with it. Adding "and
    // its type is unknown" on top would be noise about a consequence, and it
    // would make every unresolvable reference read as two problems.
    if (result.kind !== 'broken') {
      reportMatch(found, settleType(result), expectedType, single.at, 'this expression')
    }
    return found
  }

  // Mixed text can only be text, whatever the holes hold. This is what refuses
  // the legacy `when: "{{s2.count}} > 0"` at design time rather than letting a
  // runner mistake the string "24 > 0" for truth.
  for (const segment of template.segments) {
    if (segment.kind === 'Hole') inferType(segment.expr, context, found)
  }

  // A Template with no holes at all is text just as surely, so `when: "yes"`
  // and a `number` field holding "abc" are known conflicts. Only an *empty*
  // value is exempt: nothing was written, so there is nothing to type, and
  // whether the field may be left empty is `req:`'s business.
  if (template.segments.length > 0) {
    reportMatch(found, 'text', expectedType, 0, 'this template')
  }
  return found
}

function reportMatch(
  found: Diagnostic[],
  actual: ValueType,
  declared: ValueType,
  at: number,
  name: string,
): void {
  const verdict = match(actual, declared)
  if (verdict === 'matches') return

  found.push(
    verdict === 'conflicts'
      ? diagnostic('EXPR_TYPE_MISMATCH', at, { name, expected: declared, actual })
      : diagnostic('EXPR_TYPE_UNKNOWN', at, { name, expected: declared }),
  )
}

// ---- inference -------------------------------------------------------------

/**
 * What an expression walks over, mid-path.
 *
 * `prefix` exists because scope paths are dotted — `triggers.nightly` is one
 * entry, not two — so `triggers` on its own is not yet a value. `namespace` is
 * the same idea for functions, and it is why namespaces need no reserved words:
 * the `(` is what tells a call from a path.
 */
type Walk =
  | { readonly kind: 'value'; readonly node: TypeNode; readonly projected: boolean }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'prefix'; readonly path: string }
  | { readonly kind: 'namespace'; readonly name: string }
  | { readonly kind: 'function'; readonly spec: FunctionSpec }
  | { readonly kind: 'broken' }

export function inferType(node: Expression, context: CheckContext, found: Diagnostic[]): ValueType {
  return settleType(walk(node, context, found))
}

function settleType(result: Walk): ValueType {
  if (result.kind === 'value') return result.projected ? 'list' : result.node.type
  return 'unknown'
}

function walk(node: Expression, context: CheckContext, found: Diagnostic[]): Walk {
  switch (node.kind) {
    case 'Literal':
      return { kind: 'value', node: { type: node.type }, projected: false }
    case 'Name':
      return walkName(node.name, node.at, context, found)
    case 'Member':
      return walkMember(node, context, found)
    case 'Index':
      return walkIndex(node, context, found)
    case 'Project':
      return walkProject(node, context, found)
    case 'Call':
      return walkCall(node, context, found)
    case 'Unary':
      return walkUnary(node, context, found)
    case 'Binary':
      return walkBinary(node, context, found)
    case 'Ternary':
      return walkTernary(node, context, found)
  }
}

function walkName(name: string, at: number, context: CheckContext, found: Diagnostic[]): Walk {
  const entry = context.scope.find((candidate) => candidate.path === name)
  if (entry) return { kind: 'value', node: entry.type, projected: false }

  if (context.scope.some((candidate) => candidate.path.startsWith(`${name}.`))) {
    return { kind: 'prefix', path: name }
  }
  for (const qualified of context.functions.keys()) {
    if (qualified.startsWith(`${name}.`)) return { kind: 'namespace', name }
  }

  found.push(diagnostic('EXPR_UNKNOWN_REFERENCE', at, { name }))
  return { kind: 'broken' }
}

function walkMember(
  node: Extract<Expression, { kind: 'Member' }>,
  context: CheckContext,
  found: Diagnostic[],
): Walk {
  const target = walk(node.object, context, found)

  switch (target.kind) {
    case 'prefix': {
      const path = `${target.path}.${node.name}`
      const entry = context.scope.find((candidate) => candidate.path === path)
      if (entry) return { kind: 'value', node: entry.type, projected: false }
      if (context.scope.some((candidate) => candidate.path.startsWith(`${path}.`))) {
        return { kind: 'prefix', path }
      }
      found.push(diagnostic('EXPR_UNKNOWN_REFERENCE', node.at, { name: path }))
      return { kind: 'broken' }
    }

    case 'namespace': {
      const qualified = `${target.name}.${node.name}`
      const registered = context.functions.get(qualified)
      if (registered) return { kind: 'function', spec: registered.spec }
      found.push(diagnostic('EXPR_UNKNOWN_FUNCTION', node.at, { name: qualified }))
      return { kind: 'broken' }
    }

    case 'value':
      return member(target, node.name, node.at, found)

    default:
      return target.kind === 'broken' ? target : { kind: 'unknown' }
  }
}

/**
 * Read a declared member.
 *
 * An object with no declared members is opaque, not empty: `json.parse(…)` and
 * a manifest output typed `object` with no `of:` both land here, and both defer
 * to run time rather than refusing every field name.
 */
function member(
  target: Extract<Walk, { kind: 'value' }>,
  name: string,
  at: number,
  found: Diagnostic[],
): Walk {
  // A list has no members — its *elements* do, which is what a manifest's `of:`
  // describes. Reading one straight off the list is the likeliest authoring
  // mistake in the language (the forgotten `[]`), and it used to type-check
  // clean against the element's fields and then miss at run time.
  if (!target.projected && target.node.type === 'list') {
    found.push(diagnostic('EXPR_OPERAND_TYPE', at, { op: '.', expected: 'object', actual: 'list' }))
    return { kind: 'broken' }
  }

  const shape = target.projected ? elementOf(target.node) : target.node
  if (shape.type === 'unknown' || shape.type === 'item') return { kind: 'unknown' }
  if (!shape.members) return { kind: 'unknown' }

  // `Object.hasOwn`, not a truthiness test: `members.constructor` resolves to
  // `Object.prototype.constructor`, which is truthy and has no `.type`, so the
  // checker concluded the expression "produces undefined" and blocked publish
  // — while Go, whose map lookup has no prototype behind it, warned and allowed
  // it. The evaluator learned this lesson already; the validator had not.
  if (!Object.hasOwn(shape.members, name)) return { kind: 'unknown' }
  return { kind: 'value', node: shape.members[name] as TypeNode, projected: target.projected }
}

function walkIndex(
  node: Extract<Expression, { kind: 'Index' }>,
  context: CheckContext,
  found: Diagnostic[],
): Walk {
  const target = walk(node.object, context, found)
  inferType(node.index, context, found)
  if (target.kind !== 'value') return target.kind === 'broken' ? target : { kind: 'unknown' }

  // Indexing a list selects one element; indexing an object reads a key whose
  // name is not statically known, so nothing about it is either.
  if (target.node.type === 'list') {
    return { kind: 'value', node: elementOf(target.node), projected: target.projected }
  }
  return { kind: 'unknown' }
}

function walkProject(
  node: Extract<Expression, { kind: 'Project' }>,
  context: CheckContext,
  found: Diagnostic[],
): Walk {
  const target = walk(node.object, context, found)
  if (target.kind !== 'value') return target.kind === 'broken' ? target : { kind: 'unknown' }

  // Projecting something already projected is the identity at run time, so it
  // must be accepted here: an `error` severity means "can never be right", and
  // `s2.messages[].subject[]` evaluates perfectly well.
  if (target.projected) return target

  if (target.node.type !== 'list' && target.node.type !== 'unknown') {
    found.push(
      diagnostic('EXPR_OPERAND_TYPE', node.at, {
        op: '[]',
        expected: 'list',
        actual: target.node.type,
      }),
    )
    return { kind: 'broken' }
  }
  return { kind: 'value', node: elementOf(target.node), projected: true }
}

function walkCall(
  node: Extract<Expression, { kind: 'Call' }>,
  context: CheckContext,
  found: Diagnostic[],
): Walk {
  const callee = walk(node.object, context, found)
  const args = node.args.map((arg) => inferType(arg, context, found))

  if (callee.kind !== 'function') {
    if (callee.kind !== 'broken') {
      found.push(diagnostic('EXPR_UNKNOWN_FUNCTION', node.at, { name: 'this call' }))
    }
    return { kind: 'broken' }
  }

  const { spec } = callee
  const variadic = spec.params.at(-1)?.variadic === true
  // A variadic parameter is "one or more", not "zero or more".
  const required = spec.params.filter((param) => !param.optional).length
  const most = variadic ? Number.POSITIVE_INFINITY : spec.params.length

  if (args.length < required || args.length > most) {
    found.push(
      diagnostic('EXPR_ARITY_MISMATCH', node.at, {
        name: spec.qualified,
        expected: variadic ? `at least ${required}` : String(spec.params.length),
        actual: String(args.length),
      }),
    )
    return { kind: 'value', node: { type: spec.returns }, projected: false }
  }

  args.forEach((actual, index) => {
    const param = spec.params[Math.min(index, spec.params.length - 1)]
    if (!param) return
    if (match(actual, param.type) === 'conflicts') {
      found.push(
        diagnostic('EXPR_ARGUMENT_TYPE', node.at, {
          name: spec.qualified,
          param: param.name,
          expected: param.type,
          actual,
        }),
      )
    }
  })

  return { kind: 'value', node: { type: spec.returns }, projected: false }
}

function walkUnary(
  node: Extract<Expression, { kind: 'Unary' }>,
  context: CheckContext,
  found: Diagnostic[],
): Walk {
  const operand = inferType(node.operand, context, found)
  const expected: ValueType = node.op === '!' ? 'boolean' : 'number'
  requireType(found, operand, expected, node.op, node.at)
  return { kind: 'value', node: { type: expected }, projected: false }
}

function walkBinary(
  node: Extract<Expression, { kind: 'Binary' }>,
  context: CheckContext,
  found: Diagnostic[],
): Walk {
  const left = inferType(node.left, context, found)
  const right = inferType(node.right, context, found)
  const { op, at } = node

  if (op === '??') {
    // The fallback's type is the arms' type when they agree, and unknown when
    // they do not — which is honest rather than picking the left one.
    return known(left === right ? left : 'unknown')
  }

  if (op === '&&' || op === '||') {
    requireType(found, left, 'boolean', op, at)
    requireType(found, right, 'boolean', op, at)
    return known('boolean')
  }

  if (op === '==' || op === '!=') return known('boolean')

  if (op === '<' || op === '<=' || op === '>' || op === '>=') {
    let orderable = true
    for (const operand of [left, right]) {
      if (!canOrder(operand)) {
        orderable = false
        found.push(
          diagnostic('EXPR_OPERAND_TYPE', at, {
            op,
            expected: 'number, text or datetime',
            actual: operand,
          }),
        )
      }
    }
    // Only complain that the two sides disagree once both are things that could
    // have been ordered at all. Telling someone a list is unorderable *and*
    // that it does not match the text beside it is two squiggles about one
    // mistake, and the second is a consequence of the first.
    if (orderable && left !== 'unknown' && right !== 'unknown' && left !== right) {
      found.push(diagnostic('EXPR_OPERAND_TYPE', at, { op, expected: left, actual: right }))
    }
    return known('boolean')
  }

  requireType(found, left, 'number', op, at)
  requireType(found, right, 'number', op, at)
  return known('number')
}

function walkTernary(
  node: Extract<Expression, { kind: 'Ternary' }>,
  context: CheckContext,
  found: Diagnostic[],
): Walk {
  const cond = inferType(node.cond, context, found)
  requireType(found, cond, 'boolean', '? :', node.at)

  const whenTrue = inferType(node.whenTrue, context, found)
  const whenFalse = inferType(node.whenFalse, context, found)
  return known(whenTrue === whenFalse ? whenTrue : 'unknown')
}

const known = (type: ValueType): Walk => ({
  kind: 'value',
  node: { type },
  projected: false,
})

/**
 * An operator's operand.
 *
 * Only a *known* conflict is reported: operators never coerce, so a known wrong
 * type can only ever fail, while an unknown one is left to the run-time check
 * rather than blocking a publish over something that may well be right.
 */
function requireType(
  found: Diagnostic[],
  actual: ValueType,
  expected: ValueType,
  op: string,
  at: number,
): void {
  if (actual === 'unknown' || actual === 'item' || actual === 'null') return
  if (actual === expected) return
  found.push(diagnostic('EXPR_OPERAND_TYPE', at, { op, expected, actual }))
}
