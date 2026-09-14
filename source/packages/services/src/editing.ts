import { parseWorkflow, type WorkflowDocument } from '@hatua/document'
import { logger } from '@hatua/log'
import type { Diagnostic } from '@hatua/model'
import type { WorkflowDefinition } from '@hatua/schema'
import type { EditCommand } from './command'
import type { EditToken, Lease, PublishedVersion, WorkflowStore } from './ports'
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

/**
 * What stops a **Publish**, asked at the moment one is attempted.
 *
 * A function rather than a value because the answer is not always available
 * yet: the catalogue may still be arriving, and `ValidationStore` distinguishes
 * "the Host's Connections are not known yet" from "nobody can say". `pending`
 * resolves, so the gate waits for it; `undescribed` never will, so the gate
 * narrows and answers. See ADR-0023 for the whole table.
 *
 * Injected rather than read, because `ValidationStore` is built FROM this store
 * and subscribes to it. What unties the knot is that validation needs the
 * editing store continuously while publish needs validation once — so the half
 * that is only needed later is bound later.
 */
export interface PublishGate {
  blockers(): Promise<readonly Diagnostic[]>
}

/**
 * Thrown by `publish()` when the document may not be promoted.
 *
 * It carries a list, for the reason `ExpressionError` carries one: a user
 * fixing one field at a time is a user pressing Publish five times to find five
 * mistakes. The list is empty when the document is not a Workflow Definition at
 * all — there is nothing to attach a diagnostic to, and the message is the
 * whole of what can be said.
 */
export class PublishBlocked extends Error {
  readonly diagnostics: readonly Diagnostic[]

  constructor(diagnostics: readonly Diagnostic[], message?: string) {
    super(message ?? diagnostics.map((one) => one.message).join('; '))
    this.name = 'PublishBlocked'
    this.diagnostics = diagnostics
  }
}

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
  /**
   * Why the last command changed nothing, or null when the last one took.
   *
   * A refused command is a real outcome and was, until now, a silent one: the
   * document is restored, nothing is recorded, and the control that asked
   * re-renders from a document that never moved — which reads as a click that
   * did not register. Every other refusal in this store says why, and this is
   * the one that did not.
   *
   * Cleared by the next command that takes, so it describes the last thing
   * tried rather than accumulating.
   */
  refused: Error | null
  /** True when `openDraft` resumed someone's existing Draft rather than making one. */
  resumed: boolean
  /**
   * Whether this session still holds the edit.
   *
   * False once **Publish**, **Release** or **Discard** has ended it. The
   * document stays, and stays editable — it is simply saved nowhere, which is
   * the truth and is otherwise invisible: a session that ended with nothing
   * queued leaves `save` reading `saved`, so without this a finished session and
   * a live one are the same snapshot and the user finds out by typing.
   *
   * It is also what says whether a halt can be resumed. That is the same fact —
   * a halt with no token has nothing to write to — and asking it once here beats
   * a second field on `SaveState` that means the same thing in one of its arms.
   */
  claimed: boolean
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

  /**
   * Clear a halt and start saving again, on the claim this session still holds.
   *
   * Not the retry ADR-0005 refuses. `halt()` will not retry on its own, and it
   * is right not to — a Host that has said no "will not become true again by
   * asking harder", so a timer behind it hammers a rejection that is most often
   * a lease gone elsewhere. A person pressing a control once, having been told
   * their work is no longer being saved, is a different act.
   *
   * It exists because the alternative was worse. `reopen()` was the only exit
   * from `halted`, and it calls `openDraft()` — which drops the in-memory
   * document and re-parses the Host's copy, discarding exactly the work
   * ADR-0005 halts in order to keep.
   *
   * A no-op unless the store is halted AND still claimed: with the session over
   * there is nothing left to write to, and pretending otherwise puts the
   * snapshot back to `pending` for a write that can never run.
   */
  resumeSaving(): void

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
  /**
   * What blocks a **Publish**. Omit and only the floor below applies — a
   * document that is not a Workflow Definition is still never published.
   *
   * Optional because the gate needs a catalogue, and a Host that serves no
   * `ManifestSource` is correctly configured rather than broken (ADR-0022's
   * argument, at its limit). Such a Host publishes against the floor alone,
   * which ADR-0023 records rather than leaves to be discovered.
   */
  gate?: PublishGate
}

