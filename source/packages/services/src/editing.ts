import { parseWorkflow, type WorkflowDocument } from '@hatua/document'
import type { WorkflowDefinition } from '@hatua/schema'
import type { EditToken, Lease, PublishedVersion, WorkflowStore } from './ports'
import type { EditCommand } from './steps'
import type { Store } from './store'

/**
 * The Draft being edited, and the autosave that keeps the Host's copy level
 * with it.
 *
 * What this store holds is a `WorkflowDocument` — the parsed YAML — and not a
 * `WorkflowDefinition`. ADR-0001 rejects the alternative by name: a typed graph
 * as the source of truth with the document re-serialised on save needs a sync
 * layer between two representations, "and that layer is where divergence bugs
 * live". So a canvas edit is a surgical mutation of the document, taking the
 * same path a text edit takes, and `toJSON()` is a projection for reading that
 * is recomputed and never edited.
 *
 * The consequence to keep hold of: `toJSON()` THROWS when the source is not a
 * valid Workflow Definition, and that is a legitimate state — someone is
 * halfway through typing in Text Mode, or the Host handed us a draft that never
 * validated. The store therefore holds a document that does not currently
 * project, and says so through `definition: null` rather than refusing to open.
 * A store that only held valid documents would be unusable in the one situation
 * a user needs the editor for.
 *
 * Nothing here imports React. That is store.ts's bargain — "the editing engine
 * is testable without a renderer" — and it is load-bearing for this file in
 * particular, because there is no region reading it until the Flow tab and the
 * tests are most of the proof.
 */

/**
 * Where the in-memory document stands against the Host's copy.
 *
 * Not a `status`. The statuses below are phases of the open and nothing else,
 * the way `manifests.ts` argues that "empty" is not a status: a document that
 * has been edited but not yet written is still open and still readable, and
 * folding that into the load phases would make every reader re-check which
 * phases carry a document.
 *
 * `halted` is ADR-0005's decision made visible. A rejected write stops autosave
 * and keeps the in-memory document — it does not retry, and it does not discard
 * what the user typed. Retrying would hammer a Host that has already said no
 * (most often because the lease went to someone else, which will not become
 * true again by asking harder), and discarding would throw away work to resolve
 * a conflict the user has not been told about yet.
 */
export type SaveState =
  | { state: 'saved' }
  /** Edited; a write is scheduled. */
  | { state: 'pending' }
  | { state: 'saving' }
  /** Autosave stopped. The document is intact and still editable. */
  | { state: 'halted'; error: Error }

export interface EditingSnapshot {
  /** The source of truth. Mutated only through `apply`. */
  document: WorkflowDocument
  /** `document.toString()`, recomputed on every change. */
  text: string
  /**
   * The typed projection, or null when the document is not a valid Workflow
   * Definition. Recomputed alongside `text`, never edited — writing to it would
   * be the sync layer ADR-0001 refuses. Every reader takes it from here rather
   * than calling `document.toJSON()`, which throws.
   */
  definition: WorkflowDefinition | null
  /**
   * Why `definition` is null. Not a failure of the store: a document that
   * parses as YAML but is not yet a Workflow Definition is exactly what someone
   * mid-edit in Text Mode has, and it stays open and editable.
   */
  invalid: Error | null
  /** True when `openDraft` resumed someone's existing Draft rather than making one. */
  resumed: boolean
  lease: Lease
  save: SaveState
  /** What `undo()` would undo, and `redo()` redo. Null when the stack is empty. */
  undoLabel: string | null
  redoLabel: string | null
}

export type EditingState =
  | { status: 'opening' }
  | { status: 'ready'; workflow: EditingSnapshot }
  | { status: 'failed'; error: Error }

export interface EditingStore extends Store<EditingState> {
  /**
   * Open the Draft, once. Idempotent for the same reason `ManifestStore.load`
   * is — every region calls it on mount without coordinating — and lazy for a
   * stronger one here: `openDraft` CLAIMS the edit. A Host that mounts only the
   * run viewer must not take a lease on a workflow nobody is editing.
   */
  open(): void
  /** Open again, discarding whatever is held. This is what a Retry does. */
  reopen(): void

