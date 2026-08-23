import type { Manifest, WorkflowDefinition } from '@hatua/schema'
import { walkDocument } from './tree'

/**
 * Connection rules. Two of them, and they fail at different moments on purpose.
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
  connectionId?: string
  fieldKey?: string
}

type ManifestIndex = ReadonlyMap<string, Manifest>

/** Takes flat manifests. Catalogues are flattened at load time, not here. */
export const indexManifests = (manifests: readonly Manifest[]): ManifestIndex =>
  new Map(manifests.map((m) => [m.use, m]))

/**
 * A connection with no `ref` was never established. That blocks publish but not
 * editing — you can lay out a whole workflow before wiring up its connections,
 * and forcing the connection first would make the builder unusable on a fresh
 * environment.
 */
export function unresolvedConnections(doc: WorkflowDefinition): Diagnostic[] {
  return (doc.connections ?? [])
    .filter((c) => c.ref === null || c.ref === undefined)
    .map((c) => ({
      code: 'CONNECTION_NOT_ESTABLISHED',
      message: `"${c.id}" is not connected yet. Connect it before publishing.`,
      blocks: 'publish' as const,
      connectionId: c.id,
    }))
}

/**
 * A `conn` field offers only connections whose Host-reported type matches its
 * `conn_type` — so a "send email" step is never handed an LLM connection. This
 * one blocks editing, because unlike a missing connection it is never a
 * legitimate intermediate state: it can only arise from a hand-edit.
 */
export function mismatchedConnections(
  doc: WorkflowDefinition,
  manifests: ManifestIndex,
  typeOf: (ref: string) => string | undefined,
): Diagnostic[] {
  const byId = new Map((doc.connections ?? []).map((c) => [c.id, c]))
  const out: Diagnostic[] = []

  const check = (
    subject: Partial<Diagnostic>,
    use: string,
    values: Record<string, unknown> | undefined,
  ) => {
    const manifest = manifests.get(use)
    if (!manifest) return
    for (const field of manifest.fields) {
      if (field.kind !== 'conn' || !field.conn_type) continue
      const connectionId = values?.[field.k]
      if (typeof connectionId !== 'string') continue

      const connection = byId.get(connectionId)
      if (!connection) {
        out.push({
          code: 'CONNECTION_UNKNOWN',
          message: `"${connectionId}" is not declared in this workflow.`,
          blocks: 'edit',
          ...subject,
          fieldKey: field.k,
        })
        continue
      }
      // An unestablished connection has no type yet; that is reported separately.
      if (!connection.ref) continue

      const actual = typeOf(connection.ref)
      if (!actual) {
        // The Host no longer recognises this handle — revoked, deleted, or
        // pointing at another environment. Silence here would look identical
        // to a matching type.
        out.push({
          code: 'CONNECTION_UNRESOLVABLE',
          message: `"${connection.id}" no longer resolves. Reconnect it or pick another.`,
          blocks: 'publish',
          ...subject,
          connectionId: connection.id,
          fieldKey: field.k,
        })
        continue
      }
      if (actual !== field.conn_type) {
        out.push({
          code: 'CONNECTION_TYPE_MISMATCH',
          message: `${field.label} needs a ${field.conn_type} connection, but "${connection.id}" is ${actual}.`,
          blocks: 'edit',
          ...subject,
          connectionId: connection.id,
          fieldKey: field.k,
        })
      }
    }
  }

  // Every Board, not `doc.steps`: a `conn` field inside a Block is a `conn`
  // field, and two of the codes above block editing — so skipping one would
  // lock a document over a Step nothing reported.
  for (const { step, board } of walkDocument(doc)) {
    check(
      { stepId: step.id, ...(board === null ? {} : { blockId: board }) },
      step.use,
      step.with as Record<string, unknown> | undefined,
    )
  }

  for (const trigger of doc.triggers ?? []) {
    check(
      { triggerId: trigger.id },
      trigger.use,
      trigger.with as Record<string, unknown> | undefined,
    )
  }

  return out
}
