import type { Slot, ValueType } from '@hatua/expressions'
import type { Manifest, Step, Variable, WorkflowDefinition } from '@hatua/schema'
import { isMappable, type MAPPABLE_FIELD_KINDS } from '@hatua/schema'
import { type BoardId, own, variableOn } from './tree'

/**
 * The bridge between a Component Manifest and the expression language.
 *
 * `@hatua/expressions` deliberately knows nothing about manifests: it takes a
 * `Slot` and a `ScopeEntry[]` as arguments, which is what keeps it depending on
 * `@hatua/schema` alone and stops a cycle forming with this package. The cost is
 * that *something* has to turn a step and its manifest into those arguments, and
 * this is it — once per language, so a runner never restates the field-kind to
 * type mapping and cannot get it subtly different from the builder.
 */

/** The kinds whose value is a Template. Everything else holds a literal. */
export type MappableFieldKind = (typeof MAPPABLE_FIELD_KINDS)[number]

/**
 * What each mappable field kind's value must produce.
 *
 * Keyed by `MappableFieldKind` rather than by `string`, so the compiler refuses
 * both a missing kind and an invented one. A loose `Record<string, ValueType>`
 * accepts entries for `bool`, `enum`, `secret` and `conn` — kinds `isMappable`
 * rejects before this is ever read, so they are unreachable — while silently
 * tolerating the omission of `map`, which is mappable. That is the same "two
 * definitions of one thing" failure a Reference regex would be, and the key
 * type is what stops it.
 *
 * `mono` and `textarea` are text that renders differently. `ref` is `unknown` on
 * purpose: a ref field holds whatever it points at, and the check belongs at the
 * far end. `map` has no single type at all — each of its entries declares its
 * own, which is why `slotsFor` never reads this for one.
 */
export const FIELD_KIND_TYPES: Readonly<Record<MappableFieldKind, ValueType>> = {
  text: 'text',
  mono: 'text',
  textarea: 'text',
  number: 'number',
  ref: 'unknown',
  map: 'unknown',
}

/** One entry of a `map` field: a name, a Template, and the type it must produce. */
export interface MapEntry {
  key: string
  value: string
  type: ValueType
}

/**
 * The Slots a step's `with:` map resolves into.
 *
 * A `map` field contributes one Slot per entry, named `<field>.<key>`, because
 * each entry is separately typed and separately wrong.
 */
export function slotsFor(step: Step, manifest: Manifest): Slot[] {
  const values = (step.with ?? {}) as Record<string, unknown>
  const slots: Slot[] = []

  for (const field of manifest.fields ?? []) {
    if (!isMappable(field.kind)) continue
    const value = own(values, field.k)

    if (field.kind === 'map') {
      for (const entry of mapEntries(value)) {
        slots.push({
          name: `${field.k}.${entry.key}`,
          template: entry.value,
          expectedType: entry.type,
        })
      }
      continue
    }

    if (typeof value !== 'string') continue
    slots.push({
      name: field.k,
      template: value,
      expectedType: FIELD_KIND_TYPES[field.kind as MappableFieldKind] ?? 'text',
    })
  }

  return slots
}

/**
 * The Slot a branch's `when` resolves into.
 *
 * Separate from `slotsFor` because a branch is not a step and has no manifest —
 * and because its type is not declared anywhere: a condition is a boolean, and
 * that is the whole reason `when: "{{steps.s2.count}} > 0"` can be refused at design
 * time rather than misread at run time.
 */
export const whenSlot = (when: string): Slot => ({
  name: 'when',
  template: when,
  expectedType: 'boolean',
})

/** The verb whose outputs come from its own configuration. */
export const MAPPING_VERB = 'core.map'

/** The verb that repeats its children until a condition holds. */
export const REPEAT_VERB = 'core.repeat'

/** The verb that iterates a collection. */
export const FOR_EACH_VERB = 'core.for_each'

/** The verb that branches. */
export const FORK_VERB = 'core.fork'

/** The verb that writes one of its Board's variables. */
export const SET_VAR_VERB = 'core.set_var'

/**
 * The verb that protects a region and falls back to a handler.
 *
 * The one container with two child regions: a body under `steps:` and a handler
 * under `handler:`. Wrapping one Step is retry, wrapping a region is fallback,
 * so one verb serves both (ADR-0013).
 *
 * Its retry policy — how many attempts, how long to wait — sits in `with:` as
 * ordinary manifest fields, and deliberately NOT in a structural key. `until`
 * had to leave `with:` because `FIELD_KIND_TYPES` has no mappable boolean, so a
 * condition there would have type-checked as text. An attempt count is a number
 * and `number` IS a mappable field kind, so the argument that moved `until` does
 * not reach here at all — following it anyway would be copying a conclusion
 * without its reason, and would cost a structural key, a diagnostic and a form
 * control that the manifest already gives for nothing.
 */
