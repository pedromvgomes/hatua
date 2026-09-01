import type { Diagnostic } from '@hatua/model'
import {
  type EditingState,
  PublishBlocked,
  unchecked,
  type ValidationState,
  type VersionSummary,
  type VersionsState,
} from '@hatua/services'
import {
  type ComponentPropsWithRef,
  type ReactNode,
  type RefObject,
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

/** Which floating layer is open. One at a time: they share an anchor row. */
type Layer = 'versions' | 'problems' | null

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
 * that button is not a thing to render. No **Build / Runs** segmented control:
 * `ExecutionSource` says "omit entirely and the Runs view is hidden", no Host
 * can wire one, and a control that switches to nothing is worse than no
 * control. Version rows do not select: read-only mode is a state of the canvas,
 * the step editor and the Workflow tab together rather than of this bar, which
 * ADR-0011's scope now says.
 */
export function TopBar({ className, onBrowseWorkflows, onRevealDiagnostic, ...rest }: TopBarProps) {
  const store = useEditingStore()
  const validation = useValidationStore()
  const versions = useVersionStore()

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
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  /** What the last **Publish** produced, so the ended session can say what ended it. */
  const [published, setPublished] = useState<number | null>(null)

  const versionsButton = useRef<HTMLButtonElement>(null)
  const publishButton = useRef<HTMLButtonElement>(null)

  const workflow = state.status === 'ready' ? state.workflow : null
  const definition = workflow?.definition ?? null

  /*
   * Absent, not zero, until the answer means something. Every Step looks like
   * an unknown component until the manifests land, so a count painted before
   * `ready` reports a dozen problems with a workflow that has none, on every
   * load.
   */
  const blocking = checks.ready ? checks.all : null

  const closeLayer = () => setLayer(null)

  const openProblems = (next: Attempt) => {
    setAttempt(next)
    setLayer('problems')
  }

  const attemptPublish = async () => {
    if (!store) return
    setBusy(true)
    try {
      const result = await store.publish()
      setPublished(result.version)
      setAttempt(null)
      setLayer(null)
      // The list the bar can open is now a version out of date, and so is the
      // one it would open next.
      versions?.reload()
    } catch (cause) {
      if (cause instanceof PublishBlocked) {
        openProblems({
          kind: 'blocked',
          message: cause.message,
          diagnostics: cause.diagnostics,
        })
      } else {
        openProblems({ kind: 'rejected', message: messageOf(cause) })
      }
    } finally {
      setBusy(false)
    }
  }

  const end = async (how: 'release' | 'discard') => {
    if (!store) return
    setBusy(true)
    try {
      await store[how]()
      setAttempt(null)
      if (how === 'discard') versions?.reload()
    } catch (cause) {
      openProblems({ kind: 'rejected', message: messageOf(cause) })
    } finally {
      setBusy(false)
    }
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
                  <button
                    type="button"
                    ref={versionsButton}
                    className={styles.version}
                    aria-haspopup="dialog"
                    aria-expanded={layer === 'versions'}
                    onClick={() => {
                      if (layer === 'versions') {
                        closeLayer()
                        return
                      }
                      versions?.load()
                      setLayer('versions')
                    }}
                  >
                    v{definition.version} · {statusLabel(definition.status)}
                  </button>
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
              {workflow.claimed ? (
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

                  {workflow.save.state === 'halted' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className={styles.halted}
                      onClick={() => store?.resumeSaving()}
                    >
                      Saving stopped — try again
                    </Button>
                  ) : null}

                  {blocking && blocking.length > 0 ? (
                    <button
                      type="button"
                      className={styles.count}
                      aria-haspopup="dialog"
                      aria-expanded={layer === 'problems'}
                      onClick={() => {
                        if (layer === 'problems') {
                          closeLayer()
                          return
                        }
                        openProblems({
                          kind: 'blocked',
                          message: '',
                          diagnostics: blocking,
                        })
                      }}
                    >
                      {problemCount(blocking.length)}
                    </button>
                  ) : null}

                  <Button
                    ref={publishButton}
                    size="sm"
                    variant="primary"
                    disabled={busy}
                    onClick={() => void attemptPublish()}
                  >
                    Publish
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => void end('release')}>
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
                  <p className={styles.ended}>
                    {published === null
                      ? 'You are no longer editing this workflow.'
                      : `Published as version ${published}.`}
                  </p>
                  <Button size="sm" variant="primary" onClick={() => store?.reopen()}>
                    Edit
                  </Button>
                </>
              )}
            </div>
          </>
        ) : null}
      </section>

      {layer === 'versions' && versions ? (
        <VersionLayer anchor={versionsButton} store={versions} onClose={closeLayer} />
      ) : null}

      {layer === 'problems' && attempt ? (
        <ProblemLayer
          anchor={publishButton}
          attempt={attempt}
          onReveal={onRevealDiagnostic}
          onClose={closeLayer}
        />
      ) : null}

      <ConfirmDialog
        open={confirming}
        tone="danger"
        title="Discard this draft?"
        description="Everything changed since the last published version is thrown away. This cannot be undone."
        confirmLabel="Discard draft"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          void end('discard')
        }}
      />
    </>
  )
}

