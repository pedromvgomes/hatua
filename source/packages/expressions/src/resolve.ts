/**
 * Evaluation.
 *
 * Two functions and one value object, because a runner should never have to
 * restate anything about how a field's type is decided:
 *
 *     resolve(context, slot)        one Template into one typed value
 *     resolveAll(context, slots)    a whole `with:` map, reporting every
 *                                   failure together
 *
 * The strictness is the point, and it is pinned by ADR-0009. Operators never
 * coerce. Ordered comparison with null, or across two types, is an error rather
 * than a defensible-looking `false`. Division by zero is an error rather than an
 * infinity, which is what keeps NaN and Infinity out of the value space
 * entirely. The one deliberate softness is interpolation: a null inside mixed
 * text renders as empty, because that is what mixed text means.
 */
import type { FunctionSpec } from '#generated/builtins.js'
import type { Expression, TemplateNode } from './ast.js'
import { type Diagnostic, diagnostic, type DiagnosticCode, ExpressionError } from './errors.js'
import { parseTemplate } from './parse.js'
import { asText, isScalar, satisfies, type Value, type ValueType, typeOf } from './value.js'

/**
 * What a path does when it resolves to nothing.
 *
 * It governs path *resolution* only, never operator semantics — which is what
 * keeps the truth tables single-valued. `null` still cannot be ordered, whether
 * it came from a missing key or from a key holding null.
 */
export type OnMissing = 'error' | 'null'

/** A named Template plus the type it must produce. */
export interface Slot {
  readonly name: string
  readonly template: string
  readonly expectedType: ValueType
}

export interface EvaluationContext {
  /** Step outputs, keyed by step id. */
  readonly steps?: Readonly<Record<string, Value>>
  /** Trigger payloads, addressed as `triggers.<id>.…`. */
  readonly triggers?: Readonly<Record<string, Value>>
  /** Workflow variables, addressed as `var.<key>`. */
  readonly var?: Readonly<Record<string, Value>>
  /** Which Trigger fired. Needed when several are declared. */
  readonly TRIGGER?: string | null
  /**
   * The clock `dt.now()` reads.
   *
   * Never the system clock: an expression that reads the wall clock is
   * unfixturable, and two steps in one run would disagree about when "now" was.
   */
  readonly now?: Date
  readonly onMissing?: OnMissing
  readonly functions?: FunctionRegistry
}

/** How a function is implemented. Arguments arrive evaluated and checked. */
export type FunctionImpl = (args: readonly Value[], context: EvaluationContext) => Value

/**
 * A function is its declaration *and* its implementation, together.
 *
 * Keeping them paired is what lets arity and argument types be enforced in one
 * place rather than at the top of thirty-four implementations, and it is why a
 * Host's functions need no special handling: a Host declaration produces the
 * same pair.
 */
export interface RegisteredFunction {
  readonly spec: FunctionSpec
  readonly impl: FunctionImpl
}

export type FunctionRegistry = ReadonlyMap<string, RegisteredFunction>

/**
 * Resolve one Slot.
 *
 * A Template that is exactly one hole keeps the expression's own type — the
 * number 24, not the string "24". Anything else interpolates, because mixed
 * text can only be text.
 */
export function resolve(context: EvaluationContext, slot: Slot): Value {
  const failures = collect(context, slot)
  if (failures.diagnostics.length > 0) throw new ExpressionError(failures.diagnostics)
  return failures.value
}

/**
 * Resolve a whole `with:` map in one call.
 *
 * It reports every failure together rather than stopping at the first, because
 * a user fixing one field at a time is a user running the workflow five times
 * to find five mistakes.
 */
export function resolveAll(
  context: EvaluationContext,
  slots: readonly Slot[],
): Record<string, Value> {
  const values: Record<string, Value> = {}
  const diagnostics: Diagnostic[] = []

  for (const slot of slots) {
    const outcome = collect(context, slot)
    diagnostics.push(...outcome.diagnostics)
    if (outcome.diagnostics.length === 0) values[slot.name] = outcome.value
  }

  if (diagnostics.length > 0) throw new ExpressionError(diagnostics)
  return values
}

function collect(
  context: EvaluationContext,
  slot: Slot,
): { value: Value; diagnostics: Diagnostic[] } {
  try {
    return { value: resolveTemplate(context, slot), diagnostics: [] }
  } catch (error) {
    if (error instanceof ExpressionError) {
      return {
        value: null,
        diagnostics: error.diagnostics.map((d) => ({ ...d, slot: slot.name })),
      }
    }
    throw error
  }
}

