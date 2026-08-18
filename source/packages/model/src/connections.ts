import type { ComponentManifest, WorkflowDefinition } from '@hatua/schema'

/**
 * Connection rules. Two of them, and they fail at different moments on purpose.
 */

export interface Diagnostic {
  code: string
  message: string
  /** Where it surfaces: an unconnected connection must not block editing. */
  blocks: 'edit' | 'publish'
  stepId?: string
  connectionId?: string
  fieldKey?: string
}

type ManifestIndex = ReadonlyMap<string, ComponentManifest>

export const indexManifests = (manifests: readonly ComponentManifest[]): ManifestIndex =>
  new Map(manifests.filter((m) => 'use' in m).map((m) => [m.use as string, m]))

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

  const check = (stepId: string, use: string, values: Record<string, unknown> | undefined) => {
    const manifest = manifests.get(use)
    if (!manifest || !('fields' in manifest)) return
    for (const field of manifest.fields ?? []) {
      if (field.kind !== 'conn' || !field.conn_type) continue
      const connectionId = values?.[field.k]
      if (typeof connectionId !== 'string') continue

      const connection = byId.get(connectionId)
      if (!connection) {
        out.push({
          code: 'CONNECTION_UNKNOWN',
          message: `"${connectionId}" is not declared in this workflow.`,
          blocks: 'edit',
          stepId,
          fieldKey: field.k,
        })
        continue
      }
      // An unestablished connection has no type yet; that is reported separately.
      if (!connection.ref) continue

      const actual = typeOf(connection.ref)
      if (actual && actual !== field.conn_type) {
        out.push({
          code: 'CONNECTION_TYPE_MISMATCH',
          message: `${field.label} needs a ${field.conn_type} connection, but "${connection.id}" is ${actual}.`,
          blocks: 'edit',
          stepId,
          connectionId: connection.id,
          fieldKey: field.k,
        })
      }
    }
  }

  const walk = (steps: WorkflowDefinition['steps']) => {
    for (const step of steps) {
      check(step.id, step.use, step.with as Record<string, unknown> | undefined)
      for (const branch of step.branches ?? []) walk(branch.steps)
      if (step.steps) walk(step.steps)
    }
  }
  walk(doc.steps)

  for (const trigger of doc.triggers ?? []) {
    check(trigger.id, trigger.use, trigger.with as Record<string, unknown> | undefined)
  }

  return out
}
