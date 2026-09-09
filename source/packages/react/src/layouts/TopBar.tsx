import type { Diagnostic } from '@hatua/model'
import {
  type EditingState,
  type Ended,
  PublishBlocked,
  unchecked,
  type ValidationState,
  type VersionSummary,
  type VersionsState,
} from '@hatua/services'
import {
  type ComponentPropsWithRef,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../primitives/Button'
import { ConfirmDialog } from '../primitives/ConfirmDialog'
import { cx } from '../primitives/classNames'
import { place } from '../primitives/placement'
import {
  useEditingStore,
  useExecutionStore,
  usePortalContainer,
  useValidationStore,
  useVersionStore,
} from '../theme/HatuaProvider'
import styles from './TopBar.module.css'
import css from './TopBar.module.css?inline'

export interface TopBarProps extends ComponentPropsWithRef<'section'> {
  /**
   * Leave the workflow for whatever lists them.
   *
   * Optional, and absent means the breadcrumb is not drawn at all. Hatua has no
   * workflow list and no route to one — where "up" goes is the Host's
   * application — so a breadcrumb rendered without somewhere to go would look
   * navigable and not be.
   */
  onBrowseWorkflows?: () => void
  /**
   * Go to whatever a blocking problem is about.
   *
   * Optional for the reason every emitted event here is: a region that requires
   * a handler does not mount alone. Without one the problems are still listed —
   * a report rather than a menu — which is also what a row whose diagnostic
   * names nothing navigable gets. Translating a `Diagnostic` into a Board, a tab
   * and a selection is chrome the caller holds, and `views/Build` holds it.
   */
  onRevealDiagnostic?: (diagnostic: Diagnostic) => void
  /**
   * Which of the views is on screen. Chrome, held by whatever composes them —
   * the same shape `<TabbedPanel>` takes for which tab is open and `<FlowMap>`
   * for which Board is drawn, and for the same reason: the bar draws the
   * control and owns none of the views.
   */
  view?: BarView
  /**
   * The segmented control was pressed.
   *
   * Optional, and absent means the control is not drawn at all — a bar mounted
   * with nothing above it to switch has nowhere to send anybody, and a live
   * control that does nothing reads as a fault. The **Runs** segment needs an
   * `ExecutionSource` as well: `ports.ts` says "omit entirely and the Runs view
   * is hidden", so no port, no segment.
   */
  onViewChange?: (view: BarView) => void
}

/**
 * Which document is on screen: the one being edited, or one that ran.
 *
 * Two and not three. **Text Mode** is not here, and that is the distinction the
 * control exists to keep: ADR-0001 has a user editing one **Workflow
 * Definition** two ways, on the map and as text, so which of those is drawn is a
 * question about *how* — asked by the toggle on the column, where the answer is
 * visible. This asks *which*, and only **Runs** changes it (ADR-0011, ADR-0025).
 */
export type BarView = 'build' | 'runs'

/** What each segment reads. `Build` is the designer, as the design of record names it. */
const VIEW_LABEL: Record<BarView, string> = {
  build: 'Build',
  runs: 'Runs',
}

/** "The Host wired nothing" is not a phase of the load, so it is not the store's to report. */
type BarState = EditingState | { status: 'unconfigured' }

const UNCONFIGURED = { status: 'unconfigured' } as const
const OPENING = { status: 'opening' } as const
const VERSIONS_LOADING: VersionsState = { status: 'loading' }

// Module-level and therefore stable: useSyncExternalStore re-subscribes
// whenever `subscribe` changes identity, and re-renders forever if
// `getSnapshot` returns a fresh object each call.
const subscribeToNothing = () => () => {}
const readUnconfigured = (): BarState => UNCONFIGURED
const readOpening = (): BarState => OPENING
const readVersionsLoading = (): VersionsState => VERSIONS_LOADING

/** How wide each floating layer is; `place` needs it as a number to clamp. */
const LAYER = 320

/**
 * What the user is being told about the last thing they pressed.
 *
 * `blocked` is Hatua's own refusal and carries the list. `rejected` is the
 * Host's, and carries only what the Host said — `WorkflowStore.publish` rejects
 * with a plain error, so "someone else published" and "your claim was taken"
 * arrive here indistinguishable and are reported rather than diagnosed.
 */
type Attempt =
  | { kind: 'blocked'; message: string; diagnostics: readonly Diagnostic[] }
  | { kind: 'rejected'; message: string }

/**
 * Which floating layer is open, and what it belongs to.
 *
 * The anchor is the ELEMENT that opened it rather than a ref to one particular
 * control, because the problems panel has two ways in — the count and Publish —
 * and a panel anchored to a control the user did not press is a panel that
 * cannot be pressed closed again: the outside-pointer handler would treat the
 * opening control as outside, close, and let the click reopen it.
 */
type Layer = { kind: 'versions' | 'problems'; anchor: HTMLElement } | null

/**
 * The toolbar: which workflow this is, which version of it, and the three
 * things a user decides about it.
 *
 * Deliberately not a <header> and deliberately not an <h1>. A <header> with no
 * sectioning ancestor IS the page's banner, and Hatua is a guest — the Host
 * embedding the designer already has a banner and already has an <h1> naming
 * its own product, so both would be claimed twice and the workflow's name would
 * outrank the application containing it. The name is a label here; which
 * heading level it deserves is the Host's outline to decide.
 *
 * ## It reports two decisions that were otherwise invisible
 *
 * **Publish is never disabled.** ADR-0023 puts the refusal in the store, so
 * this bar does not gate anything — it shows the count of what is blocking, and
 * pressing Publish opens the list. A control that greys out cannot say why, and
 * `units/SegmentBar` already makes that argument: the explanation would exist
 * for everyone except the readers who most need it.
 *
 * **Autosave says when it has stopped.** ADR-0005 halts on a rejected write and
 * keeps the in-memory document, which is correct and completely invisible
 * without somewhere to say so. Shown here and not announced: `<StepList>` and
 * the Workflow tab already announce the same sentence into a live region, and a
 * screen carrying all three would say it three times.
 *
 * ## What it does not carry
 *
 * No **Save changes** button — editing autosaves (ADR-0005) and the flag behind
 * that button is not a thing to render.
 *
 * ## The segmented control says which document is on screen, and owns neither
 *
 * **Build** and **Runs**, and deliberately not **Text Mode**: this asks *which*
 * document, and how that document is drawn — on the map or as text — is the
 * column's own question, asked by the toggle that sits on it. One control
 * carrying both would say the two were the same kind of choice.
 *
 * Drawn only where it goes somewhere: without `onViewChange` there is nothing
 * above this to switch, and without an `ExecutionSource` there is no **Runs**
 * view, so that segment is absent rather than dead — leaving one segment, which
 * is why the whole control goes with it.
 *
 * It sits inside the cluster that is drawn once a document is open, and that is
 * the honest place for it: both views draw a document, so with none open there
 * is nothing to switch between.
 *
 * ## Three clusters, not two
 *
 * The right-hand side is drawn from what the session is doing rather than from
 * a mode this bar holds. **Editing** is Publish, Release and Discard. **A
 * Preview** replaces all three with Restore and a way back, because all three
 * are about the Draft and the Draft is not what is on screen (ADR-0024).
 * **Ended** is a sentence saying what became of the draft, and Edit.
 *
 * A **Preview** set because a run is being read is a fourth, and the shortest:
 * it offers nothing at all. **Restore** is about a version, and the reader chose
 * a run rather than a version — the way out is the segmented control beside it,
 * because leaving the **Runs** view is what puts the Draft back (ADR-0025).
 */
export function TopBar({
  className,
  onBrowseWorkflows,
  onRevealDiagnostic,
  view = 'build',
  onViewChange,
  ...rest
}: TopBarProps) {
  const store = useEditingStore()
  const validation = useValidationStore()
  const versions = useVersionStore()
  /*
   * Read for its presence and never for its contents: whether the Host serves
   * run history is what decides whether the **Runs** segment exists. Nothing is
   * fetched — the list is the **Runs** region's to load when someone opens it.
   */
  const executions = useExecutionStore()

  /*
   * The history, read here as well as in the panel, because whether a **Draft**
   * exists is a question only this list can answer — and **Restore** has to ask
   * it before it can say what a restore would cost.
   *
   * Cheap: nothing is fetched that the panel has not already fetched, and the
   * store publishes a new snapshot only when a page arrives.
   */
  const history = useSyncExternalStore<VersionsState>(
    versions ? versions.subscribe : subscribeToNothing,
    versions ? versions.getSnapshot : readVersionsLoading,
    readVersionsLoading,
  )

  // Idempotent, so every region that mounts may call it and only the first
  // opens the Draft. The version list is NOT loaded here: nothing is fetched
  // until somebody opens it.
  useEffect(() => {
    store?.open()
    validation?.load()
  }, [store, validation])

  const state = useSyncExternalStore<BarState>(
    store ? store.subscribe : subscribeToNothing,
    store ? store.getSnapshot : readUnconfigured,
    // Without a server snapshot this throws during SSR, and the whole package
    // is built to render there (ADR-0003). Opening is the honest answer:
    // claiming the edit is a client concern, so that is what hydration matches.
    store ? readOpening : readUnconfigured,
  )

  const checks = useSyncExternalStore<ValidationState>(
    validation ? validation.subscribe : subscribeToNothing,
    validation ? validation.getSnapshot : unchecked,
    unchecked,
  )

  const [layer, setLayer] = useState<Layer>(null)
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  /*
   * Whether one of the three is waiting on the Host — and therefore whether any
   * of them may be pressed.
   *
   * One decision at a time, whichever it is. All three end the session and all
   * three spend the same token, so two in flight is one of them acting on a
   * claim the other has already consumed. `release()` in particular awaits a
   * last write BEFORE dropping the claim, so the claimed cluster stays on screen
   * for the length of it — and a Publish pressed there promotes the Draft while
   * the release goes on to release a token that is gone, which surfaces as a
   * claim error captioning a publish that actually succeeded. A claim spent
   * twice is not something a reload repairs.
   *
   * What keeps this from stranding the bar is where the waiting happens rather
   * than what it disables: the gate's wait is bounded (ADR-0023), so a Host with
   * a hanging catalogue still answers the press, and only a Host that never
   * answers `publish` itself leaves these disabled — the same wait `flush()`
   * accepts, for the same reason.
   */
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  /**
   * Which version a **Restore** is waiting to be confirmed for, and the control
   * it was pressed from — or null.
   *
   * Asked whenever a **Draft** exists, because its content is replaced and there
   * is nothing on screen to take it back with: `undoLabel` is on the snapshot and
   * no region draws an undo control, so "it is one undoable edit" is true of the
   * store and not of the reader.
   *
   * **Whether one exists is not what the claim says.** `releaseDraft` keeps the
   * Draft for whoever picks it up next and `openDraft` is create-OR-RESUME, so an
   * unclaimed session may still have one to lose; a **Publish** or a **Discard**
   * leaves none, so a session that has just ended may have nothing. `replaceable`
   * reads the history, which is the only thing that knows.
   *
   * The control comes with it because the dialog outlives the press: a refused
   * restore has to be reported against something still on the page, and the
   * button that opened this may have gone by then.
   */
  const [restoring, setRestoring] = useState<{ version: number; from: HTMLElement | null } | null>(
    null,
  )
  /*
   * Where focus goes when the controls a discard was confirmed from disappear.
   *
   * `discard()` drops the claim synchronously, so the whole claimed cluster —
   * including the button `ConfirmDialog` recorded to restore focus to — has
   * unmounted by the time its restore runs, and focus lands on <body>. The next
   * Tab then restarts from the top of the Host's page, which is the failure the
   * layer's own Escape handler exists to avoid.
   */
  const editButton = useRef<HTMLButtonElement>(null)
  const [handOver, setHandOver] = useState(false)
  /*
   * The same hand-over for a confirmed **Restore**, which lands in the same
   * hole: `ConfirmDialog` restores focus to the control it was opened from, and
   * that control is `disabled={busy}` on the commit that closes the dialog — a
   * disabled button cannot take focus, so it goes to <body> and the next Tab
   * restarts at the top of the Host's page.
   */
  const [handBack, setHandBack] = useState(false)

  /*
   * The count, so it can tell its own panel from Publish's.
   *
   * Both controls open the same kind of layer, and `aria-expanded` is a claim
   * about THIS control: after a refused Publish the panel belongs to the Publish
   * button, and a count announcing itself expanded sends a screen-reader user to
   * close a panel that is not theirs instead of opening one that is.
   */
  const countButton = useRef<HTMLButtonElement>(null)

  /*
   * The version button, so a preview that could not be loaded has something to
   * report against. The press that asked for it came from a row inside a panel
   * this bar closes on the way, and a message anchored to a node that has left
   * the page places itself in the corner of the viewport attached to nothing.
   */
  const versionButton = useRef<HTMLButtonElement>(null)

  const workflow = state.status === 'ready' ? state.workflow : null
  const definition = workflow?.definition ?? null

  /*
   * A layer whose control has left the page is closed, not merely hidden.
   *
   * Asked of the anchor itself rather than of the conditions that draw it.
   * Enumerating those conditions is what went wrong the first time: the version
   * button goes when the document stops projecting, and BOTH the count and
   * Publish go when the claim does — but the count also goes on its own, the
   * moment the last problem is fixed with its panel open, and no list of
   * render conditions stays complete as controls are added.
   *
   * Left open, the panel sits over a detached node: its rect is all zeros, so
   * `place` puts it in the corner of the viewport attached to nothing, and
   * Escape focuses a node that is not in the document — dropping the next Tab
   * to the top of the Host's page.
   *
   * No dependency array, because `isConnected` is a fact about the DOM after
   * the commit rather than about anything in this render's scope: computed
   * during render it is still true, on the very render that is removing the
   * node.
   */
  useEffect(() => {
    if (layer && !layer.anchor.isConnected) setLayer(null)
  })

  const claimed = workflow?.claimed ?? false
  /*
   * Which version is on screen instead of the Draft, and how the session ended
   * — both read off the snapshot rather than tracked here.
   *
   * The store stamps `ended` in `finish()`, which is the only place every ending
   * passes through. Reconstructing it here from a claim disappearing cannot tell
   * Release from Discard, and cannot see an ending a Host drove through the
   * store with no toolbar mounted at all (ADR-0023) — the case that made every
   * ending read alike.
   */
  const previewing = workflow?.previewing ?? null
  const ended = workflow?.ended ?? null

  /*
   * Whether a **Restore** has anything to overwrite.
   *
   * The claim cannot answer this. A **Release** keeps the Draft for whoever
   * picks it up next, so an unclaimed session may still have one — and a
   * **Publish** or a **Discard** leaves none, so a claimed session that has just
   * ended has nothing to lose. The list is where the answer actually is.
   *
   * Unknown counts as yes. A history that failed or has not arrived cannot show
   * that nothing would be lost, and the cost of asking when there was nothing to
   * lose is one dialog; the cost of not asking when there was is the user's
   * work.
   */
  const replaceable =
    history.status !== 'ready' || history.versions.some((one) => one.status === 'draft')

  /*
   * Which version the document on screen IS, when it is one — the row the list
   * must not offer, because pressing it goes nowhere.
   *
   * A claim makes this the **Draft**. Without one it depends on how the session
   * ended, which is why `ended` carries the version a **Publish** produced: after
   * publishing, what is in memory is that new **Published Version**, and a list
   * that let the reader "open" it would answer with a preview of the thing
   * already in front of them — captioned as some other version.
   *
   * A **Release** keeps the **Draft**, so its row is still the one on screen. A
   * **Discard** frees the number outright, so nothing matches and nothing is
   * marked.
   */
  const onScreen =
    claimed && definition
      ? definition.version
      : ended?.how === 'published'
        ? ended.version
        : ended?.how === 'released' && definition
          ? definition.version
          : null

  /*
   * `busy` is the dependency, because neither the button nor its ability to take
   * focus exists on the commit that sets this: the discard drops the claim
   * before the Host has answered, so Edit renders disabled — and a disabled
   * button cannot be focused at all. `busy` falling is that answer arriving,
   * with the claim already gone and the cluster already swapped.
   */
  useEffect(() => {
    if (!handOver || busy || !editButton.current) return
    editButton.current.focus()
    setHandOver(false)
  }, [handOver, busy])

  /*
   * `busy` again, for the same reason: the restore is in flight when the dialog
   * closes, so every control it could go to is disabled until the Host answers.
   * The version button is what survives a restore in every case — the preview
   * cluster is replaced by the claimed one, and the identity cluster is not.
   */
  useEffect(() => {
    if (!handBack || busy || !versionButton.current) return
    versionButton.current.focus()
    setHandBack(false)
  }, [handBack, busy])

  /*
   * An ending nothing in this bar asked for takes its messages with it.
   *
   * `attempt` outlives its panel by design — the ended cluster is where a
   * refused Release is read — so a rejected Publish left standing would caption
   * the NEXT ending instead. The three endings this bar drives each clear it
   * first; a Host calling `release()` on the store does not, and `busy` is what
   * tells the two apart: an ending arriving while nothing here is waiting on the
   * Host is not this bar's.
   */
  const wasClaimed = useRef(claimed)

  useEffect(() => {
    const ended = wasClaimed.current && !claimed
    wasClaimed.current = claimed
    if (ended && !busy) setAttempt(null)
  }, [claimed, busy])

  useEffect(() => {
    if (!claimed) return
    // A rejected Publish whose panel the reader dismissed leaves a real message
    // behind, and a Host ending the next session through the store would
    // otherwise have that message caption it.
    setAttempt(null)
    /*
     * And the history is a version out of date, because `openDraft` is what
     * MINTS the next Draft on the Host.
     *
     * Here rather than beside the control that asked for the reopen: `reopen()`
     * only STARTS the open, so invalidating there races the very request whose
     * result it wants — and wins, refetching a list that does not yet hold the
     * Draft being created. A claim arriving is that open having finished, which
     * makes this the first moment the answer can be right; it also covers a Host
     * reopening through the store rather than through this bar.
     *
     * `invalidate()` and not `reload()`, so a list nobody has opened is still
     * not fetched.
     */
    versions?.invalidate()
  }, [claimed, versions])

  /*
   * Absent, not zero, until the answer means something. Every Step looks like
   * an unknown component until the manifests land, so a count painted before
   * `ready` reports a dozen problems with a workflow that has none, on every
   * load.
   */
  const blocking = checks.ready ? checks.all : null

  // Stable, because <Layer> lists it as an effect dependency: recreated every
  // render, the document-level keydown and pointerdown handlers are torn off and
  // re-attached on every keystroke the bar re-renders for.
  const closeLayer = useCallback(() => setLayer(null), [])

  /**
   * Closing the problems panel, which also retires what it was showing.
   *
   * Separate from `closeLayer` because `attempt` belongs to this panel and not
   * to the other one. Cleared on any close, dismissing the VERSION list would
   * erase an ending's error from the cluster beside it — the Host's explanation
   * of a refused release replaced by the generic sentence, with nothing left
   * saying why. Kept on any close, a rejected Publish the reader dismissed goes
   * on to caption the next ending.
   */
  const closeProblems = useCallback(() => {
    setLayer(null)
    setAttempt(null)
  }, [])

  const attemptPublish = async (from: HTMLElement) => {
    if (!store) return
    setBusy(true)
    try {
      await store.publish()
      setAttempt(null)
      setLayer(null)
      // The list the bar can open is now a version out of date — but only worth
      // refetching if anything ever opened it.
      versions?.invalidate()
    } catch (cause) {
      setAttempt(
        cause instanceof PublishBlocked
          ? { kind: 'blocked', message: cause.message, diagnostics: cause.diagnostics }
          : { kind: 'rejected', message: messageOf(cause) },
      )
      setLayer({ kind: 'problems', anchor: from })
    } finally {
      setBusy(false)
    }
  }

  /*
   * Where a refused ending is read, which depends on whether the claim survived
   * it.
   *
   * `discard()` gives the claim up before it calls the port, so its rejection
   * arrives at a bar that has already swapped to the ended cluster — nothing is
   * left to anchor a panel to, and what the reader needs is not "here is what to
   * fix" but "this is how the session you no longer have ended". It is rendered
   * inline there, and `attempt` carries it.
   *
   * `release()` can refuse without ending anything: it keeps the claim when its
   * last write did not land, so its controls are still on screen and the message
   * belongs against the one that was pressed. Both cases go through `attempt`;
   * which surface draws it follows the claim.
   */
  const end = async (how: 'release' | 'discard', from?: HTMLElement) => {
    if (!store) return
    setBusy(true)
    setLayer(null)
    /*
     * Cleared BEFORE the call, not after it succeeds.
     *
     * `discard()` drops the claim synchronously and only then awaits the port,
     * so the ended cluster is on screen for the whole of that call; `release()`
     * awaits one last write first, so the claimed cluster is. Either way an
     * `attempt` left standing from the problems panel captions the ending with a
     * publish error — or, when the panel was opened from the count, with the
     * empty string that carries no message at all.
     */
    setAttempt(null)
    try {
      await store[how]()
      if (how === 'discard') versions?.invalidate()
    } catch (cause) {
      setAttempt({ kind: 'rejected', message: messageOf(cause) })
      /*
       * The ended cluster is where this normally lands, and it is only drawn
       * once the claim is gone. `release()` awaits a last write BEFORE dropping
       * it, so a rejection out of that write leaves the claim standing and the
       * message with nowhere to go — pressed Release, nothing happened, nothing
       * said why. Anchored to the control that was pressed, if it is still
       * there to anchor to.
       */
      if (from?.isConnected) setLayer({ kind: 'problems', anchor: from })
    } finally {
      setBusy(false)
    }
  }

  /**
   * Show a version instead of the Draft.
   *
   * The list is closed first: the panel hangs off the version button, whose
   * label changes to that version the moment the preview lands, so a panel left
   * open would be a list of versions anchored to a control that now says it is
   * showing one of them.
   */
  const showVersion = async (version: number) => {
    if (!store) return
    setBusy(true)
    setLayer(null)
    setAttempt(null)
    try {
      await store.preview(version)
    } catch (cause) {
      // The screen has not moved — `preview()` parses before it commits — so
      // this is a message about a version the reader asked for and did not get,
      // and it belongs beside the control they pressed. That control is the
      // version button, which is still there.
      setAttempt({ kind: 'rejected', message: messageOf(cause) })
      if (versionButton.current) {
        setLayer({ kind: 'problems', anchor: versionButton.current })
      }
    } finally {
      setBusy(false)
    }
  }

  const beginRestore = (version: number, from: HTMLElement | null) => {
    // Nothing to replace, so nothing to warn about: the restore opens a Draft
    // at `base + 1` and fills it, and a dialog would be a question about a loss
    // that cannot happen.
    if (!replaceable) return runRestore(version, from)
    setRestoring({ version, from })
  }

  const runRestore = async (version: number, from: HTMLElement | null) => {
    if (!store) return
    setBusy(true)
    setLayer(null)
    setAttempt(null)
    try {
      await store.restoreVersion(version)
      // The Draft is a version newer than the list knows about when this had to
      // open one, and unchanged when it did not — `invalidate()` costs nothing
      // in the second case, because a list nobody opened is still not fetched.
      versions?.invalidate()
    } catch (cause) {
      setAttempt({ kind: 'rejected', message: messageOf(cause) })
      /*
       * Anchored to the version button when the control that was pressed has
       * gone, which it has whenever the restore was confirmed through the
       * dialog: `restoreVersion` clears the preview before it applies, so the
       * cluster holding that button is replaced before this runs. Without a
       * fallback the message is set and drawn nowhere, and the press answers
       * with silence.
       */
      const anchor = from?.isConnected ? from : versionButton.current
      if (anchor) setLayer({ kind: 'problems', anchor })
    } finally {
      setBusy(false)
    }
  }

  /** Open the Draft again, on a bar that is showing how the last session ended. */
  const editAgain = () => {
    setAttempt(null)
    // A publish refused AFTER its session ended sets both the attempt and the
    // layer, and only the attempt is on screen — the panel is held back because
    // there is no claim. Left set, the reopened bar draws a count reading
    // `aria-expanded="true"` over nothing, and the first press closes a panel
    // nobody can see instead of opening one.
    setLayer(null)
    store?.reopen()
  }

  return (
    <>
      <style href="hatua-topbar" precedence="hatua">
        {css}
      </style>
      <section aria-label="Toolbar" className={cx(styles.topBar, className)} {...rest}>
        {state.status === 'unconfigured' ? (
          <p className={styles.note}>
            No workflow is wired up. Hatua has no storage of its own — a Host supplies it as{' '}
            <code className={styles.code}>{'ports={{ workflows }}'}</code>, and names which workflow
            to open as <code className={styles.code}>workflowId</code>, both on{' '}
            <code className={styles.code}>{'<HatuaProvider>'}</code>.
          </p>
        ) : null}

        {state.status === 'opening' ? <p className={styles.muted}>Opening…</p> : null}

        {state.status === 'failed' ? (
          <div className={styles.cluster}>
            <p className={styles.problem}>{state.error.message}</p>
            <Button size="sm" onClick={() => store?.reopen()}>
              Try again
            </Button>
          </div>
        ) : null}

        {workflow ? (
          <>
            <div className={styles.identity}>
              {onBrowseWorkflows ? (
                <>
                  <button
                    type="button"
                    className={styles.breadcrumb}
                    onClick={() => onBrowseWorkflows()}
                  >
                    Workflows
                  </button>
                  <span aria-hidden="true" className={styles.separator}>
                    /
                  </span>
                </>
              ) : null}

              {definition ? (
                <>
                  <p className={styles.title} title={definition.name}>
                    {definition.name}
                  </p>
                  <span aria-hidden="true" className={styles.dot}>
                    ·
                  </span>
                  <p className={styles.slug} title={definition.id}>
                    {definition.id}
                  </p>
                  <span aria-hidden="true" className={styles.dot}>
                    ·
                  </span>
                  {/*
                   * The version and its status describe the document that is
                   * open, and the moment a session ends that document stops
                   * being any version the Host holds: publishing v6 leaves the
                   * in-memory copy still saying `status: draft`, and discarding
                   * leaves it naming a number that no longer exists anywhere.
                   * Neither is restamped, because neither is the user's file any
                   * more — so the readout stops asserting and the control keeps
                   * doing the other half of its job, which is opening a list
                   * that is about the WORKFLOW and stays true either way.
                   *
                   * A Preview asserts again, claim or no claim, and this is the
                   * one place the two conditions come apart. What is on screen
                   * IS a version the Host holds, so `v3 · Published` is the
                   * plain truth and the only thing on the bar naming which
                   * version is being read.
                   *
                   * The NUMBER comes from `previewing` rather than from the
                   * document, because the document's `version:` is whatever the
                   * Host stored: `publish()` sends the Draft's own bytes, which
                   * still say `status: draft` and the draft's number, so a Host
                   * that keeps them verbatim serves version 6 saying `version:
                   * 5`. `previewing` is what was asked for and cannot disagree
                   * with the row that was pressed.
                   */}
                  {previewing?.because === 'run' ? (
                    /*
                     * A run is on screen, so the readout stays and the list goes.
                     *
                     * "Nothing is offered that does not go anywhere" (ADR-0011)
                     * lands here once a run can be what is being read: picking a
                     * row would replace the run's version with a chosen one
                     * while the map still carried the run's marks and the pane
                     * still described the run — one screen saying two things
                     * about what it is showing. There is one way out of a run
                     * and it is the segmented control.
                     */
                    <p className={styles.version}>
                      {`v${String(previewing.version)} · ${statusLabel(definition.status)}`}
                    </p>
                  ) : (
                    <button
                      type="button"
                      ref={versionButton}
                      className={styles.version}
                      aria-haspopup="dialog"
                      aria-expanded={layer?.kind === 'versions'}
                      onClick={(event) => {
                        if (layer?.kind === 'versions') {
                          closeLayer()
                          return
                        }
                        versions?.load()
                        setLayer({ kind: 'versions', anchor: event.currentTarget })
                      }}
                    >
                      {previewing !== null
                        ? `v${String(previewing.version)} · ${statusLabel(definition.status)}`
                        : claimed
                          ? `v${String(definition.version)} · ${statusLabel(definition.status)}`
                          : 'Versions'}
                    </button>
                  )}
                </>
              ) : (
                /*
                 * The document parses as YAML and is not a Workflow Definition,
                 * which is a state the store is built to hold (ADR-0001) — so
                 * the name, the slug and the version are all unreadable at once.
                 * Said rather than guessed at: the alternative is digging them
                 * out of the AST, which no region does, or showing the last ones
                 * seen, which is a lie about what is on screen.
                 */
                <p className={styles.muted}>This workflow cannot be read yet.</p>
              )}
            </div>

            <div className={styles.actions}>
              {/*
               * Before the clusters, because a halt belongs to the SESSION and
               * every cluster below is about what is on screen.
               *
               * Autosave goes on running against the Draft through a Preview, so
               * a renewal refused while a version is up halts it — and drawn
               * inside the claimed cluster the notice is replaced along with it,
               * leaving the reader looking at v3 while their work quietly stops
               * being saved. The three version decisions are correctly dropped
               * during a preview because they are decisions; this is a failure
               * to act on.
               */}
              {workflow.claimed && workflow.save.state === 'halted' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className={styles.halted}
                  onClick={() => store?.resumeSaving()}
                >
                  Saving stopped — try again
                </Button>
              ) : null}

              {/*
               * Which document is on screen.
               *
               * First in the cluster, because it is the only control here that
               * is not about the Draft — the three below act on it, and this
               * says which document is being read.
               *
               * Drawn only where it goes somewhere, which takes the whole
               * control and not just a segment: **Runs** is the only thing it
               * can switch to, so without the port one segment would be left
               * alone and its every press would do nothing. That is worse than
               * no control, and it is the same call the version list makes
               * about a row that goes nowhere.
               */}
              {onViewChange && executions ? (
                // A fieldset is a form control grouping and wants a legend.
                // These are navigation buttons in a toolbar, and a fieldset here
                // would put a form landmark in the Host's page for two of them.
                // biome-ignore lint/a11y/useSemanticElements: a group of buttons is not a form
                <div className={styles.views} role="group" aria-label="View">
                  {(['build', 'runs'] as const).map((one) => (
                    <button
                      key={one}
                      type="button"
                      className={styles.view}
                      // A pressed toggle rather than a tab: there is no tabpanel
                      // here — what changes is the whole screen under the bar,
                      // which several regions draw.
                      aria-pressed={view === one}
                      onClick={() => onViewChange(one)}
                    >
                      {VIEW_LABEL[one]}
                    </button>
                  ))}
                </div>
              ) : null}

              {previewing?.because === 'run' ? (
                /*
                 * A version is on screen because a run is being read against it
                 * (ADR-0025), and none of the four controls below is about that.
                 *
                 * **Restore is not offered here either.** It is about the
                 * version, and the reader did not choose a version — they chose
                 * a run, and the version came with it. The way to restore one is
                 * the list, where the row that was pressed is the thing being
                 * restored.
                 *
                 * The way out is the segmented control, which is the control
                 * immediately before this one: leaving the **Runs** view is what
                 * puts the Draft back, because that view owns the preview for as
                 * long as it is mounted.
                 */
                <p className={styles.muted}>You are viewing a past run of this version.</p>
              ) : previewing !== null ? (
                /*
                 * Publish, Release and Discard are all about the Draft, and the
                 * Draft is not what is on screen — so a Publish pressed here
                 * would promote a document the reader is not looking at. They
                 * are not drawn, and neither is the problem count, which counts
                 * the Draft's problems. What is offered is the two things that
                 * are about the version in front of them.
                 *
                 * The store guards none of these: publishing the Draft is safe
                 * whatever is on screen, so there is nothing for a guarantee to
                 * protect and this is an affordance. `apply()` is the one that
                 * refuses, because a lost edit is a correctness bug (ADR-0024).
                 */
                <>
                  {/* Not "an earlier version": any row can be picked, including
                      the newest, the live **Published Version**, and — once a
                      session has ended — a **Draft** still waiting to be picked
                      up. The readout beside the name already says WHICH version
                      this is; what this sentence is for is why the editing
                      controls are gone. */}
                  <p className={styles.muted}>You are viewing this version, not editing it.</p>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy}
                    onClick={(event) => beginRestore(previewing.version, event.currentTarget)}
                  >
                    Restore this version
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => store?.exitPreview()}>
                    {claimed ? 'Back to the draft' : 'Back'}
                  </Button>
                </>
              ) : workflow.claimed ? (
                <>
                  {/*
                   * Shown only while a write is outstanding, and nothing at
                   * all once it lands.
                   *
                   * The handoff refuses a **Save changes** button and says the
                   * flag behind it "is not a thing to render", which is a rule
                   * about the STEADY state: a permanent Saved/Unsaved readout
                   * is that flag wearing a different hat, and it makes a user
                   * watch a status they can do nothing about. A transient
                   * "Saving…" is the opposite — it says a write is in the air
                   * right now, and says nothing the rest of the time.
                   *
                   * `pending` and `saving` read the same because the difference
                   * between them is an 800ms timer, which is Hatua's business
                   * and not the user's.
                   */}
                  {workflow.save.state === 'pending' || workflow.save.state === 'saving' ? (
                    <p className={styles.muted}>Saving…</p>
                  ) : null}

                  {blocking && blocking.length > 0 ? (
                    <button
                      type="button"
                      className={styles.count}
                      aria-haspopup="dialog"
                      ref={countButton}
                      aria-expanded={
                        layer?.kind === 'problems' && layer.anchor === countButton.current
                      }
                      onClick={(event) => {
                        if (layer?.kind === 'problems' && layer.anchor === event.currentTarget) {
                          closeLayer()
                          return
                        }
                        // Opens the panel and writes nothing. Setting an attempt
                        // here overwrote whatever the bar was reporting — a
                        // Host's refusal of a Release, most sharply — with a
                        // blocked attempt carrying no message, and there was no
                        // way back to what it replaced.
                        setLayer({ kind: 'problems', anchor: event.currentTarget })
                      }}
                    >
                      {problemCount(blocking.length)}
                    </button>
                  ) : null}

                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy}
                    onClick={(event) => void attemptPublish(event.currentTarget)}
                  >
                    Publish
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={(event) => void end('release', event.currentTarget)}
                  >
                    Release
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => setConfirming(true)}
                  >
                    Discard
                  </Button>
                </>
              ) : (
                /*
                 * Publish, Release and Discard all drop the claim, and a screen
                 * that still looks live is one whose next keystroke goes
                 * nowhere. Edit opens the Draft again — create-or-resume at
                 * `base + 1` — which loses nothing after any of the three: the
                 * publish sent the current text, the discard threw the Draft
                 * away deliberately, and the release kept it.
                 */
                <>
                  {/* The Host refused the release or the discard, and the claim
                      is gone on this side regardless. Said here rather than in a
                      floating panel: the control that would have anchored one is
                      the control this cluster replaced. */}
                  {/* `message` is empty when the panel was opened from the
                      count rather than by a refusal, and `attempt` outlives the
                      panel — so the test is whether there is something to say,
                      not whether an attempt happened. Every path inside this
                      region clears it first; a Host calling `release()` on the
                      store itself does not, and that is the one this guards. */}
                  {attempt && attempt.message !== '' ? (
                    <p className={styles.problem}>{attempt.message}</p>
                  ) : (
                    <p className={styles.ended}>{endedLabel(ended)}</p>
                  )}
                  <Button
                    ref={editButton}
                    size="sm"
                    variant="primary"
                    disabled={busy}
                    onClick={editAgain}
                  >
                    Edit
                  </Button>
                </>
              )}
            </div>
          </>
        ) : null}
      </section>
      {/* Only while the readout it hangs from is drawn. The identity cluster
          swaps for "This workflow cannot be read yet." the moment the document
          stops projecting, taking the version button with it — and a panel left
          open over a detached anchor focuses nothing on Escape, dropping the
          next Tab back to the top of the Host's page. */}
      {layer?.kind === 'versions' && versions && definition ? (
        <VersionLayer
          anchor={layer.anchor}
          store={versions}
          current={previewing?.version ?? onScreen}
          busy={busy}
          onSelect={(version) => void showVersion(version)}
          onClose={closeLayer}
        />
      ) : null}
      {/* Only while its anchor is still on the page. The claim is the wrong
          question: the version button anchors this too and outlives the session,
          so a failed preview or restore reported while unclaimed would set a
          layer nothing draws. The effect above closes it the moment the anchor
          leaves the document. */}
      {layer?.kind === 'problems' && layer.anchor.isConnected ? (
        <ProblemLayer
          anchor={layer.anchor}
          attempt={attempt}
          live={blocking}
          onReveal={onRevealDiagnostic}
          onClose={closeProblems}
        />
      ) : null}
      {/* Tone is `danger` for what it destroys and not for how final it is: the
          version being restored FROM is untouched and still in the list, which
          is what separates this from a Discard. The copy says so rather than
          leaning on the tone to imply it.

          The description does not promise the draft is OPEN, because after a
          Release it is not — it is waiting for whoever picks it up next, and
          this replaces that. What it does promise is that a draft exists at all,
          which `replaceable` is what establishes: with none, this dialog is
          never drawn. */}
      <ConfirmDialog
        open={restoring !== null}
        tone="danger"
        title={
          restoring === null ? '' : `Replace the draft with version ${String(restoring.version)}?`
        }
        description={
          restoring === null
            ? undefined
            : `Everything the draft holds is replaced by what this version holds. Version ${String(restoring.version)} itself is not changed.`
        }
        confirmLabel="Replace draft"
        onCancel={() => setRestoring(null)}
        onConfirm={() => {
          const asked = restoring
          setRestoring(null)
          if (!asked) return
          setHandBack(true)
          void runRestore(asked.version, asked.from)
        }}
      />
      <ConfirmDialog
        open={confirming}
        tone="danger"
        title="Discard this draft?"
        description="Everything changed since the last published version is thrown away. This cannot be undone."
        confirmLabel="Discard draft"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          setHandOver(true)
          void end('discard')
        }}
      />
    </>
  )
}