function resolveTemplate(context: EvaluationContext, slot: Slot): Value {
  const template = parseTemplate(slot.template)
  const single = singleHole(template)

  if (single) return coerce(evaluate(single, context), slot.expectedType, single.at)
  return coerce(interpolate(template, context), slot.expectedType, 0)
}

/** The one hole, when the Template is exactly one hole and nothing else. */
function singleHole(template: TemplateNode): Expression | null {
  const [only] = template.segments
  if (template.segments.length === 1 && only?.kind === 'Hole') return only.expr
  return null
}

/**
 * Render a mixed Template.
 *
 * This is where the one deliberate softness lives: a null renders as empty
 * rather than failing. Everything else must be a scalar — a list interpolated
 * into a sentence is far more likely to be a mistake than an intention, and
 * `json.stringify()` says so explicitly when it is not.
 */
function interpolate(template: TemplateNode, context: EvaluationContext): string {
  let out = ''
  for (const segment of template.segments) {
    if (segment.kind === 'Text') {
      out += segment.value
      continue
    }
    const value = evaluate(segment.expr, context)
    if (value === null) continue
    if (!isScalar(typeOf(value))) {
      throw fail('EVAL_TYPE_MISMATCH', segment.at, {
        name: 'this text',
        expected: 'text',
        actual: typeOf(value),
      })
    }
    out += asText(value)
  }
  return out
}

/**
 * The slot boundary.
 *
 * Coercion here is narrow and declared: any scalar into `text`, `null` into
 * anything, and otherwise an exact match. `text` into `number` is deliberately
 * not implicit — that is what `num.parse()` is for.
 */
function coerce(value: Value, expected: ValueType, at: number): Value {
  if (!satisfies(value, expected)) {
    throw fail('EVAL_TYPE_MISMATCH', at, {
      name: 'this value',
      expected,
      actual: typeOf(value),
    })
  }
  if (expected === 'text' && value !== null && typeof value !== 'string') return asText(value)
  return value
}

// ---- the evaluator ---------------------------------------------------------

/** A path that resolved to nothing, as distinct from one holding null. */
const MISSING = Symbol('missing')

/** `a[]` — the remaining suffixes apply to every element. */
class Projection {
  constructor(readonly items: readonly Value[]) {}
}

type Raw = Value | Projection | typeof MISSING

/**
 * Segments that must never resolve.
 *
 * A Workflow Definition is user-editable YAML, so `{{ __proto__.constructor }}`
 * is reachable input. Reading own properties only is what makes the evaluator's
 * behaviour well-defined for any path a user can write — and it is why Go's
 * half of this needs no equivalent guard while TypeScript's does.
 */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

export function evaluate(node: Expression, context: EvaluationContext): Value {
  return settle(evaluateRaw(node, context), node, context)
}

function settle(raw: Raw, node: Expression, context: EvaluationContext): Value {
  if (raw === MISSING) {
    if (context.onMissing === 'null') return null
    throw fail('EVAL_MISSING_PATH', node.at, { name: pathText(node) })
  }
  if (raw instanceof Projection) return [...raw.items]
  return raw
}

function evaluateRaw(node: Expression, context: EvaluationContext): Raw {
  switch (node.kind) {
    case 'Literal':
      return node.value
    case 'Name':
      return root(node.name, context)
    case 'Member':
      return step(evaluateRaw(node.object, context), (target) => read(target, node.name))
    case 'Index':
      return step(evaluateRaw(node.object, context), (target) =>
        index(target, evaluate(node.index, context), node.at),
      )
    case 'Project':
      return project(evaluateRaw(node.object, context), node.at)
    case 'Call':
      return call(node, context)
    case 'Unary':
      return unary(node.op, evaluate(node.operand, context), node.at)
    case 'Binary':
      return binary(node, context)
    case 'Ternary':
      return condition(node.cond, context)
        ? evaluate(node.then, context)
        : evaluate(node.otherwise, context)
  }
}

/** Apply a suffix, mapping over a projection and propagating absence. */
function step(target: Raw, apply: (value: Value) => Raw): Raw {
  if (target === MISSING) return MISSING
  if (target instanceof Projection) {
    return new Projection(
      target.items.map((item) => {
        const result = apply(item)
        return result === MISSING ? null : result instanceof Projection ? [...result.items] : result
      }),
    )
  }
  return apply(target)
}

function root(name: string, context: EvaluationContext): Raw {
  if (name === 'TRIGGER') return context.TRIGGER ?? MISSING
  if (name === 'triggers') return (context.triggers ?? {}) as Value
  if (name === 'var') return (context.var ?? {}) as Value
  const steps = context.steps ?? {}
  return Object.hasOwn(steps, name) ? (steps[name] as Value) : MISSING
}

