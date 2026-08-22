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
import { type Diagnostic, type DiagnosticCode, diagnostic, ExpressionError } from './errors.js'
import { parseTemplate } from './parse.js'
import {
  asText,
  compareText,
  isScalar,
  satisfies,
  typeOf,
  type Value,
  type ValueType,
} from './value.js'

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

/**
 * The buckets a path can resolve into, one per root.
 *
 * Every root is a key here and nothing resolves outside one, which is what
 * makes `root()` a table rather than a table with a fallback: a name the
 * evaluator does not recognise is missing, not a step id to go looking for.
 * ADR-0014 is the reason a step id is never at the root — `steps.run` and
 * `run.id` are different buckets, so neither can shadow the other and no
 * resolution order can decide which wins.
 */
export interface EvaluationContext {
  /** Step outputs, keyed by step id, addressed as `steps.<id>.…`. */
  readonly steps?: Readonly<Record<string, Value>>
  /** Trigger payloads, addressed as `triggers.<id>.…`. */
  readonly triggers?: Readonly<Record<string, Value>>
  /**
   * The values a Block was called with, addressed as `params.<k>`.
   *
   * Supplied per invocation rather than per run: a Block called twice is called
   * with different arguments, and its parameters are the only part of scope
   * that changes between two calls of the same Block.
   */
  readonly params?: Readonly<Record<string, Value>>
  /** Workflow variables, addressed as `var.<key>`. */
  readonly var?: Readonly<Record<string, Value>>
  /** The Host's ambient values for this execution, addressed as `run.<key>`. */
  readonly run?: Readonly<Record<string, Value>>
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
      // The index is evaluated *inside* `step`, so a missing object or an empty
      // projection short-circuits before it runs. Hoisting it out — as the Go
      // side once did — makes `{{ steps.s1.absent[1/0] }}` a division error in one
      // runtime and a missing path in the other.
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
        ? evaluate(node.whenTrue, context)
        : evaluate(node.whenFalse, context)
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
  // An empty id is absent, not present-and-empty. The schema requires a
  // trigger id to be non-empty, so the only way to see one is a hand-edited
  // context — and Go, which cannot tell an unset string from an empty one,
  // would call it missing.
  if (name === 'TRIGGER') return context.TRIGGER ? context.TRIGGER : MISSING
  if (name === 'triggers') return (context.triggers ?? {}) as Value
  if (name === 'var') return (context.var ?? {}) as Value
  if (name === 'run') return (context.run ?? {}) as Value
  if (name === 'steps') return (context.steps ?? {}) as Value
  if (name === 'params') return (context.params ?? {}) as Value
  return MISSING
}

/**
 * Reading a property of null yields null again — there is one absent value.
 *
 * `Object.hasOwn` is the whole prototype-pollution guarantee. A Workflow
 * Definition is user-editable YAML, so `{{ steps.s2.constructor }}` is reachable
 * input, and an own-properties-only read makes it well defined: a plain object
 * does not *own* `constructor`, `prototype` or `__proto__`, so all three miss.
 *
 * Deliberately no deny list alongside it. One adds no security — `hasOwn`
 * already refuses the inherited members — and subtracts correctness, because
 * `JSON.parse('{"constructor":"Acme"}')` creates a genuine own property that a
 * Host's payload may well contain. Go has no prototype chain and so needs no
 * deny list; one here would leave the two runtimes disagreeing about ordinary
 * data.
 */
function read(target: Value, name: string): Raw {
  if (target === null) return null
  if (typeof target !== 'object' || Array.isArray(target) || target instanceof Date) return MISSING
  return Object.hasOwn(target, name) ? ((target as Record<string, Value>)[name] as Value) : MISSING
}

function index(target: Value, key: Value, at: number): Raw {
  if (target === null) return null

  if (typeof key === 'number') {
    if (!Array.isArray(target)) {
      throw fail('EVAL_OPERAND_TYPE', at, { op: '[]', expected: 'list', actual: typeOf(target) })
    }
    // There is one numeric type, so `xs[3/2]` is as writable as `xs[1]`. It is
    // not a position: JavaScript would read the property named "1.5" and hand
    // back `undefined`, and Go would truncate to 1. Neither is an answer.
    if (!Number.isInteger(key)) {
      throw fail('EVAL_OPERAND_TYPE', at, {
        op: '[]',
        expected: 'a whole number',
        actual: 'a fraction',
      })
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

  // Text orders by code point, matching Go's byte-wise comparison of UTF-8.
  // JavaScript's own `<` would order a surrogate pair against U+E000..U+FFFF
  // the other way round.
  const order =
    type === 'text'
      ? compareText(left as string, right as string)
      : compareNumbers(
          type === 'datetime' ? (left as Date).getTime() : (left as number),
          type === 'datetime' ? (right as Date).getTime() : (right as number),
        )

  switch (op) {
    case '<':
      return order < 0
    case '<=':
      return order <= 0
    case '>':
      return order > 0
    default:
      return order >= 0
  }
}

function compareNumbers(left: number, right: number): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** `+` is numeric only. There is no string concatenation operator; use `text.concat`. */
function arithmetic(op: string, left: Value, right: Value, at: number): number {
  if (typeof left !== 'number') {
    throw fail('EVAL_OPERAND_TYPE', at, { op, expected: 'number', actual: typeOf(left) })
  }
  if (typeof right !== 'number') {
    throw fail('EVAL_OPERAND_TYPE', at, { op, expected: 'number', actual: typeOf(right) })
  }

  if ((op === '/' || op === '%') && right === 0) throw fail('EVAL_DIVISION_BY_ZERO', at, {})

  const result = arithmeticResult(op, left, right)
  // Division by zero is not the only way out of the value space: `1e308 * 10`
  // is Infinity in both languages, and the point of excluding Infinity is that
  // nothing downstream should have to hold an opinion about it.
  if (!Number.isFinite(result)) throw fail('EVAL_NUMERIC_OVERFLOW', at, { op })
  return result
}

function arithmeticResult(op: string, left: number, right: number): number {
  switch (op) {
    case '+':
      return left + right
    case '-':
      return left - right
    case '*':
      return left * right
    case '/':
      return left / right
    default:
      return left % right
  }
}

// ---- calls -----------------------------------------------------------------

function call(node: Extract<Expression, { kind: 'Call' }>, context: EvaluationContext): Value {
  const name = pathText(node.object)
  const registered = context.functions?.get(name)
  if (!registered) throw fail('EVAL_UNKNOWN_FUNCTION', node.at, { name })

  const args = node.args.map((arg) => evaluate(arg, context))
  const checked = checkArguments(registered.spec, args, node.at)

  try {
    return registered.impl(checked, context)
  } catch (error) {
    // An implementation reports what went wrong but has no idea where it was
    // called from — `dt.parse` knows the timestamp is unreadable, not that it
    // sits at offset 40 of a subject line. The call site is the only place that
    // knows, so it stamps the position on the way past.
    if (error instanceof ExpressionError) throw locate(error, node.at)
    throw error
  }
}

/** Give a failure a position, for diagnostics raised somewhere that had none. */
function locate(error: ExpressionError, at: number): ExpressionError {
  return new ExpressionError(error.diagnostics.map((d) => (d.at === 0 ? { ...d, at } : d)))
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
  // A variadic parameter is "one or more", not "zero or more" — so it counts
  // toward the minimum. Excluding it let `num.min()` through the arity check
  // and into an implementation with nothing to work on.
  const required = spec.params.filter((param) => !param.optional).length
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
