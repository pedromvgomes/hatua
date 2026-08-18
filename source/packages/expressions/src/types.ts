/**
 * The type lattice, and the one rule that uses it.
 *
 * **The expected type is always known before the expression is looked at.** It
 * comes from `FieldSpec.kind` for a `with:` value, and it is `boolean` for a
 * branch's `when`. Nothing infers a field's type *from* its expression; the
 * expression is checked *against* the field.
 *
 * What varies is whether the expression's *own* type can be determined
 * statically, and that gives three outcomes:
 *
 * | Expression type   | Design time                  | Run time                     |
 * | ----------------- | ---------------------------- | ---------------------------- |
 * | known, matches    | accepted                     | value checked, passes        |
 * | known, conflicts  | error — publish blocked      | never reached                |
 * | **unknown**       | accepted with a warning      | `EVAL_TYPE_MISMATCH` if wrong |
 *
 * The middle row is what makes the checker usable. `json.parse(s2.output).count`
 * has no static type, and rejecting it would make the function unusable while
 * accepting it silently would hide a real risk — so it is accepted, warned
 * about, and checked at run time instead. That is the same treatment `t: item`
 * and opaque `object` members already need.
 */
import { isScalar, type ValueType } from './value.js'

/**
 * The declared shape of something addressable.
 *
 * `members` describes an object's members, or — for a `list` — the fields of
 * each element, which is exactly what a Component Manifest's `of:` means.
 */
export interface TypeNode {
  readonly type: ValueType
  readonly members?: Readonly<Record<string, TypeNode>>
}

/**
 * One thing an expression may name, and what it yields.
 *
 * Scope arrives as an argument rather than being derived here, so this package
 * depends on `@hatua/schema` and nothing else — `@hatua/model` builds these
 * from the document and the manifests, and no cycle appears between them.
 */
export interface ScopeEntry {
  /** The token root: `s2`, `triggers.nightly`, `var.digest_to`, `TRIGGER`. */
  readonly path: string
  readonly type: TypeNode
}

/** The outcome of checking an expression's type against a field's. */
export type TypeVerdict = 'matches' | 'conflicts' | 'unknown'

/**
 * Compare a statically-determined type against a declared one.
 *
 * The coercion permitted here is exactly the coercion `satisfies` permits at run
 * time, stated once at the level of types rather than values: any scalar into
 * `text`, `null` into anything, and otherwise an exact match.
 */
export function match(actual: ValueType, declared: ValueType): TypeVerdict {
  if (actual === 'unknown' || actual === 'item') return 'unknown'
  if (declared === 'unknown' || declared === 'item') return 'matches'
  if (actual === 'null') return 'matches'
  if (actual === declared) return 'matches'
  if (declared === 'text' && isScalar(actual)) return 'matches'
  return 'conflicts'
}

/** Types that can be ordered with `<`, `<=`, `>`, `>=`. */
export const ORDERED_TYPES: readonly ValueType[] = ['number', 'text', 'datetime']

/** Whether a statically-known type could be an operand of an ordered comparison. */
export const canOrder = (type: ValueType): boolean =>
  type === 'unknown' || type === 'item' || ORDERED_TYPES.includes(type)

/** The element shape of a list, which the manifest spells as the list's own `of:`. */
export const elementOf = (node: TypeNode): TypeNode => ({
  type: 'object',
  ...(node.members ? { members: node.members } : {}),
})
