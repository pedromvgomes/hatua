/**
 * What a mappable field is, and the one built-in name.
 *
 * There is deliberately no `REFERENCE_PATTERN` regex here. A regex would be a
 * second definition of what a Reference is, and two definitions of one thing
 * disagree eventually — a pattern loose enough to match `{{ s2.count }}` also
 * matches `{{ a + b }}` and calls the whole thing a reference path.
 *
 * A Reference is an AST shape — `isReference()` in `@hatua/expressions` —
 * and this file keeps only what the schema layer genuinely owns.
 */

/**
 * The built-in holding the id of whichever Trigger actually fired. Needed
 * because a workflow may declare several triggers with different payloads, so
 * an expression has to be able to branch on which one started this run.
 */
export const TRIGGER_BUILTIN = 'TRIGGER'

/**
 * Field kinds whose value is a Template. The rest hold literal values only.
 *
 * `map` is here because each of its entries holds one, even though the field
 * itself holds a list rather than a string.
 */
export const MAPPABLE_FIELD_KINDS = ['text', 'mono', 'number', 'textarea', 'ref', 'map'] as const

export const isMappable = (kind: string): boolean =>
  (MAPPABLE_FIELD_KINDS as readonly string[]).includes(kind)