/**
 * The workflow's versions, newest first, a page at a time.
 *
 * Every row selects except the one already on screen, which is drawn as current
 * and is not a button at all. That is where "offer nothing that does not go
 * anywhere" lands once selecting a version does something: a workflow with a
 * single version opens a list of one unselectable row, which is the honest
 * picture of a history with nowhere to go.
 *
 * The button that opens this is not hidden on that account. Its other job is the
 * readout, and `listVersions` is not fetched until this panel is opened — so a
 * bar that hid itself would have to pay for that request on every mount, on
 * every screen carrying the toolbar, for every user who never opens the list.
 */
function VersionLayer({
  anchor,
  store,
  current,
  busy,
  onSelect,
  onClose,
}: {
  anchor: HTMLElement
  store: NonNullable<ReturnType<typeof useVersionStore>>
  /** The version on screen, or null when what is on screen is no version at all. */
  current: number | null
  busy: boolean
  onSelect: (version: number) => void
  onClose: () => void
}) {
  const state = useSyncExternalStore<VersionsState>(
    store.subscribe,
    store.getSnapshot,
    readVersionsLoading,
  )

  return (
    <Layer anchor={anchor} label="Versions" onClose={onClose}>
      {state.status === 'loading' ? <p className={styles.muted}>Loading…</p> : null}

      {state.status === 'failed' ? (
        <div className={styles.layerNote}>
          <p className={styles.problem}>{state.error.message}</p>
          <Button size="sm" onClick={() => store.reload()}>
            Try again
          </Button>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <>
          {/* Empty AND exhausted. A first page that is empty but carries a
              cursor is a Host with more to send, and "no versions yet" over a
              "Show more" is the screen contradicting itself. */}
          {state.versions.length === 0 && !state.more ? (
            <p className={styles.muted}>There are no versions yet.</p>
          ) : (
            <ul className={styles.versions}>
              {state.versions.map((version) => {
                const body = (
                  <>
                    <span className={styles.versionNumber}>v{version.version}</span>
                    <span className={styles.versionStatus}>{version.status}</span>
                    <span className={styles.versionDate}>{dateOf(version)}</span>
                  </>
                )

                return (
                  <li key={version.version} className={styles.versionRow}>
                    {version.version === current ? (
                      /*
                       * Not a button, and not a disabled one. There is nothing
                       * to explain here — the reader is looking at this version
                       * — so the argument `units/SegmentBar` makes for
                       * `aria-disabled` over `disabled` does not apply: that one
                       * is about a control whose refusal needs saying. `current`
                       * is said in words rather than by styling alone.
                       */
                      <span className={cx(styles.versionPick, styles.versionCurrent)}>
                        {body}
                        <span className={styles.versionCurrentMark}>current</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={styles.versionPick}
                        disabled={busy}
                        onClick={() => onSelect(version.version)}
                      >
                        {body}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {/*
           * A later page failing keeps every page before it — what is lost is
           * the next page, not the history already on screen.
           *
           * What is offered then is starting over rather than asking again.
           * A cursor can fail because the list moved under it — a Draft
           * discarded between two pages frees its number — and that cursor
           * will fail the same way for ever, so "Show more" beside the message
           * would be a control that cannot work. Reloading is the one action
           * that recovers from both that and a Host that simply blinked.
           */}
          {state.error ? (
            <div className={styles.layerNote}>
              <p className={styles.problem}>{state.error.message}</p>
              <Button size="sm" onClick={() => store.reload()}>
                Try again
              </Button>
            </div>
          ) : state.more ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={state.fetching}
              onClick={() => store.loadMore()}
            >
              {state.fetching ? 'Loading…' : 'Show more'}
            </Button>
          ) : null}
        </>
      ) : null}
    </Layer>
  )
}

/**
 * What is stopping a **Publish**, and where to go about it.
 *
 * ## The list is live, not the one the press captured
 *
 * `live` is the validation store's current answer, and it is what the rows are
 * drawn from whenever there is one. The alternative — rendering the list carried
 * by the refusal — freezes at the moment Publish was pressed: fix a field with
 * the panel open and the row stays, delete the Step and pressing that row
 * reveals a Step that is no longer there, while the count beside it, which reads
 * the store directly, disagrees with the list it opened.
 *
 * The captured list is still the fallback, for the window where validation
 * cannot answer at all.
 */
function ProblemLayer({
  anchor,
  attempt,
  live,
  onReveal,
  onClose,
}: {
  anchor: HTMLElement
  attempt: Attempt | null
  live: readonly Diagnostic[] | null
  onReveal?: (diagnostic: Diagnostic) => void
  onClose: () => void
}) {
  const shown = !attempt || attempt.kind === 'blocked' ? (live ?? attempt?.diagnostics ?? []) : []

  return (
    <Layer anchor={anchor} label="Problems" onClose={onClose}>
      {attempt?.kind === 'rejected' ? (
        <p className={styles.problem}>{attempt.message}</p>
      ) : attempt?.kind === 'blocked' &&
        attempt.diagnostics.length === 0 &&
        attempt.message !== '' ? (
        // The floor refused it: the document is not a Workflow Definition, so
        // there is nothing to attach a diagnostic to and the message is the
        // whole of what can be said.
        <p className={styles.problem}>{attempt.message}</p>
      ) : shown.length === 0 ? (
        // Everything the panel was opened about has been fixed while it stood
        // open. Saying so beats an empty panel, and beats closing itself under
        // the reader.
        <p className={styles.muted}>Nothing is blocking Publish now.</p>
      ) : (
        <ul className={styles.problems}>
          {keyed(shown).map(({ key, diagnostic }) => (
            <li key={key} className={styles.problemRow}>
              {onReveal && navigable(diagnostic) ? (
                <button
                  type="button"
                  className={styles.problemLink}
                  onClick={() => {
                    onReveal(diagnostic)
                    onClose()
                  }}
                >
                  {diagnostic.message}
                </button>
              ) : (
                /*
                 * A row with nowhere to go is still a row. It is what every row
                 * is when no handler was given, and what a Connection nothing
                 * uses gets even when one was: a declared, unwired Connection
                 * blocks Publish and no region draws one.
                 */
                <span className={styles.problemText}>{diagnostic.message}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Layer>
  )
}

/**
 * A floating panel belonging to the control that opened it.
 *
 * Portalled into the provider's container rather than rendered in place: the
 * bar sits inside a horizontally scrolling grid, and a panel that dropped out of
 * it would be clipped by the scroller. `document.body` is not the alternative —
 * it is outside the element carrying the theme's custom properties, which is
 * ADR-0002's last consequence.
 *
 * Local to this file rather than a primitive. `TabbedPanel` makes the same
 * argument: a primitive is a component we owe a general API to, and this is two
 * panels on one bar.
 */
function Layer({
  anchor,
  label,
  onClose,
  children,
}: {
  anchor: HTMLElement
  label: string
  onClose: () => void
  children: ReactNode
}) {
  const container = usePortalContainer()
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null)

  /*
   * Measured after layout, and again whenever the anchor can have moved.
   *
   * The panel is `position: fixed`, so its coordinates are the viewport's while
   * the control it belongs to is not: `views/Build` puts the whole screen —
   * toolbar included — inside an `overflow-x: auto` scroller with a 1240px
   * floor, so on any narrower viewport the bar slides sideways underneath a
   * panel that stays put. A resize does the same.
   *
   * Captured, so an ancestor scrolling counts and not only the window, which is
   * exactly what that scroller is. `<TemplateInput>` tracks its picker the same
   * way and for the same reason.
   */
  const measure = useCallback(() => {
    const rect = anchor.getBoundingClientRect()
    const found = place({ left: rect.left, top: rect.top, bottom: rect.bottom }, LAYER)
    setAt({
      left: found.left,
      ...(found.top === undefined ? { bottom: found.bottom } : { top: found.top }),
    })
  }, [anchor])

  useLayoutEffect(measure, [measure])

  useEffect(() => {
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  /*
   * Focus moves into the panel when it opens.
   *
   * Without it the panel is unreachable in practice: it portals into the
   * provider's container, which sits AFTER everything the Host rendered, so Tab
   * from the control that opened it walks the canvas, the step editor and the
   * side panel before arriving — and a reader who opened a list of problems has
   * to traverse the whole screen to reach the first one.
   *
   * Focus moves in; it is not trapped. `ConfirmDialog` traps because it is
   * modal and says so with `aria-modal`, which is a claim that the rest of the
   * page is unreachable. This panel makes no such claim: the workflow behind it
   * stays usable, Escape closes it and hands focus back, and Tab out of it is a
   * legitimate way to leave.
   */
  useEffect(() => {
    panel.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      onClose()
      // Back to the control that opened it, or focus is left on <body> and the
      // next Tab starts from the top of the page.
      anchor.focus()
    }

    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (panel.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [anchor, onClose])

  // Null until the provider has mounted. Rendering nothing for that one frame
  // is the right answer, because the fallback — document.body — is the bug.
  if (!container) return null

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      // Focusable as a container so the panel itself can take focus when it
      // opens — the heading and the rows are not focusable, and a panel whose
      // first control is a "Show more" three rows down would skip past what it
      // is for.
      tabIndex={-1}
      aria-labelledby={titleId}
      className={styles.layer}
      style={at ?? { left: -9999, top: 0 }}
    >
      <p id={titleId} className={styles.layerHeading}>
        {label}
      </p>
      {children}
    </div>,
    container,
  )
}

/**
 * What became of the draft, for a session that is over.
 *
 * The three endings share their first sentence because they are three outcomes
 * of one thing — the session is over however it ended — and differ in the half
 * that actually differs: whether the draft is still there. **Publish** says the
 * number instead, because a published version is a thing the reader can go and
 * look at and "your draft is gone" is the least of what happened.
 *
 * Null is not a fourth outcome. `dispose()` ends a session without anybody
 * choosing to, so the shared sentence alone is the whole of what can honestly be
 * said — and it is also what a Host gets if it ever ends one by some route the
 * store does not stamp.
 */
const endedLabel = (ended: Ended | null): string => {
  if (ended === null) return 'You are no longer editing this workflow.'
  switch (ended.how) {
    case 'published':
      return `Published as version ${String(ended.version)}.`
    case 'released':
      return 'You are no longer editing this workflow. Your draft is kept.'
    case 'discarded':
      return 'You are no longer editing this workflow. Your draft was discarded.'
  }
}

/**
 * `draft` on the wire, `Draft` on the screen.
 *
 * The list spells each status the way the schema does, because that list is the
 * document's own vocabulary being shown back. The readout beside the name is a
 * sentence fragment about the thing on screen, and a lowercase word mid-phrase
 * reads as a typo rather than as a value.
 */
const statusLabel = (status: 'published' | 'draft' | 'archived'): string =>
  `${status[0]?.toUpperCase() ?? ''}${status.slice(1)}`

/**
 * What identifies one problem in the list.
 *
 * Everything a diagnostic is *about*, rather than its position: the list is
 * rebuilt from a fresh validation pass on every keystroke, so a key that was an
 * index would move a row's identity onto whatever landed in its place.
 *
 * The message is part of it because the subject is not enough to tell two rows
 * apart. One Template holding two bad holes yields two diagnostics with the same
 * code, Step, Board and field — `checkTemplate` reports per hole — and a
 * `core.fork` with two broken `when:` expressions files both under `when` on the
 * same Step, because that is the slot's name on every branch.
 */
const keyOf = (diagnostic: Diagnostic): string =>
  [
    diagnostic.code,
    diagnostic.blockId ?? '',
    diagnostic.stepId ?? diagnostic.triggerId ?? diagnostic.connectionId ?? '',
    diagnostic.fieldKey ?? '',
    diagnostic.message,
  ].join(':')

/**
 * The rows, each with a key nothing else in the list carries.
 *
 * Even the message is not a guarantee — two branches of a Fork whose conditions
 * are the same broken expression say the same sentence about the same slot — so
 * a repeat is numbered rather than deduplicated. Dropping one would disagree
 * with the count beside the panel, which reports every diagnostic the checker
 * raised.
 */
const keyed = (diagnostics: readonly Diagnostic[]): { key: string; diagnostic: Diagnostic }[] => {
  const seen = new Map<string, number>()
  return diagnostics.map((diagnostic) => {
    const identity = keyOf(diagnostic)
    const nth = (seen.get(identity) ?? 0) + 1
    seen.set(identity, nth)
    return { key: nth === 1 ? identity : `${identity}#${String(nth)}`, diagnostic }
  })
}

const problemCount = (count: number): string =>
  count === 1 ? '1 problem' : `${String(count)} problems`

/**
 * Whether anything on screen can be opened for this diagnostic.
 *
 * A Connection's id on its own is not enough: no region lists the Connections a
 * workflow declares — the surface that draws one is the `conn` field pointing at
 * it — so "this was never connected" about a Connection nothing uses names
 * nothing to go to.
 */
const navigable = (diagnostic: Diagnostic): boolean =>
  diagnostic.stepId !== undefined ||
  diagnostic.triggerId !== undefined ||
  diagnostic.blockId !== undefined

/**
 * The day, not the moment.
 *
 * Sliced rather than formatted: `toLocaleDateString` makes what renders depend
 * on the machine's locale and time zone, which turns every story and every
 * assertion into one that passes where it was written.
 *
 * Read defensively, because a type is a promise the Host makes and an endpoint
 * can break it. `createVersionStore` checks the page is a list and that every
 * row has the number it is keyed by; a row missing its timestamp is still a row
 * worth drawing, and throwing here would take the tree down over a date.
 */
const dateOf = (version: VersionSummary): string =>
  typeof version.updatedAt === 'string' ? version.updatedAt.slice(0, 10) : ''

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)