/** Reading a property of null yields null again — there is one absent value. */
function read(target: Value, name: string): Raw {
  if (target === null) return null
  if (FORBIDDEN.has(name)) return MISSING
  if (typeof target !== 'object' || Array.isArray(target) || target instanceof Date) return MISSING
  return Object.hasOwn(target, name) ? ((target as Record<string, Value>)[name] as Value) : MISSING
}

function index(target: Value, key: Value, at: number): Raw {
  if (target === null) return null

  if (typeof key === 'number') {
    if (!Array.isArray(target)) {
      throw fail('EVAL_OPERAND_TYPE', at, { op: '[]', expected: 'list', actual: typeOf(target) })
    }
    const position = key < 0 ? target.length + key : key
    return position >= 0 && position < target.length ? (target[position] as Value) : MISSING
  }

  if (typeof key === 'string') return read(target, key)

  throw fail('EVAL_OPERAND_TYPE', at, { op: '[]', expected: 'number or text', actual: typeOf(key) })
}

function project(target: Raw, at: number): Raw {
  if (target === MISSING) return MISSING
  if (target instanceof Projection) return target
  if (target === null) return null
  if (!Array.isArray(target)) {
    throw fail('EVAL_OPERAND_TYPE', at, { op: '[]', expected: 'list', actual: typeOf(target) })
  }
  return new Projection(target)
}

// ---- operators -------------------------------------------------------------

function unary(op: string, operand: Value, at: number): Value {
  if (op === '!') {
    if (typeof operand !== 'boolean') {
      throw fail('EVAL_OPERAND_TYPE', at, { op: '!', expected: 'boolean', actual: typeOf(operand) })
    }
    return !operand
  }
  if (typeof operand !== 'number') {
    throw fail('EVAL_OPERAND_TYPE', at, { op: '-', expected: 'number', actual: typeOf(operand) })
  }
  return -operand
}

function binary(node: Extract<Expression, { kind: 'Binary' }>, context: EvaluationContext): Value {
  const { op, at } = node

  // `??` is the only fallback in the language, and the only place a null on the
  // left is an ordinary outcome rather than a problem.
  if (op === '??') {
    const left = evaluate(node.left, context)
    return left === null ? evaluate(node.right, context) : left
  }

  // Short-circuiting is deliberate: `has_mail && s2.count > 0` must not
  // evaluate the right-hand side when there is no mail.
  if (op === '&&' || op === '||') {
    const left = boolean(evaluate(node.left, context), op, node.left.at)
    if (op === '&&' && !left) return false
    if (op === '||' && left) return true
    return boolean(evaluate(node.right, context), op, node.right.at)
  }

  const left = evaluate(node.left, context)
  const right = evaluate(node.right, context)

  if (op === '==') return equals(left, right)
  if (op === '!=') return !equals(left, right)
  if (op === '<' || op === '<=' || op === '>' || op === '>=') return compare(op, left, right, at)
  return arithmetic(op, left, right, at)
}

function condition(node: Expression, context: EvaluationContext): boolean {
  return boolean(evaluate(node, context), '? :', node.at)
}

function boolean(value: Value, op: string, at: number): boolean {
  if (typeof value !== 'boolean') {
    throw fail('EVAL_OPERAND_TYPE', at, { op, expected: 'boolean', actual: typeOf(value) })
  }
  return value
}

/**
 * `==` and `!=` are total: every pair of values has an answer, and no value is
 * ever converted to reach it. Two different types are simply not equal.
 */
export function equals(left: Value, right: Value): boolean {
  const type = typeOf(left)
  if (type !== typeOf(right)) return false

  switch (type) {
    case 'null':
      return true
    case 'datetime':
      return (left as Date).getTime() === (right as Date).getTime()
    case 'list': {
      const a = left as readonly Value[]
      const b = right as readonly Value[]
      return a.length === b.length && a.every((item, i) => equals(item, b[i] as Value))
    }
    case 'object': {
      const a = left as Record<string, Value>
      const b = right as Record<string, Value>
      const keys = Object.keys(a)
      if (keys.length !== Object.keys(b).length) return false
      return keys.every((key) => Object.hasOwn(b, key) && equals(a[key] as Value, b[key] as Value))
    }
    default:
      return left === right
  }
}

const ORDERED = new Set<ValueType>(['number', 'text', 'datetime'])