  /**
   * Run a command against the document and record it for undo.
   *
   * A command that throws changes nothing and records nothing, so a stale
   * insertion point is a no-op rather than half an edit.
   */
  apply(command: EditCommand): void

  undo(): void
  redo(): void

  /** Write now rather than waiting out the autosave delay. */
  flush(): Promise<void>

  publish(): Promise<PublishedVersion>
  release(): Promise<void>
  discard(): Promise<void>

  /**
   * Cancel the pending write and the lease renewal.
   *
   * Reversible: a later `open()` revives the store and opens again. That is not
   * a nicety — React's StrictMode runs an effect's cleanup and then the effect
   * again on the same mount, so a provider that disposes on cleanup would
   * otherwise leave a permanently dead store behind in development and nowhere
   * else. Subscribers are deliberately left attached, because the components
   * holding them have not gone anywhere.
   */
  dispose(): void
}

export interface EditingOptions {
  /** Quiet period before an edit is written. */
  autosaveDelayMs?: number
}

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))

const OPENING: EditingState = { status: 'opening' }
const SAVED: SaveState = { state: 'saved' }
const PENDING: SaveState = { state: 'pending' }
const SAVING: SaveState = { state: 'saving' }

/**
 * Deep enough to undo a session's work and bounded so a long one cannot grow
 * without limit. Each entry is a copy of the document's text, which is the
 * whole cost of the approach below.
 */
const HISTORY_LIMIT = 100

/**
 * The longest a renewal will ever be deferred.
 *
 * `setTimeout` truncates its delay to a 32-bit signed integer — anything past
 * ~24.8 days wraps and fires on the NEXT TICK, which turns "renew in a decade"
 * into a renewal every millisecond forever. A Host with a long-lived lease is
 * not a mistake, so the cap is here rather than a warning in a docstring;
 * renewing a generous lease more often than it strictly needs costs one call.
 */
const MAX_RENEWAL_DELAY_MS = 15 * 60_000

/** A point the document can be restored to, and the change that left it. */
interface Revision {
  text: string
  label: string
}

