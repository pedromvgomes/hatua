import type { ManifestEntry, WorkflowExecution } from '@hatua/schema'

/**
 * What the Host implements. Hatua stores nothing and runs nothing, so every
 * one of these is a seam where Hatua stops and the Host begins.
 */

/**
 * Every unbounded list is paged. A Host with a small set returns one page and
 * omits `next`; a Host with years of run history returns a cursor.
 */
export interface Cursor<T> {
  items: T[]
  /** Opaque token for the next page. Absent when exhausted. */
  next?: string
  /** Optional — omit when the backend cannot count cheaply. */
  total?: number
}

/** Opaque, minted by storage. Holding one is what proves you own the edit. */
export type EditToken = string & { readonly __brand: 'EditToken' }

export interface Lease {
  token: EditToken
  /** When the claim lapses if not renewed. */
  expiresAt: string
}

export interface DraftSession {
  token: EditToken
  lease: Lease
  /** The draft's YAML, whether just created from the live version or resumed. */
  yaml: string
  /** True when an existing draft was resumed rather than a new one created. */
  resumed: boolean
}

export interface VersionSummary {
  version: number
  status: 'published' | 'draft' | 'archived'
  updatedAt: string
}

export interface PublishedVersion {
  version: number
  publishedAt: string
}

/**
 * Storage is a dumb key–value store: Hatua owns versioning, the Host owns bytes.
 * Pushing versioning outward would mean every Host reinvents it, and Hatua could
 * then rely on nothing — no diffing versions, no restoring one, no showing what
 * changed between runs.
 */
export interface WorkflowStore {
  /**
   * Create a draft, or resume the existing one, and claim the edit — atomically.
   * Splitting create from resume would race: between checking whether a draft
   * exists and claiming it, another user can create one.
   */
  openDraft(workflowId: string): Promise<DraftSession>

  /** Autosave. There is no Save button; the user decides only Publish and Release. */
  saveDraft(token: EditToken, yaml: string): Promise<void>

  /** Keeps an exclusive claim alive while the editor is open. */
  renewLease(token: EditToken): Promise<Lease>

  /**
   * Promote the draft. The Host rejects this if the version the draft branched
   * from is no longer the live one — conflict is detected here, not at save,
   * because only publish can collide.
   */
  publish(token: EditToken, yaml: string): Promise<PublishedVersion>

  /** Stop editing, keep the draft for whoever picks it up next. */
  releaseDraft(token: EditToken): Promise<void>

  /** Throw the draft away; the workflow reverts to its live Published Version. */
  discardDraft(token: EditToken): Promise<void>

  listVersions(workflowId: string, cursor?: string): Promise<Cursor<VersionSummary>>

  /** YAML text of one version. This is how an execution resolves its definition. */
  loadVersion(workflowId: string, version: number): Promise<string>
}

/**
 * Deliberately NOT paged. The Components tab groups and searches across the
 * whole catalogue, so paging would break search — and a manifest set is bounded
 * by design in a way run history is not.
 *
 * ## One port, three kinds
 *
 * Component Manifests, Trigger Manifests and the Host's Run Context all arrive
 * here, in one flat array whose entries carry `kind`. They answer the same
 * question — *what has this Host declared?* — and a port of its own for Run
 * Context would buy a second store, a second loading state and a second failure
 * state for a payload that is a handful of typed keys.
 *
 * ## Why widening the element type does not reopen the hazard below
 *
 * The comment on `loadManifests` used to warn against a union here, and the
 * warning still stands — for the union it was about. `ComponentManifest` is
 * "one manifest OR a `components:` catalogue", and its second arm is a
 * container: an object with no `kind` at all. That is what makes
 * `[{ components: [...] }]` typecheck and then vanish, because every consumer
 * reaches for `.kind` and finds nothing.
 *
 * `ManifestEntry` is a different construction. Every arm is an entry, every arm
 * carries a required literal `kind`, and the catalogue shape satisfies none of
 * them — so the compiler refuses it at the seam instead of a screen going empty
 * three frames later. The rule the hazard actually names is *no undiscriminated
 * container arm*, not *no union*, and this keeps it.
 *
 * The runtime half is `createManifestStore`, which still checks: a type is a
 * promise the Host makes and an endpoint can break it.
 */
export interface ManifestSource {
  /**
   * Flat entries, never a catalogue. Use `loadManifests()` from @hatua/sdk,
   * which flattens a `components:` catalogue into one — and concatenate the
   * Run Context declaration onto the result if the Host serves one.
   *
   * Absent and declared-empty are different answers and both are legitimate: a
   * Host with no Run Context simply returns no `kind: context` entry, which is
   * not the same as returning one whose `keys` are empty.
   */
  loadManifests(): Promise<ManifestEntry[]>
}

export interface ExecutionSummary {
  runId: string
  status: 'running' | 'succeeded' | 'failed'
  startedAt: string
  durationMs?: number
}

/** Omit entirely and the Runs view is hidden. */
export interface ExecutionSource {
  listExecutions(workflowId: string, cursor?: string): Promise<Cursor<ExecutionSummary>>
  loadExecution(runId: string): Promise<WorkflowExecution>
}

export interface ConnectionSummary {
  /** The opaque handle a Workflow Definition stores. */
  ref: string
  /** Matched against a `conn` field's `conn_type`. */
  type: string
}

/**
 * Editor only — the run viewer never picks or creates a connection.
 *
 * Connections are established outside Hatua: it has no server, so it can hold
 * no client secret and receive no OAuth redirect. `createConnection` lets Hatua
 * render "+ New connection" and *invoke* a flow the Host owns, then refetch.
 */
export interface ConnectionSource {
  listConnections(cursor?: string): Promise<Cursor<ConnectionSummary>>
  createConnection?(type: string): Promise<ConnectionSummary | null>
}

export interface ConnectionDescription {
  type: string
  /** What the user sees, e.g. "Claude Code · Haiku 4.5". */
  label: string
  hint?: string
  status: 'ready' | 'expired' | 'revoked' | 'unknown'
  /** Relevant field values, shown when inspecting a connection while building. */
  details: Record<string, string>
}

/**
 * Separate from ConnectionSource because the detachable run viewer needs to
 * describe the connections a run used, but never lists or creates any — so a
 * viewer-only Host implements just this one.
 */
export interface ConnectionDescriber {
  describe(ref: string): Promise<ConnectionDescription>
}
