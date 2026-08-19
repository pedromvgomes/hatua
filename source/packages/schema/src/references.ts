/**
 * What a mappable field is, and the one built-in name.
 *
 * There used to be a `REFERENCE_PATTERN` regex here, and it was a *second*
 * definition of what a Reference is. Two definitions of one thing disagree
 * eventually, and that one already did: it matched `{{ a + b }}` and called the
 * whole thing a reference path.
 *
 * A Reference is now an AST shape — `isReference()` in `@hatua/expressions` —
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
