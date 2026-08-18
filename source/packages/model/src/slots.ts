import type { Slot, ValueType } from '@hatua/expressions'
import type { Manifest, Step } from '@hatua/schema'
import { isMappable } from '@hatua/schema'

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

/**
 * What each field kind's value must produce.
 *
 * `mono` and `textarea` are text that renders differently. `ref` is `unknown` on
 * purpose: a ref field holds whatever it points at, and the check belongs at the
 * far end rather than here.
 */
export const FIELD_KIND_TYPES: Readonly<Record<string, ValueType>> = {
  text: 'text',
  mono: 'text',
  textarea: 'text',
  number: 'number',
  bool: 'boolean',
  enum: 'text',
  secret: 'text',
  conn: 'text',
  ref: 'unknown',
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
    const value = values[field.k]

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
      expectedType: FIELD_KIND_TYPES[field.kind] ?? 'text',
    })
  }

  return slots
}

/**
 * The Slot a branch's `when` resolves into.
 *
 * Separate from `slotsFor` because a branch is not a step and has no manifest —
 * and because its type is not declared anywhere: a condition is a boolean, and
 * that is the whole reason `when: "{{s2.count}} > 0"` can be refused at design
 * time rather than misread at run time.
 */
export const whenSlot = (when: string): Slot => ({
  name: 'when',
  template: when,
  expectedType: 'boolean',
})

/** The verb whose outputs come from its own configuration. */
export const MAPPING_VERB = 'data.map'

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
