import type { Manifest, WorkflowDefinition } from '@hatua/schema'
import { type Diagnostic, raise } from './diagnostic'
import { own, walkDocument } from './tree'

/**
 * Connection rules. Two families, and they fail at different moments on purpose.
 *
 * The only rules here that cannot be answered from the Workflow Definition. A
 * Connection stores an opaque `ref` and nothing else (ADR-0007), so what type it
 * is comes from the Host — which makes absence a third answer these rules have
 * to hold, distinct from "matches" and "does not match". ADR-0022 is why that
 * answer is silence rather than a diagnostic.
 */

type ManifestIndex = ReadonlyMap<string, Manifest>

/** Takes flat manifests. Catalogues are flattened at load time, not here. */
export const indexManifests = (manifests: readonly Manifest[]): ManifestIndex =>
  new Map(manifests.map((m) => [m.use, m]))

/**
 * What the Host says each established Connection is, keyed by the opaque `ref` a
 * Workflow Definition stores.
 *
 * A map rather than a `(ref) => type | undefined` function so that a missing
 * entry means one thing and one thing only: the Host listed its Connections and
 * this handle was not among them. A function returning `undefined` cannot say
 * whether it was asked before the Host answered.
 *
 * **An empty map is an answer.** It says the Host has established no Connections
 * — a fresh environment, and a legitimate one. `undefined` in its place is the
 * other case entirely: nobody can describe them, because no `ConnectionSource`
 * is wired or the one that is would not answer.
 *
 * The two must not look alike. Collapsed, every Connection in the workflow is
 * CONNECTION_UNRESOLVABLE on first paint — so a workflow with nothing wrong with
 * it cannot be published, and every `conn` field carries a sentence saying its
 * Connection is gone. It clears when the port answers, and for a Host that wires
 * no port it never clears at all.
 */
export type ConnectionTypes = ReadonlyMap<string, string>

/**
 * Whether a Connection points at anything.
 *
 * Empty is not established, and not merely `null`: the schema types `ref` as a
 * string or null with no `minLength`, so `ref: ""` parses, and a handle of no
 * characters resolves to nothing anywhere. Shared by both rules below because
 * they must agree — one treating `""` as a handle and the other as an absence is
 * a Connection reported unresolvable and never reported unfinished, which is a
 * workflow that cannot be published and does not say why.
 */
const established = (ref: string | null | undefined): ref is string =>
  typeof ref === 'string' && ref.trim() !== ''

/**
 * A connection with no `ref` was never established. That blocks publish but not
 * editing — you can lay out a whole workflow before wiring up its connections,
 * and forcing the connection first would make the builder unusable on a fresh
 * environment.
 *
 * Answered from the document alone, so it is reported whether or not anything
 * can describe a Connection.
 */
export function unresolvedConnections(doc: WorkflowDefinition): Diagnostic[] {
  return (doc.connections ?? [])
    .filter((c) => !established(c.ref))
    .map((c) => raise('CONNECTION_NOT_ESTABLISHED', { connectionId: c.id }, { name: c.id }))
}

/**
 * A `conn` field offers only connections whose Host-reported type matches its
 * `conn_type` — so a "send email" step is never handed an LLM connection. Both
 * codes that decide it block editing, because unlike a missing connection
 * neither is a legitimate intermediate state: each can only arise from a
 * hand-edit.
 *
 * **`types` is optional, and its absence is not an error.** Handed nothing, this
 * reports only what the document answers on its own — a field naming a
 * Connection the document does not declare — and says nothing about the two
 * questions that need a type. Reporting those anyway would say "no longer
 * resolves" about every Connection in the workflow before the Host has spoken,
 * which refuses Publish to a workflow with nothing wrong with it. See ADR-0022.
 */
export function mismatchedConnections(
  doc: WorkflowDefinition,
  manifests: ManifestIndex,
  types?: ConnectionTypes,
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
      if (field.kind !== 'conn') continue
      const connectionId = own(values, field.k)
      if (typeof connectionId !== 'string') continue
      /*
       * Empty is unset, not wrong.
       *
       * A `conn` field nobody has filled in yet holds `''`, and reading that as
       * a name would report `"" is not declared in this workflow` — a sentence
       * about a Connection called nothing, over a field whose actual problem is
       * that it is empty. `req:` already says so, and says it in the words the
       * user can act on. The same call `expressionRules` makes about a blank
       * Template: a field left alone is not a field filled in wrongly.
       */
      if (connectionId.trim() === '') continue

      const connection = byId.get(connectionId)
      if (!connection) {
        // A name, not a type: this is wrong whatever the Host says, and a field
        // that declares no `conn_type` still cannot hold a Connection that does
        // not exist.
        out.push(
          raise(
            'CONNECTION_UNKNOWN',
            { ...subject, connectionId, fieldKey: field.k },
            { name: connectionId },
          ),
        )
        continue
      }
      // An unestablished connection has no type yet; that is reported separately.
      if (!established(connection.ref)) continue
      // Nothing to match against, and a field that accepts any type has nothing
      // to be wrong about.
      if (!types || !field.conn_type) continue

      const actual = types.get(connection.ref)
      if (!actual) {
        // The Host no longer recognises this handle — revoked, deleted, or
        // pointing at another environment. Silence here would look identical
        // to a matching type.
        out.push(
          raise(
            'CONNECTION_UNRESOLVABLE',
            { ...subject, connectionId: connection.id, fieldKey: field.k },
            { name: connection.id },
          ),
        )
        continue
      }
      if (actual !== field.conn_type) {
        out.push(
          raise(
            'CONNECTION_TYPE_MISMATCH',
            { ...subject, connectionId: connection.id, fieldKey: field.k },
            { label: field.label, wanted: field.conn_type, name: connection.id, actual },
          ),
        )
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