export const TRY_VERB = 'core.try'

/**
 * The field a `core.for_each` iterates, and the one `item` is resolved through.
 *
 * A constant rather than a literal at three call sites, because it is a name two
 * languages and one manifest have to agree on: `item` means "one element of
 * whatever THIS key points at", so a reader looking under a different key
 * resolves `item` to nothing and reports no type at all.
 */
export const FOR_EACH_LIST_FIELD = 'list'

/**
 * The output key a container binds for the children it owns.
 *
 * Both are ordinary manifest outputs of the container Step, read as
 * `{{steps.<container id>.<key>}}`. That is the whole binding mechanism, and it
 * is one mechanism rather than two: ADR-0014 closed the path roots so that a
 * structural idea could not take a bare word away from users, and a Step id is
 * already one segment below `steps.`. Two nested loops cannot shadow each other,
 * because two Steps cannot share an id on one Board.
 */
export const ITEM_BINDING = 'item'

/**
 * The Slot a `core.repeat`'s `until` resolves into.
 *
 * The mirror of `whenSlot`, and for the same reason: a condition is a boolean,
 * and no manifest field can say so — `FIELD_KIND_TYPES` has no mappable boolean
 * at all, because `bool` holds a literal rather than a Template. That is why
 * `until` is a structural key beside `steps:` rather than a field under `with:`.
 * Under `with:` it would type-check as text, so `{{ steps.s2.count }}` would
 * pass as a termination condition.
 *
 * A repeat tests this AFTER its body, so the body always runs at least once.
 */
export const repeatSlot = (until: string): Slot => ({
  name: 'until',
  template: until,
  expectedType: 'boolean',
})

/**
 * The type a variable's `{{ var.<key> }}`, its initial `value` and every
 * `core.set_var` writing it are all checked against.
 *
 * Declared rather than read off the value. A var is the one addressable thing
 * whose content changes while the document does not, so inferring its type from
 * the literal in the file would make the marking a lie the moment a
 * `core.set_var` wrote something else — and every downstream check was answered
 * against it (ADR-0013).
 *
 * `unknown` for a var carrying no `t` at all — absent or empty alike, matching
 * the Go SDK, because a hand-edit is exactly what reaches here and `t: ""` is as
 * plausible a one as a missing key. The schema requires a type, so refusing to
 * check is the honest answer where guessing `text` would refuse a document over
 * a type nothing declared.
 */
export const variableType = (variable: Variable): ValueType =>
  variable.t ? (variable.t as ValueType) : 'unknown'

/**
 * The Slot a `core.set_var`'s `value` resolves into, typed by the variable it
 * names.
 *
 * The third verb a manifest cannot describe, alongside a call and a
 * `core.return`, and for the same reason: what its field must produce is
 * declared elsewhere in the document. Here it is the Board's `vars`, which is
 * also why a `core.set_var` inside a Block can only ever name that Block's —
 * `vars` is read from the Board the Step sits on, so there is no reaching out.
 *
 * Takes the Board rather than a list of variables, so the caller cannot supply
 * the wrong one: the Go SDK's `SetVarSlot` has the same signature, and a runner
 * handed a list would be the one deciding whether a Block falls back to the
 * workflow's variables — which is the rule this verb exists inside.
 *
 * Null when the step names no variable, or names one the Board does not
 * declare: both have their own diagnostic, and resolving a Template against a
 * type nothing declared would report a mismatch the user cannot act on.
 */
export function setVarSlot(doc: WorkflowDefinition, board: BoardId, step: Step): Slot | null {
  const values = (step.with ?? {}) as Record<string, unknown>

  const key = own(values, 'key')
  if (typeof key !== 'string') return null

  const variable = variableOn(doc, board, key)
  if (!variable) return null

  const template = own(values, 'value')
  if (typeof template !== 'string') return null

  return { name: 'value', template, expectedType: variableType(variable) }
}

/**
 * The Slot a variable's initial value resolves into.
 *
 * A var's `value` may hold `{{ … }}`, and until `t` was declared there was
 * nothing to check it against. Null for a literal: only a Template is a Slot.
 */
export function variableSlot(variable: Variable): Slot | null {
  if (typeof variable.value !== 'string') return null
  return { name: variable.key, template: variable.value, expectedType: variableType(variable) }
}

/** The `{key, value, type}` entries of a `map` field, ignoring anything malformed. */
export function mapEntries(value: unknown): MapEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is MapEntry =>
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as MapEntry).key === 'string' &&
      typeof (entry as MapEntry).value === 'string' &&
      typeof (entry as MapEntry).type === 'string',
  )
}
