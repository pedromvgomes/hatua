/**
 * Reference helpers. Hand-written, not generated: a Reference is a string as far
 * as the schema is concerned, and everything interesting about it is behaviour.
 */

/**
 * Matches one `{{source.path}}` token. References are stored verbatim in the
 * YAML, so renaming a step never breaks one.
 *
 * Deliberately NOT global. A shared /g regex carries mutable `lastIndex` across
 * every consumer: alternating `.test()` calls on the same string return true,
 * false, true…, and an abandoned `exec()` loop leaves the next caller starting
 * mid-string. Call `referencePattern()` when you need to iterate.
 */
export const REFERENCE_PATTERN = /\{\{([^}]+)\}\}/

/** A fresh global matcher, safe to iterate — no shared state. */
export const referencePattern = (): RegExp => /\{\{([^}]+)\}\}/g

/**
 * The built-in holding the id of whichever Trigger actually fired. Needed
 * because a workflow may declare several triggers with different payloads, so
 * an expression has to be able to branch on which one started this run.
 */
export const TRIGGER_BUILTIN = 'TRIGGER'

/** Field kinds that accept a Reference. The rest hold literal values only. */
export const MAPPABLE_FIELD_KINDS = ['text', 'mono', 'number', 'textarea', 'ref'] as const

export const isMappable = (kind: string): boolean =>
  (MAPPABLE_FIELD_KINDS as readonly string[]).includes(kind)
