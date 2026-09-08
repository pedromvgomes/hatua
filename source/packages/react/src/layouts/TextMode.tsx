import type { EditingState } from '@hatua/services'
import {
  type ComponentPropsWithRef,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { cx } from '../primitives/classNames'
import { useEditingStore } from '../theme/HatuaProvider'
import { useReadOnly } from '../theme/readOnly'
import styles from './TextMode.module.css'
import css from './TextMode.module.css?inline'

/**
 * **Text Mode**: the open **Workflow Definition** as the YAML it is.
 *
 * This is the screen ADR-0001 was written for. The store already held a
 * document that does not project and said so through `definition: null` rather
 * than refusing to open — all of it for a surface that renders `text`, which is
 * this one. It is the only place a document that no other region can draw is
 * repaired, and the only place the text can be taken away from a session that
 * has ended.
 *
 * ## What is typed becomes the document on a quiet period
 *
 * There is no Save button (ADR-0005), so the timing is autosave's own. A commit
 * per keystroke would be an undo entry per keystroke, and half-typed YAML is
 * unparseable most of the time, so most of them would be refusals.
 *
 * A commit that parses lands whether or not it is a **Workflow Definition** —
 * `setText` is exempt from ADR-0019's backstop, and ADR-0026 says why. One that
 * does not parse at all changes nothing: the document stays as it was, the text
 * stays under the caret, and the reason is said below the box.
 *
 * ## It follows the document when the document moves
 *
 * An undo, a **Restore**, a **Preview** entered from the bar — each republishes
 * `text`, and the box adopts it. Its own commit is not that: the document
 * serialises to what it serialises to, and a box that snapped to a normalised
 * copy of what somebody was halfway through typing would take the caret with
 * it.
 *
 * ## Read-only is `useReadOnly()`'s answer and not this region's
 *
 * A **Preview** and an ended session both make it uneditable, and the text stays
 * readable in both — which is the whole of the escape from a halt the claim
 * cannot resume: the document is intact, it is saved nowhere, and this is where
 * it can be selected and taken. Deriving the answer here instead is the mistake
 * the step editor made once (ADR-0024).
 */
export interface TextModeProps extends ComponentPropsWithRef<'section'> {
  /**
   * Whether the box is holding text the document has not taken.
   *
   * Only ever true for text that will not parse, because everything else is
   * committed on the quiet period. It is reported rather than handled here: the
   * region cannot stop itself being unmounted, and what to do about leaving with
   * it is the composing view's — `views/Text` asks before the screen changes,
   * because nothing else could ever show that text again.
   */
  onUnsavedChange?: (unsaved: boolean) => void
}

/**
 * The quiet period before what is typed becomes the document.
 *
 * The same 800ms the store waits before writing to the Host, and deliberately
 * so: the two delays are the same judgement about when somebody has stopped
 * typing, and a different number here would only mean the two stages of one
 * pause were tuned by different hands.
 */
const COMMIT_DELAY_MS = 800

const OPENING = { status: 'opening' } as const

// Module-level and therefore stable: useSyncExternalStore re-subscribes whenever
// `subscribe` changes identity.
const subscribeToNothing = () => () => {}
const readOpening = (): EditingState => OPENING

export function TextMode({ className, onUnsavedChange, ...rest }: TextModeProps) {
  const store = useEditingStore()
  const readOnly = useReadOnly()

  const state = useSyncExternalStore<EditingState>(
    store ? store.subscribe : subscribeToNothing,
    store ? store.getSnapshot : readOpening,
    readOpening,
  )

  // Idempotent, so every region that mounts may call it and only the first opens
  // the Draft.
  useEffect(() => {
    store?.open()
  }, [store])

  const text = state.status === 'ready' ? state.workflow.text : ''

  /**
   * What is in the box, or null when it is showing the document.
   *
   * Null rather than a copy of `text`, so "the reader has typed something the
   * document has not taken" is a state rather than a string comparison that a
   * round trip through the serialiser can make wrong.
   */
  const [typed, setTyped] = useState<string | null>(null)
  /** The document text this box is level with. */
  const [seen, setSeen] = useState(text)
  const [refused, setRefused] = useState<Error | null>(null)

  /*
   * The document moved underneath. Adjusted during render rather than in an
   * effect, which is what React asks for when state has to follow an input: an
   * effect would paint the old text for one frame first.
   *
   * A commit of this box's own does not reach here — `commit` sets `seen` to
   * whatever the store then holds, so the only thing left is somebody else's
   * change, and that is what the box adopts.
   */
  if (text !== seen) {
    setSeen(text)
    setTyped(null)
    setRefused(null)
  }

  const shown = typed ?? text
  const unsaved = typed !== null && typed !== text

  /*
   * Reported through an effect, because it is a message to a caller and not
   * something this render depends on. Sent on every change including the last
   * one, so a view holding the answer is never left believing there is text to
   * lose after it has been taken.
   */
  useEffect(() => {
    onUnsavedChange?.(unsaved)
  }, [unsaved, onUnsavedChange])

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const commit = (next: string) => {
    if (!store) return
    const refusal = store.setText(next)
    setRefused(refusal)
    /*
     * Level with the document, whatever it did with what was sent.
     *
     * Read straight off the store rather than waited for through the
     * subscription: the check above runs on the very next render, and without
     * this it would see the text the commit produced, call it somebody else's
     * change, and throw away what is in the box.
     */
    const after = store.getSnapshot()
    setSeen(after.status === 'ready' ? after.workflow.text : next)
  }

  const type = (next: string) => {
    setTyped(next)
    setRefused(null)
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = undefined
      commit(next)
    }, COMMIT_DELAY_MS)
  }

  // A pending commit belongs to a box that is on screen. Left armed, it fires
  // against a store the reader has navigated away from and lands an edit nobody
  // is looking at.
  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current)
    },
    [],
  )

  if (!store) {
    // Misconfiguration copy: a shipped product has its ports wired, so the only
    // possible reader is the integrator — and it names what fixes it.
    return (
      <section aria-label="Text" className={cx(styles.text, className)} {...rest}>
        <style href="hatua-text-mode" precedence="hatua">
          {css}
        </style>
        <p className={styles.said}>
          No workflow is wired up. Hatua has no storage of its own — a Host supplies it as ports=
          {'{{ workflows }}'}, and names which workflow to open as workflowId.
        </p>
      </section>
    )
  }

  return (
    <section aria-label="Text" className={cx(styles.text, className)} {...rest}>
      <style href="hatua-text-mode" precedence="hatua">
        {css}
      </style>

      {state.status === 'opening' ? <p className={styles.said}>Opening…</p> : null}
      {state.status === 'failed' ? (
        <p className={cx(styles.said, styles.wrong)}>{state.error.message}</p>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <textarea
            aria-label="Workflow YAML"
            className={styles.box}
            // Off, all four: this is a file, and a helper that capitalises a key
            // or turns a quote into a curly one writes YAML the parser refuses.
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            readOnly={readOnly}
            value={shown}
            onChange={(event) => type(event.currentTarget.value)}
            // What is typed reaches the document on the quiet period, and a blur
            // is the reader saying they are done sooner than the timer knows.
            onBlur={() => {
              if (timer.current === undefined || typed === null) return
              clearTimeout(timer.current)
              timer.current = undefined
              commit(typed)
            }}
          />
          <p className={cx(styles.foot, refused ? styles.wrong : undefined)} aria-live="polite">
            {refused
              ? refused.message
              : state.workflow.invalid
                ? // A document that parses and is not a Workflow Definition yet.
                  // Said plainly, because this is the surface it gets fixed on
                  // and every other one is empty until it is.
                  `Not a workflow yet — ${state.workflow.invalid.message}`
                : unsaved
                  ? 'Not applied yet.'
                  : ''}
          </p>
        </>
      ) : null}
    </section>
  )
}