/**
 * Ordered comparison is strict on both counts.
 *
 * Comparing with null has no defensible answer — `null < 1` is neither true nor
 * false — so it is an error rather than a quiet `false` that a branch then acts
 * on. Comparing across types is the same problem wearing a different hat.
 */
function compare(op: string, left: Value, right: Value, at: number): boolean {
  if (left === null || right === null) throw fail('EVAL_COMPARE_NULL', at, { op })

  const type = typeOf(left)
  if (type !== typeOf(right)) {
    throw fail('EVAL_COMPARE_TYPES', at, { op, expected: type, actual: typeOf(right) })
  }
  if (!ORDERED.has(type)) {
    throw fail('EVAL_OPERAND_TYPE', at, { op, expected: 'number, text or datetime', actual: type })
  }

  const a = type === 'datetime' ? (left as Date).getTime() : (left as number | string)
  const b = type === 'datetime' ? (right as Date).getTime() : (right as number | string)

  switch (op) {
    case '<':
      return a < b
    case '<=':
      return a <= b
    case '>':
      return a > b
    default:
      return a >= b
  }
}

/** `+` is numeric only. There is no string concatenation operator; use `text.concat`. */
function arithmetic(op: string, left: Value, right: Value, at: number): number {
  if (typeof left !== 'number') {
    throw fail('EVAL_OPERAND_TYPE', at, { op, expected: 'number', actual: typeOf(left) })
  }
  if (typeof right !== 'number') {
    throw fail('EVAL_OPERAND_TYPE', at, { op, expected: 'number', actual: typeOf(right) })
  }

  switch (op) {
    case '+':
      return left + right
    case '-':
      return left - right
    case '*':
      return left * right
    case '/':
      if (right === 0) throw fail('EVAL_DIVISION_BY_ZERO', at, {})
      return left / right
    default:
      if (right === 0) throw fail('EVAL_DIVISION_BY_ZERO', at, {})
      return left % right
  }
}

// ---- calls -----------------------------------------------------------------

function call(node: Extract<Expression, { kind: 'Call' }>, context: EvaluationContext): Value {
  const name = pathText(node.object)
  const registered = context.functions?.get(name)
  if (!registered) throw fail('EVAL_UNKNOWN_FUNCTION', node.at, { name })

  const args = node.args.map((arg) => evaluate(arg, context))
  return registered.impl(checkArguments(registered.spec, args, node.at), context)
}

/**
 * Arity and argument types, once, for every function.
 *
 * `unknown` parameters accept anything including null; everything else refuses
 * null, so `text.upper(s2.name)` on an absent name fails loudly instead of
 * inventing a value. `?? ''` is how a caller says otherwise, and it is the only
 * fallback in the language.
 */
function checkArguments(spec: FunctionSpec, args: readonly Value[], at: number): Value[] {
  const variadic = spec.params.at(-1)?.variadic === true
  const required = spec.params.filter((param) => !param.optional && !param.variadic).length
  const most = variadic ? Number.POSITIVE_INFINITY : spec.params.length

  if (args.length < required || args.length > most) {
    throw fail('EVAL_ARITY_MISMATCH', at, {
      name: spec.qualified,
      expected: variadic ? `at least ${required}` : arityText(required, spec.params.length),
      actual: String(args.length),
    })
  }

  return args.map((arg, index) => {
    const param = spec.params[Math.min(index, spec.params.length - 1)]
    if (!param || param.type === 'unknown') return arg
    if (arg === null || !satisfies(arg, param.type)) {
      throw fail('EVAL_BAD_ARGUMENT', at, {
        name: spec.qualified,
        param: param.name,
        actual: typeOf(arg),
      })
    }
    // `text` is the universal sink here too, so `text.concat(s2.count, '!')`
    // needs no converter — but the implementation still only ever sees text.
    return param.type === 'text' && typeof arg !== 'string' ? asText(arg) : arg
  })
}

const arityText = (required: number, most: number): string =>
  required === most ? String(required) : `${required} to ${most}`

// ---- plumbing --------------------------------------------------------------

/** Reconstruct the source path, for a diagnostic that has to name what failed. */
export function pathText(node: Expression): string {
  switch (node.kind) {
    case 'Name':
      return node.name
    case 'Member':
      return `${pathText(node.object)}.${node.name}`
    case 'Project':
      return `${pathText(node.object)}[]`
    case 'Index':
      return `${pathText(node.object)}[…]`
    case 'Call':
      return `${pathText(node.object)}()`
    default:
      return 'this expression'
  }
}

function fail(code: DiagnosticCode, at: number, args: Record<string, string>): ExpressionError {
  return new ExpressionError([diagnostic(code, at, args)])
}
