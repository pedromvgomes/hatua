import { DEFINITION_DIAGNOSTICS, type DefinitionCode } from './generated/diagnostics'

/**
 * One thing wrong with a Workflow Definition, and the vocabulary every rule
 * family raises it in.
 *
 * Its own module because it belongs to no one family. A rule about a Fork's
 * branches, a Reference naming nothing and a Connection whose type does not fit
 * are all this shape, and putting the shape inside whichever file happened to
 * need it first makes every other family import from that one.
 */
export interface Diagnostic {
  code: string
  message: string
  /** Where it surfaces: an unconnected connection must not block editing. */
  blocks: 'edit' | 'publish'
  stepId?: string
  /**
   * Set instead of `stepId` when the subject is a Trigger.
   *
   * Separate because a Trigger is not a Step and the two are rendered by
   * different regions: the Flow tab looks a Step's id up in `byStep`, and a
   * Trigger's id filed there is either drawn by nobody or — if a hand-edited
   * Trigger id happens to match a Step's — painted on that Step's row.
   */
  triggerId?: string
  /**
   * Which Board the subject sits on: a Block's id, or absent for the root.
   *
   * Set ALONGSIDE `stepId`, not instead of it: a step id alone does not name one
   * Step, because ids are Board-local — two Blocks may each hold a `ret`.
   * Set on its own when the subject is the Block itself: "a path through this
   * block can finish without returning" belongs to no Step in it.
   */
  blockId?: string
  /**
   * Which Connection the diagnostic is about.
   *
   * Set ALONGSIDE `stepId` when a field's Connection is the thing at fault, so
   * the diagnostic still files under the Step whose field the user can act on.
   * Set on its own when the subject is the Connection itself — "this was never
   * connected" belongs to no Step, because a declared Connection nothing uses
   * is still unfinished.
   */
  connectionId?: string
  fieldKey?: string
}

/**
 * Fill a declared message's `{name}` holes from the fields a diagnostic carries.
 *
 * Exported because the generated table carries templates, and a Host reading
 * `DEFINITION_DIAGNOSTICS[code].message` itself would get the literal braces.
 * The Go SDK's `FormatDefinitionMessage` is the same function.
 *
 * A hole with no field keeps its braces rather than becoming empty: a sentence
 * missing a word reads as a bug in Hatua, and one still holding `{label}` reads
 * as a diagnostic raised without the field it names — which is what it is.
 */
export const formatDefinitionMessage = (
  code: DefinitionCode,
  fields: Record<string, string> = {},
): string =>
  DEFINITION_DIAGNOSTICS[code].message.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.hasOwn(fields, name) ? (fields[name] ?? whole) : whole,
  )

/** One diagnostic, taking `blocks` from the declaration rather than restating it. */
export const raise = (
  code: DefinitionCode,
  subject: Partial<Diagnostic>,
  fields?: Record<string, string>,
): Diagnostic => ({
  code,
  message: formatDefinitionMessage(code, fields),
  blocks: DEFINITION_DIAGNOSTICS[code].blocks,
  ...subject,
})