export function createEditingStore(
  port: WorkflowStore,
  workflowId: string,
  options: EditingOptions = {},
): EditingStore {
  const autosaveDelayMs = options.autosaveDelayMs ?? 800

  let state: EditingState = OPENING
  const listeners = new Set<() => void>()

  // Bumped per open, so a reopen that overtakes an in-flight open wins — the
  // same guard manifests.ts carries, and it matters more here because the loser
  // would be holding a token for a lease the winner has replaced.
  let generation = 0
  let started = false
  let disposed = false

  let document: WorkflowDocument | null = null
  let token: EditToken | null = null
  let lease: Lease | null = null
  let resumed = false
  let save: SaveState = SAVED

  /*
   * Undo by restoring text, not by replaying an inverse.
   *
   * Every alternative asks each command to describe how to undo itself, which
   * is a second implementation of the edit that has to stay in step with the
   * first — and gets it wrong in exactly the cases that matter: a `moveStep`
   * whose inverse has to know the index the node came from, a `removeStep`
   * whose inverse has to rebuild a subtree with its comments. Restoring the
   * previous text needs none of that, and it is not lossy, because the text IS
   * the source of truth (ADR-0001). Re-parsing text T yields a document that
   * serialises back to exactly T.
   */
  let history: Revision[] = []
  let future: Revision[] = []

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let leaseTimer: ReturnType<typeof setTimeout> | undefined

  /** The text last accepted by the Host, so a write can tell whether it is still current. */
  let savedText = ''

  const notify = () => {
    // Copied: a listener may unsubscribe while being notified — React does
    // exactly that when a subscribed component unmounts during a render this
    // very notification triggered.
    for (const listener of [...listeners]) listener()
  }

  const publishState = (next: EditingState) => {
    state = next
    notify()
  }

  /**
   * Rebuild the snapshot from whatever the mutable fields currently hold.
   *
   * One place, so `getSnapshot`'s referential stability is a property of this
   * function rather than a rule every call site has to remember. Everything
   * derived — the text, the projection, the undo labels — is recomputed here
   * and nowhere else.
   */
  const commit = () => {
    if (!document || !lease) return
    const projection = document.validate()
    publishState({
      status: 'ready',
      workflow: {
        document,
        text: document.toString(),
        definition: projection.success ? projection.data : null,
        invalid: projection.success
          ? null
          : new Error(projection.error.issues[0]?.message ?? 'Not a valid Workflow Definition'),
        resumed,
        lease,
        save,
        undoLabel: history.at(-1)?.label ?? null,
        redoLabel: future.at(-1)?.label ?? null,
      },
    })
  }

  const setSave = (next: SaveState) => {
    save = next
    commit()
  }

  const cancelSave = () => {
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = undefined
  }

  const halt = (cause: unknown) => {
    cancelSave()
    setSave({ state: 'halted', error: asError(cause) })
  }

  const write = async () => {
    saveTimer = undefined
    if (disposed || !document || !token) return
    // Halted stays halted until something clears it. Nothing does yet, and that
    // is the decision rather than an omission: recovering from a rejected write
    // means telling the user their claim is gone and offering to reopen, which
    // is the toolbar's screen to render.
    if (save.state === 'halted') return

    const mine = generation
    const attempted = document.toString()
    if (attempted === savedText) {
      setSave(SAVED)
      return
    }

    setSave(SAVING)
    try {
      await port.saveDraft(token, attempted)
    } catch (cause) {
      if (mine === generation) halt(cause)
      return
    }
    if (mine !== generation || disposed) return

    savedText = attempted
    // The user kept typing while that was in flight, so the Host's copy is
    // already behind again. Reschedule rather than reporting `saved`, which
    // would tell them their last few edits were written when they were not.
    if (document.toString() === attempted) setSave(SAVED)
    else schedule()
  }

  const schedule = () => {
    if (disposed || save.state === 'halted') return
    cancelSave()
    setSave(PENDING)
    saveTimer = setTimeout(() => {
      void write()
    }, autosaveDelayMs)
  }

  /**
   * Renew at the halfway mark, so one lost renewal still leaves a full half of
   * the lease to try again in. ADR-0005 requires the Host to hold the lease
   * precisely because a browser can vanish; the client's job is only to keep
   * saying it is still here.
   */
  const scheduleRenewal = () => {
    if (leaseTimer !== undefined) clearTimeout(leaseTimer)
    leaseTimer = undefined
    if (disposed || !lease) return

    const remaining = Date.parse(lease.expiresAt) - Date.now()
    // Both ends are clamped, and both clamps stop the same failure. An
    // unparseable or already-expired `expiresAt` must not become a busy loop —
    // a Host that sends one has a bug, and a renewal a second from now surfaces
    // it without spinning. A far-future one must not either: setTimeout
    // truncates to 32 bits, so an uncapped delay would wrap and fire
    // immediately, again and again.
    const half = Number.isFinite(remaining) ? Math.floor(remaining / 2) : 1000
    const delay = Math.min(Math.max(1000, half), MAX_RENEWAL_DELAY_MS)

    leaseTimer = setTimeout(() => {
      void renew()
    }, delay)
  }

  const renew = async () => {
    leaseTimer = undefined
    if (disposed || !token) return
    const mine = generation

    try {
      const next = await port.renewLease(token)
      if (mine !== generation || disposed) return
      lease = next
      commit()
      scheduleRenewal()
    } catch (cause) {
      if (mine !== generation || disposed) return
      // A lost lease is a rejected write that has not happened yet: the claim
      // is gone, so the next save would be refused anyway. Halting now stops
      // autosave from finding that out the expensive way, and keeps the
      // in-memory document exactly as ADR-0005 requires.
      halt(cause)
    }
  }

  const openDraft = () => {
    started = true
    disposed = false
    const mine = ++generation

    cancelSave()
    if (leaseTimer !== undefined) clearTimeout(leaseTimer)
    leaseTimer = undefined

    document = null
    token = null
    lease = null
    history = []
    future = []
    save = SAVED
    savedText = ''

    if (state.status !== 'opening') publishState(OPENING)

    const settle = (cause: unknown) => {
      if (mine === generation) publishState({ status: 'failed', error: asError(cause) })
    }

    // The try/catch is not redundant with the rejection handler: `openDraft` is
    // a plain method on the Host's object and nothing obliges it to be `async`,
    // so one that throws synchronously would throw straight back out of
    // `open()` — which a region calls inside an effect and a Retry button calls
    // from a click handler. The same reasoning manifests.ts spells out.
    try {
      port.openDraft(workflowId).then((session) => {
        if (mine !== generation || disposed) return
        try {
          document = parseWorkflow(session.yaml)
        } catch (cause) {
          // Unparseable YAML, or a multi-document file @hatua/document refuses.
          // There is no editing this: every command reaches through the AST,
          // and there is no AST. A document that parses but does not VALIDATE
          // is the opposite case and opens normally — see `definition`.
          settle(cause)
          return
        }
        token = session.token
        lease = session.lease
        resumed = session.resumed
        savedText = document.toString()
        save = SAVED
        commit()
        scheduleRenewal()
      }, settle)
    } catch (cause) {
      settle(cause)
    }
  }

  /** Restore a revision, keeping the counterpart stack in step. */
  const travel = (from: Revision[], to: Revision[]) => {
    if (!document) return
    const revision = from.pop()
    if (!revision) return

    to.push({ text: document.toString(), label: revision.label })
    // Re-parsed rather than mutated back. The text is the source of truth, so a
    // document parsed from it is the same document — including the comments and
    // the quoting, which is what the round-trip tests assert.
    document = parseWorkflow(revision.text)
    schedule()
    commit()
  }

  const requireToken = (): EditToken => {
    if (!token) throw new Error('No Draft is open')
    return token
  }

  /**
   * Publish, Release and Discard all end the session; none of them leaves
   * autosave running.
   *
   * The token goes with it. Every caller reads it out first, and dropping it
   * here is what stops a later edit from writing to a Draft this session no
   * longer holds — released, discarded, or promoted to a Published Version that
   * is immutable by definition. The document stays, and stays editable; it is
   * simply no longer being saved anywhere, which is the truth.
   */
  const finish = () => {
    cancelSave()
    if (leaseTimer !== undefined) clearTimeout(leaseTimer)
    leaseTimer = undefined
    generation++
    token = null
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    open() {
      // `disposed` counts as "not started": see dispose().
      if (!started || disposed) openDraft()
    },
    reopen: openDraft,

    apply(command) {
      if (!document) return
      const before = document.toString()

      try {
        command.apply(document)
      } catch {
        // Deliberately swallowed. A command throws when the tree it was built
        // against has moved on — a Step removed under a stale insertion point,
        // most likely — and the document is untouched, so there is nothing to
        // report and nothing to roll back. Half-applied is the failure worth
        // preventing, and `apply` cannot half-apply: every command does its
        // lookups before its first mutation.
        return
      }

      const after = document.toString()
      if (after === before) return

      history.push({ text: before, label: command.label })
      if (history.length > HISTORY_LIMIT) history.shift()
      // A new edit makes the redo stack unreachable: there is no longer one
      // future to walk back into.
      future = []

      schedule()
      commit()
    },

    undo() {
      travel(history, future)
    },
    redo() {
      travel(future, history)
    },

    flush() {
      cancelSave()
      return write()
    },

    async publish() {
      const held = requireToken()
      if (!document) throw new Error('No Draft is open')
      const yaml = document.toString()
      finish()
      // Publish sends the current text rather than the last text the Host
      // accepted. Autosave may still have been pending, and publishing a
      // version that silently omits the user's last edit is the one outcome
      // worse than a rejected publish.
      return port.publish(held, yaml)
    },

    async release() {
      const held = requireToken()
      finish()
      return port.releaseDraft(held)
    },

    async discard() {
      const held = requireToken()
      finish()
      return port.discardDraft(held)
    },

    dispose() {
      disposed = true
      finish()
    },
  }
}