/**
 * The workflow's versions, newest first, a page at a time.
 *
 * No row selects. ADR-0011 describes loading one through `loadVersion` and
 * putting the screen in a read-only mode, and that is a state of the canvas, the
 * step editor and the Workflow tab together — a row that highlighted and changed
 * nothing would claim a destination that does not exist.
 */
function VersionLayer({
  anchor,
  store,
  onClose,
}: {
  anchor: RefObject<HTMLButtonElement | null>
  store: NonNullable<ReturnType<typeof useVersionStore>>
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
          {state.versions.length === 0 ? (
            <p className={styles.muted}>There are no versions yet.</p>
          ) : (
            <ul className={styles.versions}>
              {state.versions.map((version) => (
                <li key={version.version} className={styles.versionRow}>
                  <span className={styles.versionNumber}>v{version.version}</span>
                  <span className={styles.versionStatus}>{version.status}</span>
                  <span className={styles.versionDate}>{dateOf(version)}</span>
                </li>
              ))}
            </ul>
          )}

          {/* A later page failing keeps every page before it — what is lost is
              the next page, not the history already on screen. */}
          {state.error ? <p className={styles.problem}>{state.error.message}</p> : null}

          {state.more ? (
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

/** What stopped the last **Publish**, and where to go about it. */
function ProblemLayer({
  anchor,
  attempt,
  onReveal,
  onClose,
}: {
  anchor: RefObject<HTMLButtonElement | null>
  attempt: Attempt
  onReveal?: (diagnostic: Diagnostic) => void
  onClose: () => void
}) {
  return (
    <Layer anchor={anchor} label="Problems" onClose={onClose}>
      {attempt.kind === 'rejected' ? (
        <p className={styles.problem}>{attempt.message}</p>
      ) : attempt.diagnostics.length === 0 ? (
        // The floor refused it: the document is not a Workflow Definition, so
        // there is nothing to attach a diagnostic to and the message is the
        // whole of what can be said.
        <p className={styles.problem}>{attempt.message}</p>
      ) : (
        <ul className={styles.problems}>
          {attempt.diagnostics.map((diagnostic) => (
            <li key={keyOf(diagnostic)} className={styles.problemRow}>
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
  anchor: RefObject<HTMLButtonElement | null>
  label: string
  onClose: () => void
  children: ReactNode
}) {
  const container = usePortalContainer()
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null)

  // Measured after layout and once per opening. The anchor is a toolbar control
  // that does not move while its panel is open, so tracking it would be work
  // done on every scroll for a position that never changes.
  useLayoutEffect(() => {
    const trigger = anchor.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const found = place({ left: rect.left, top: rect.top, bottom: rect.bottom }, LAYER)
    setAt({
      left: found.left,
      ...(found.top === undefined ? { bottom: found.bottom } : { top: found.top }),
    })
  }, [anchor])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      onClose()
      // Back to the control that opened it, or focus is left on <body> and the
      // next Tab starts from the top of the page.
      anchor.current?.focus()
    }

    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return
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
 * index would move a row's identity onto whatever landed in its place. Two
 * diagnostics carrying the same code about the same field of the same Step are
 * the same problem said twice.
 */
const keyOf = (diagnostic: Diagnostic): string =>
  [
    diagnostic.code,
    diagnostic.blockId ?? '',
    diagnostic.stepId ?? diagnostic.triggerId ?? diagnostic.connectionId ?? '',
    diagnostic.fieldKey ?? '',
  ].join(':')

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
 */
const dateOf = (version: VersionSummary): string => version.updatedAt.slice(0, 10)

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)