const log = logger('services.editing')

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))

/** Why autosave stopped, for a caller that has to report it rather than render it. */
const reasonFor = (save: SaveState): Error =>
  save.state === 'halted' ? save.error : new Error('The workflow could not be saved.')

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
  let refused: Error | null = null
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

  /*
   * Whether one is in the air.
   *
   * Two overlapping renewals are sent with the SAME token, and only the later
   * ASK is applied — so against a Host that rotates, the loser's answer carries
   * the new credential and is thrown away, while the winner is refused for
   * presenting the old one. The session is then stranded on a token nothing can
   * refresh, and only a reopen recovers it, which discards the work ADR-0005
   * exists to keep.
   *
   * So a second ask does not start: `resumeWanted` is a standing intent, and
   * whichever renewal is already in flight answers it.
   *
   * It holds the GENERATION that took it rather than a flag, so a renewal
   * abandoned by a reopen releases only what it took. A bare flag is cleared by
   * whoever finishes last: the abandoned call returns, clears it, and the live
   * session's renewal — still in the air — is no longer protected, which is the
   * overlap this exists to prevent arrived at from underneath.
   */
  let renewingFor: number | null = null

  /*
   * That a reader has asked for saving to resume, held until some renewal
   * answers it.
   *
   * Not a parameter on the renewal that was asked for, because that one can lose
   * — a halt from a refused write leaves the lease timer armed, so the press and
   * the timer can both be in the air and only the later answer is applied. Held
   * on the request, the resume dies with the request that was superseded: a
   * healthy lease, a dirty document, and autosave refused for ever by a halt
   * nothing goes on to clear.
   */
  let resumeWanted = false

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let leaseTimer: ReturnType<typeof setTimeout> | undefined

  /** The text last accepted by the Host, so a write can tell whether it is still current. */
  let savedText = ''

  /**
   * Writes happen one at a time, in the order they were asked for.
   *
   * Two overlapping `saveDraft` calls can land in either order, and a Host that
   * applies the older one last is left holding text the user has already moved
   * past. A slow Host and a fast typist is all that takes.
   *
   * A queue rather than a "is one open?" flag, because every question a caller
   * asks about a write is really a question about ORDER, and a flag answers
   * none of them: which write owns the flag, whether the one you are waiting
   * for is the one that just finished, whether a write left over from a
   * previous generation may clear it. Chaining sidesteps all three — a write
   * waits its turn, and `flush()` is just another turn, so it resolves when its
   * OWN write has been answered rather than when somebody else's has.
   *
   * What a queued write is not is stale: it reads the document when it runs, so
   * a burst of edits collapses into one write plus a few that find nothing to
   * do.
   *
   * A Host that never answers stalls the queue, and `flush()` with it. That is
   * the honest answer to "tell me when this is written" when it is not written
   * and never will be. `openDraft` starts a FRESH queue, so reopening restores
   * autosave — but a flush already waiting is waiting on the Host, and only the
   * Host can end that. The cost of the reset is that a write abandoned mid-air
   * no longer orders against the new session's; the generation check below is
   * what makes its eventual answer harmless.
   */
  let queue: Promise<unknown> = Promise.resolve()

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
        refused,
        resumed,
        claimed: token !== null,
        lease,
        save,
        undoLabel: history.at(-1)?.label ?? null,
        redoLabel: future.at(-1)?.label ?? null,
      },
    })
  }

  /**
   * Put the document back to `text`, and republish.
   *
   * Both halves matter. The store's own handle is re-parsed because the command
   * has already mutated the one it was given — and the snapshot is rebuilt
   * because `commit` publishes `workflow.document` BY REFERENCE, so a reader
   * holding the last snapshot is otherwise holding exactly the tree that was
   * thrown away. `views/Build` reads it to work out where a Component appends,
   * which is a wrong answer computed off a document nothing else can see.
   *
   * The text is unchanged, so nothing downstream sees an edit: what changes is
   * that the object under it is the one the text describes.
   */
  const restore = (text: string) => {
    try {
      document = parseWorkflow(text)
    } catch {
      // Unreachable while `text` came out of this document, and cheap insurance
      // if it ever does not: a store holding an unparseable document has
      // nothing left to offer.
      return
    }
    commit()
  }

  /**
   * Whether autosave has stopped, read through a call.
   *
   * `save` is reassigned from `halt()`, which runs while an `await` in `attempt`
   * is outstanding — and the compiler's narrowing does not survive that, so a
   * second `save.state === 'halted'` after the await is judged against the type
   * the first one left behind. Asking through a function is what makes the
   * question about the field now rather than about what it was.
   */
  const halted = () => save.state === 'halted'

  /**
   * Whether the document has moved past what the Host last accepted.
   *
   * Guarded, because `toString()` throws on a tree a command left unserialisable
   * — and "cannot be serialised" is not "needs writing", so the honest answer
   * for a document nothing can send is that there is nothing to send.
   */
  const dirty = () => {
    if (!document) return false
    try {
      return document.toString() !== savedText
    } catch {
      return false
    }
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

  /**
   * One write, when its turn comes.
   *
   * Everything it reads — the document, the token, the generation — is read at
   * that point rather than when it was queued, so waiting never makes a write
   * stale, only unnecessary.
   */
  const attempt = async () => {
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

    /*
     * A halt that landed while this write was in the air stands.
     *
     * The write succeeded, so the Host does hold `attempted` and `savedText`
     * above is true — but a lease refused mid-flight halted the session, and
     * reporting `saved` here would clear that halt: the bar would go quiet with
     * no renewal armed and no claim behind it, and autosave would go on writing
     * to a Host that has already said no until the next write is refused.
     */
    if (halted()) return

    // The user kept typing while that was in flight, so the Host's copy is
    // already behind again. Reschedule rather than reporting `saved`, which
    // would tell them their last few edits were written when they were not.
    if (document.toString() === attempted) setSave(SAVED)
    else schedule()
  }

  /** Take a place in the queue, and hand back a promise for that turn alone. */
  const write = (): Promise<void> => {
    // Cancelled, not merely forgotten. Dropping the handle is enough when this
    // is entered from the timer's own callback, and `release()` calls it
    // directly — leaving an armed timeout nothing tracks, which `cancelSave()`
    // and `finish()` then cannot cancel however plainly they say they do.
    cancelSave()
    // Both arms, so one write's failure cannot stop every write after it.
    const mine = queue.then(attempt, attempt)
    queue = mine
    return mine
  }

  /**
   * Queue a write for the quiet period from now.
   *
   * Nothing checks for a token here: every caller reaches this with a claim in
   * hand, because `apply` and `travel` refuse an ended session outright and a
   * renewal only runs while one is held. The edit that ARRIVES with a write
   * already scheduled is `finish()`'s to report, and it does.
   */
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
      leaseTimer = undefined
      void renew()
    }, delay)
  }

  /**
   * Ask the Host to keep the claim alive.
   *
   * `resuming` is the one press that asks for it out of turn. A halt is most
   * often a refused renewal, which fires on a timer — so it lands while nobody
   * is typing and the document is clean, and a resume that only re-entered the
   * write queue would find nothing to write, report `saved`, and assert
   * everything was safe on a claim nothing had re-checked. The renewal IS the
   * check: the halt clears when the Host says the claim is still ours, and not
   * before.
   */
  const renew = async () => {
    /*
     * The armed timer is left alone.
     *
     * `scheduleRenewal` clears before it arms, so a renewal that SUCCEEDS
     * cannot leave two running however it was entered — and one that fails out
     * of `resumeSaving` leaves the timer that was already armed to try again on
     * its own. Cancelling it here would take a healthy renewal down with a
     * transient refusal: before the press the lease would have renewed itself at
     * the half-way mark, and after it the claim would simply lapse.
     *
     * A renewal entered FROM the timer nulls the handle in the callback, so
     * `leaseTimer` always means "one is armed".
     */
    if (disposed || !token) return
    if (renewingFor !== null) {
      /*
       * Asked while one is outstanding. The timer that brought us here has
       * already dropped its handle, so leaving now would lose the renewal
       * altogether — and the one in flight only re-arms if it answers.
       *
       * Only while the lease has time left on it. A renewal that never settles
       * never clears the guard, and `scheduleRenewal`'s floor clamps an expired
       * lease to a second — so re-arming unconditionally turns a Host with no
       * timeout on its request into a timer firing every second for the life of
       * the session, each one bailing here and none making progress. Past the
       * expiry there is nothing left to keep alive: the claim is already gone,
       * and the next write is what finds out.
       */
      if (lease && Date.parse(lease.expiresAt) - Date.now() > 0) scheduleRenewal()
      return
    }
    const mine = generation
    renewingFor = mine

    try {
      const next = await port.renewLease(token)
      if (mine !== generation || disposed) return
      lease = next
      /*
       * And the token with it, because a renewed lease may carry a new one.
       *
       * `Lease` holds a token as well as an expiry, which is only worth carrying
       * if a Host may rotate it — and a Host that does leaves this store writing
       * with a credential it no longer honours: every save refused, then a halt,
       * and a publish, release or discard spending a claim that is not the live
       * one. Reading the renewal's answer rather than only its clock is what
       * makes the field mean something.
       *
       * Only when there IS one. Nothing read this field before, so a Host
       * answering with the expiry alone was correct and may still be — and
       * taking `undefined` from it would end a session whose lease the Host
       * considers perfectly good: the bar swaps to "no longer editing", the next
       * keystroke halts, and all three actions refuse. A type is a promise the
       * Host makes, which is why `versions.ts` checks its pages too.
       */
      if (next.token) token = next.token
      const resuming = resumeWanted
      resumeWanted = false
      if (resuming) save = SAVED
      commit()
      scheduleRenewal()
      // Anything typed before the halt, or during it, still has to reach the
      // Host — and `schedule()` refuses while halted, so this is its first
      // chance. Only when there IS something: scheduling a clean document
      // announces a write that will find nothing to do, which is `pending`
      // meaning "waiting" about a document already level with the Host.
      if (resuming && dirty()) schedule()
    } catch (cause) {
      if (mine !== generation || disposed) return
      // The ask has been answered, even though the answer was no. A later press
      // sets it again.
      resumeWanted = false
      // A lost lease is a rejected write that has not happened yet: the claim
      // is gone, so the next save would be refused anyway. Halting now stops
      // autosave from finding that out the expensive way, and keeps the
      // in-memory document exactly as ADR-0005 requires.
      halt(cause)
    } finally {
      // Only what this call took. A renewal the generation has moved past
      // returns through here while the session that replaced it may already
      // have one of its own outstanding.
      if (renewingFor === mine) renewingFor = null
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
    refused = null
    history = []
    future = []
    save = SAVED
    savedText = ''
    /*
     * The press that asked for saving to resume belonged to the session being
     * replaced. Carried across, a renewal in the NEXT session reads it, clears a
     * halt nobody asked it to clear, and reschedules the write — which is
     * precisely the automatic retry ADR-0005 refuses, arrived at through a flag
     * rather than a timer. A renewal abandoned by a dispose or a generation bump
     * returns before it can clear this itself.
     */
    resumeWanted = false
    /*
     * And whether one is outstanding, which is a fact about the session being
     * replaced. A renewal that never settles — a fetch with no timeout is all it
     * takes — would otherwise leave this set for the life of the store, and
     * every renewal after it returns at the guard: the new session's claim
     * lapses, its writes are refused, and autosave halts on work the reader
     * believes is being saved.
     */
    renewingFor = null
    // Abandoned along with everything else this generation held. A Host whose
    // `saveDraft` never settles — a fetch with no timeout is all it takes —
    // would otherwise leave this set for the life of the store, and every
    // write after it would return at the guard above: autosave dead for good,
    // the panel stuck on `pending`, and reopening no help at all. The
    // abandoned call belongs to a token this session no longer holds, so
    // whatever it eventually does is the Host's business.
    queue = Promise.resolve()

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
    // No claim, no edits — undo and redo change the document exactly as a
    // command does, and land in the same place: nowhere.
    if (!document || !token) return
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
   * One last write, for the edit made inside the autosave window.
   *
   * There is no Save button (ADR-0005), so the only thing standing between the
   * user's last keystroke and the Host's copy is an 800ms timer — and every way
   * of ending a session cancels that timer. Type, blur, navigate away, and the
   * edit is gone from the Host's copy with nothing on screen to say so, because
   * the tree that would have shown it is the one unmounting.
   *
   * Fire and forget, and it has to be: `dispose()` is a React effect cleanup
   * and cannot await anything. Chained onto the queue rather than issued
   * alongside it, so it cannot overtake a write already in flight — which would
   * leave the Host holding the older of the two.
   *
   * Not called by `discard()`: that throws the Draft away, and writing to it
   * first is work whose only possible effect is to lose a race with the delete.
   */
  const writeLastEdit = () => {
    if (disposed || !document || !token || save.state === 'halted') return

    let text: string
    try {
      text = document.toString()
    } catch {
      return
    }
    if (text === savedText) return

    const held = token
    const send = () => port.saveDraft(held, text)
    // Both arms, so a failure earlier in the queue does not swallow this one —
    // and the rejection is absorbed, because there is nobody left to report to.
    void queue.then(send, send).catch(() => {})
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
    // Nothing queued behind a write belongs to this session any more, and a
    // Host that never answered the last one must not hold a later flush open
    // for the life of the page.
    queue = Promise.resolve()

    // A write scheduled inside the autosave window has just been cancelled, and
    // with the token gone nothing can ever pick it up — so a snapshot left
    // reading `pending` promises a write that cannot happen, with no timer
    // behind it and no way out. `halted` is what this is: autosave has stopped
    // and the document is intact, which is exactly ADR-0005's state.
    if (save.state === 'pending' || save.state === 'saving') {
      setSave({
        state: 'halted',
        error: new Error(
          'This editing session has ended. Open the workflow again to keep editing it.',
        ),
      })
      return
    }

    // Nothing was in flight, so `save` is already the truth and there is no new
    // save state to publish — but `claimed` has just changed, and it is read off
    // the snapshot. Without this the session ends invisibly: the bar goes on
    // showing a live document, and the user learns otherwise from the first
    // keystroke that trips `schedule()`'s missing-token branch.
    commit()
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
      if (!document) {
        log.debug('command dropped: nothing is open', { command: command.label })
        return
      }
      /*
       * A session that has ended takes no more edits.
       *
       * `finish()` keeps the document, and that is right — it is what the user
       * was looking at, and after a **Publish** it is what was published. What
       * it must not do is go on accepting changes: there is no claim to write
       * them under and no Draft on the Host to write them to, so every one of
       * them is lost the moment the page moves on. After a **Discard** the Draft
       * they would belong to has been thrown away outright.
       *
       * The bar says "you are no longer editing this workflow" and offers to
       * open the Draft again; this is what makes that sentence true rather than
       * a description of somewhere the writes are not going.
       */
      if (!token) {
        log.debug('command dropped: the session has ended', { command: command.label })
        return
      }

      /*
       * The serialisations are inside the guard, not only `command.apply`.
       *
       * A command that leaves the AST in a state `toString()` refuses — a node
       * spliced somewhere it does not belong — throws from the line that reads
       * the result rather than from the mutation, so guarding the mutation
       * alone lets it escape into whatever click handler called this. The store
       * is then holding a document that cannot be serialised, which means every
       * later commit, undo, autosave and even the NEXT apply throws too: one
       * bad command and nothing but `reopen()` recovers.
       *
       * So the document is put back. `before` is the text it had, and ADR-0001
       * makes text the source of truth — re-parsing it yields the same document
       * including its comments and quoting, which is the same move `undo` makes
       * and for the same reason.
       */
      let before: string
      try {
        before = document.toString()
      } catch {
        return
      }

      /*
       * Whether the document projected BEFORE this command, read off the last
       * published snapshot rather than validated again.
       *
       * A document that already does not project is not this command's doing
       * and is not judged below — that state is ADR-0001's and belongs to the
       * user's file. What is judged is a command that MAKES one.
       */
      const projected = state.status === 'ready' && state.workflow.definition !== null

      let after: string
      try {
        command.apply(document)
        after = document.toString()
      } catch (cause) {
        // A command throws when the tree it was built against has moved on — a
        // Step removed under a stale insertion point, most likely — or when
        // what it was asked to edit is not the shape it edits. Either way the
        // document is left as it was and nothing reaches the undo stack, so a
        // stale insertion point is a no-op rather than half an edit.
        //
        // Reported, though. Several commands throw a sentence written for the
        // person who asked — "that connection is already declared as …" — and
        // restoring without it turns the refusal into a control that did not
        // respond.
        refused = asError(cause)
        log.debug('command refused', { command: command.label, why: refused.message })
        restore(before)
        return
      }

      if (after === before) {
        log.debug('command changed nothing', { command: command.label })
        return
      }

      /*
       * **A command may not turn a document that projects into one that does
       * not.** Inheriting an invalid document from the Host's file is a state
       * this store is built to hold — ADR-0001 makes the text the source of
       * truth, and the panel has a screen that says so. MANUFACTURING one is a
       * different thing entirely: every surface in the product reads
       * `definition`, so a single command that breaks the projection empties
       * the canvas, the side panel and the step editor at once, and the user is
       * left with nothing to click on to undo it.
       *
       * Every command that writes a user-chosen name refuses a name the schema
       * cannot hold, which is where a refusal can say something useful. This is
       * the backstop under all of them, and under every command written later:
       * a whole class of defect that would otherwise be one field's oversight
       * each time.
       */
      if (projected && !document.validate().success) {
        refused = new Error(
          'That change would leave the workflow in a state it cannot be saved in, so it was not made.',
        )
        log.debug('command refused: it would break the projection', { command: command.label })
        restore(before)
        return
      }

      refused = null
      log.trace('command applied', { command: command.label })
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

    resumeSaving() {
      if (disposed || !token || save.state !== 'halted') return
      /*
       * The claim is re-checked before the halt is cleared, and the renewal is
       * what checks it.
       *
       * Not a write: the halt this control answers is usually a refused
       * RENEWAL, which fires on a timer and therefore while nobody is typing —
       * so a resume that went straight to the write queue would find the
       * document already level with the Host, report `saved`, and take the
       * control off screen having verified nothing. The lease would then lapse
       * quietly a few seconds later.
       *
       * It also puts the renewal back on a timer, which a halt takes away:
       * `halt()` schedules nothing, so a refused renewal leaves no timer at all
       * and the only other caller of `scheduleRenewal` is a fresh open.
       */
      cancelSave()
      resumeWanted = true
      void renew()
    },

    flush() {
      cancelSave()
      // Just another turn in the queue: it waits out whatever is already open
      // and then writes, and the promise it returns is for its own write rather
      // than for somebody else's. Two callers flushing at once each get their
      // own turn, and the second finds nothing left to write.
      return write()
    },

    /*
     * Publish is the one of the three that can be REFUSED.
     *
     * ADR-0005 puts the conflict check here and nowhere else — the Host rejects
     * it when the version the Draft branched from is no longer the live one —
     * so the session may only end once the Host has said yes. Ending it first
     * throws the token away while the Host still considers the claim live: the
     * user is told their publish failed, and the Draft they are looking at is
     * no longer being saved anywhere, with nothing on screen saying so until
     * their next keystroke trips the halt.
     *
     * So the write is awaited before the session is closed, and a rejection
     * leaves the session exactly as it was — lease renewing, autosave running,
     * every edit still going somewhere. `discard()` is not like this: it ends
     * the claim by definition, and a Host that fails to record it has still had
     * the claim relinquished on this side. `release()` sits between the two —
     * it keeps the claim when its last write did not land, and gives it up
     * once it has.
     */
    async publish() {
      const held = requireToken()
      if (!document) throw new Error('No Draft is open')

      /*
       * The floor: a document that does not project is never published.
       *
       * Checked here rather than by whatever drew the button, and checked
       * without asking anything — the projection is this store's own, so this
       * holds for every Host in every configuration, including one that builds
       * the store by hand and mounts no toolbar. Promoting something that is not
       * a Workflow Definition is indefensible under any reading of ADR-0009,
       * and a rule that lives in a control is a rule the next control forgets.
       */
      const projection = document.validate()
      if (!projection.success) {
        throw new PublishBlocked(
          [],
          projection.error.issues[0]?.message ?? 'This is not a valid workflow yet.',
        )
      }

      /*
       * Then what the checker says, if anything can say it.
       *
       * Awaited, because the answer may not have arrived: ADR-0023's table says
       * the gate waits while the catalogue is still loading or the Host's
       * Connections are still unknown, and narrows rather than refuses when
       * nobody can ever say. All of that is the gate's business — this store
       * asks once and believes the answer.
       */
      const mine = generation
      if (options.gate) {
        const blockers = await options.gate.blockers()
        if (blockers.length > 0) throw new PublishBlocked(blockers)
      }
      // The wait is unbounded from here, so the session may have ended inside
      // it — released in another tab, or the store replaced. Publishing on a
      // token this session no longer holds is a write nobody asked for.
      if (mine !== generation || disposed) {
        /*
         * A generation moves when a session ENDS and when a new one BEGINS, and
         * the two need different sentences. A Host reopening mid-wait leaves a
         * live, claimed Draft on screen, and telling its reader that editing has
         * ended is both wrong and unactionable — the way forward is simply to
         * press again.
         */
        throw new Error(
          token
            ? 'This workflow was opened again while it was being published, so nothing has been published. Try again.'
            : 'This editing session has ended. Open the workflow again to publish it.',
        )
      }

      /*
       * The floor again, because the document has had the whole of that wait to
       * move.
       *
       * "Refused unconditionally" has to mean at the moment of publishing, not
       * at the moment of asking. Editing does not stop while the gate waits, and
       * a command that breaks the projection during it makes the gate's own
       * answer meaningless as well: `createValidationStore` reports nothing for a
       * document that does not project, so the blockers come back empty and the
       * broken YAML would go to the port with nothing having said no.
       */
      const still = document.validate()
      if (!still.success) {
        throw new PublishBlocked(
          [],
          still.error.issues[0]?.message ?? 'This is not a valid workflow yet.',
        )
      }

      // The current text rather than the last text the Host accepted, and read
      // after the gate rather than before it. Autosave may still have been
      // pending, and publishing a version that silently omits the user's last
      // edit is the one outcome worse than a rejected publish.
      const yaml = document.toString()

      /*
       * And the token as it stands now, for the same reason the text is.
       *
       * A renewal can land inside the gate's wait and hand back a NEW token —
       * which is why `renew()` keeps it — and it does not bump the generation,
       * so the guard above says nothing about it. Publishing on the credential
       * captured before the wait is then refused by the Host for a reason the
       * user cannot see or act on.
       */
      const published = await port.publish(token ?? held, yaml)
      /*
       * The same guard the gate's wait needs, for the same reason.
       *
       * A Host's publish is a network call and the session can end or begin
       * again underneath it — `dispose()` then `open()`, a `reopen()`, a second
       * publish. `finish()` here bumps the generation, drops the token and halts
       * autosave; run late, it does all of that to the session that REPLACED
       * this one, leaving a Draft the user has visibly just reopened saved
       * nowhere and reporting that it has ended.
       *
       * The version is still returned, because the Host really did publish it.
       */
      if (mine === generation && !disposed) finish()
      return published
    },

    async release() {
      const held = requireToken()
      const mine = generation
      /*
       * Whether there is anything for the write below to lose.
       *
       * Read BEFORE it, because the guard afterwards asks whether THIS release's
       * write failed — and `attempt()` returns immediately when the store is
       * already halted, so a halt that predates the press makes `write()` a
       * no-op and leaves the halt standing whether or not anything was pending.
       * Judged on the halt alone, a Release pressed on a clean document after a
       * refused RENEWAL — the commonest halt there is, and one that loses
       * nothing — would be refused for ever, which is the opposite of handing
       * the Draft back.
       */

      // The Draft is kept for whoever picks it up next, so the last edit has to
      // reach it — and awaited rather than fired off, so the Host records the
      // write before it records the release.
      await write()

      /*
       * And if it did not reach it, the session does not end.
       *
       * `write()` cannot reject: `attempt()` turns a refused `saveDraft` into a
       * halt and returns normally, so awaiting it says only that the attempt is
       * over, not that it worked. Releasing anyway hands the Draft to whoever
       * picks it up next WITHOUT the edit that was in flight, reports a clean
       * ending, and leaves nothing on screen to say otherwise — the halt is
       * drawn against a claim, and the claim would be gone.
       *
       * So the claim is kept and the halt stands. The document is intact,
       * `resumeSaving()` is the way back, and releasing again once the write
       * lands does what it was asked to do.
       *
       * The question is whether anything is STILL unwritten once the writes
       * above have run, asked of the document as it stands rather than of what
       * happened to be outstanding when the press arrived. A write already in
       * flight can carry text an undo has since taken back, so "nothing was
       * pending" at the press is no promise that nothing is pending now.
       *
       * Comparing what the Host held before and after does not: `write()` queues
       * behind whatever is already in flight, so an earlier autosave landing in
       * the meantime moves that mark and reports this release's own refused
       * write as a success. And asking whether the store is halted does not
       * either — a halt is raised by a refused RENEWAL too, which fires on a
       * timer, so a write that succeeded alongside one would be called lost.
       */
      /*
       * One more turn, for the edit made DURING that write.
       *
       * `write()` takes its place in the queue and sends whatever the document
       * says when its turn comes, so a keystroke landing while it is in the air
       * is left over afterwards — and unlike an ordinary edit it has nowhere to
       * go, because ending the session cancels the save that would have carried
       * it. Bounded at one extra turn: a reader still typing is not a reason to
       * refuse for ever, and what is left after this is reported rather than
       * chased.
       */
      if (dirty()) await write()

      if (dirty()) {
        // The Host's reason, and what to do about it. Rejecting with the raw
        // save error says why the write failed and nothing about the fact that
        // the workflow is still open, or that resuming the save is the way out —
        // which leaves a user pressing Release again and getting the same
        // sentence.
        // The Host's reason when there is one, because a halt carries why the
        // write was refused; a plain statement when there is not, because the
        // text simply has not reached the Host and no error explains that.
        throw new Error(
          halted()
            ? `${reasonFor(save).message} Your last change is not saved yet, so this workflow is still open — try saving again, or discard the draft.`
            : 'Your last change is not saved yet, so this workflow is still open. Try again in a moment, or discard the draft.',
        )
      }

      // This session's token, as it stands now: read after the write, because
      // that write may have rotated it.
      const spent = token ?? held
      /*
       * A session that has been replaced has nothing left to hand back.
       *
       * That write is an unbounded wait on the Host, and a reopen can both
       * start and land inside it. `openDraft` claims anew, so the token this
       * call holds is already superseded — telling the Host to release it is at
       * best refused, captioning a freshly opened healthy session with someone
       * else's claim error, and at worst honoured by a Host that unclaims by
       * workflow rather than by token, dropping the live session's claim while
       * the bar goes on saying it is held. A late `finish()` is worse still: it
       * bumps the generation again, and the `openDraft` in flight then finds its
       * own stale and returns silently, leaving the store at `opening` for good.
       */
      if (mine !== generation || disposed) return

      finish()
      return port.releaseDraft(spent)
    },

    async discard() {
      const held = requireToken()
      finish()
      return port.discardDraft(held)
    },

    dispose() {
      // Before `disposed`, which every write checks: the point is to get the
      // last edit out, and a store that has already marked itself disposed
      // refuses to write anything.
      writeLastEdit()
      disposed = true
      finish()
    },
  }
}
