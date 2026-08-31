import { referencePath, referencesIn, tryParseTemplate } from '@hatua/expressions'
import {
  type BoardId,
  boardOf,
  boardScope,
  nameOf,
  type ScopeEntry,
  type Segment,
  scopeFor,
  slotsForStep,
} from '@hatua/model'
import { contextKeysIn, type ManifestEntry, manifestsIn } from '@hatua/schema'
import { type EditingState, type ManifestState, stepIn } from '@hatua/services'
import {
  type ComponentPropsWithRef,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { ReferenceTree } from '../compounds/ReferenceTree'
import { cx } from '../primitives/classNames'
import { useEditingStore, useManifestStore } from '../theme/HatuaProvider'
import styles from './Data.module.css'
import css from './Data.module.css?inline'

/**
 * The Data panel: everything the selected Step can read, as a read-only tree —
 * a Trigger's declared outputs, each upstream Step's outputs, Run Context and
 * the Board's variables.
 *
 * It is the same component the picker's **Reference** tab mounts, and it is not
 * a tab: the step editor expands leftward into it, so a run of mappings does
 * not mean reopening a popover each time.
 *
 * ## Drag out of it; do not edit in it
 *
 * A variable is *edited* in the Workflow tab and *read* here — one place to
 * change a thing and one place to use it. Every row is `draggable` and carries
 * the two MIME types a field's drop handler reads; clicking one copies the
 * token, because drag has no keyboard equivalent and a row that is a `<button>`
 * has to do something.
 *
 * ## What it shows when nothing is selected
 *
 * The **Board's** scope: Run Context, the Triggers or the Block's parameters,
 * and the variables — everything readable from a position nothing has chosen
 * yet. A Step's outputs are missing from it, and that is the honest answer:
 * only a position in the tree says which Steps are guaranteed to have run.
 *
 * ## Selection arrives as a prop
 *
 * A **Segment**, held by whatever composes the regions, exactly as
 * `<StepList>`, `<FlowMap>` and `<Inspector>` take theirs. No selection
 * context: a second mechanism for one piece of chrome state is how the parts
 * stop being independently mountable.
 */
export interface DataProps extends ComponentPropsWithRef<'section'> {
  /**
   * What is selected, as a Segment and never a bare id.
   *
   * A Segment of several has no single scope — a later Step reads more than an
   * earlier one — so the Board's is shown instead of one Step's, which is what
   * every Step in the Segment can read for certain.
   */
  selected?: Segment | null
  /**
   * Which Board to fall back to when nothing is selected. A Segment names its
   * own Board, so this only decides what an empty selection shows.
   */
  board?: BoardId
  /**
   * A leaf was pointed at or focused, and `null` when it was left.
   *
   * The step editor marks the fields reading it. Optional, and mounted alone
   * this region simply reports to nobody.
   */
  onHighlight?: (path: string | null) => void
}

/** "The Host wired nothing" is not a phase of the load, so it is not the store's to report. */
type PanelState = EditingState | { status: 'unconfigured' }
type CatalogueState = ManifestState | { status: 'unconfigured' }

const UNCONFIGURED = { status: 'unconfigured' } as const
const OPENING = { status: 'opening' } as const
const CATALOGUE_UNCONFIGURED = { status: 'unconfigured' } as const
const CATALOGUE_LOADING = { status: 'loading' } as const
const NO_ENTRIES: ManifestEntry[] = []
const NO_SCOPE: readonly ScopeEntry[] = []
const NO_PATHS: ReadonlySet<string> = new Set()

// Module-level and therefore stable: useSyncExternalStore re-subscribes
// whenever `subscribe` changes identity, and re-renders forever if `getSnapshot`
// returns a fresh object each call.
const subscribeToNothing = () => () => {}
const readUnconfigured = (): PanelState => UNCONFIGURED
const readOpening = (): PanelState => OPENING
const readCatalogueUnconfigured = (): CatalogueState => CATALOGUE_UNCONFIGURED
const readCatalogueLoading = (): CatalogueState => CATALOGUE_LOADING

export function Data({ className, selected, board = null, onHighlight, ...rest }: DataProps) {
  const store = useEditingStore()
  const manifests = useManifestStore()
  const [copied, setCopied] = useState('')

  // The one side effect: tell each store somebody is reading. Both are
  // idempotent, so every region that mounts may call them and only the first
  // opens the Draft or fetches the catalogue.
  useEffect(() => {
    store?.open()
    manifests?.load()
  }, [store, manifests])

  const state = useSyncExternalStore<PanelState>(
    store ? store.subscribe : subscribeToNothing,
    store ? store.getSnapshot : readUnconfigured,
    // Without a server snapshot this throws during SSR, and the whole package
    // is built to render there (ADR-0003). Opening is the honest answer:
    // claiming the edit is a client concern, so that is what hydration matches.
    store ? readOpening : readUnconfigured,
  )
  const catalogue = useSyncExternalStore<CatalogueState>(
    manifests ? manifests.subscribe : subscribeToNothing,
    manifests ? manifests.getSnapshot : readCatalogueUnconfigured,
    manifests ? readCatalogueLoading : readCatalogueUnconfigured,
  )

  const definition = state.status === 'ready' ? state.workflow.definition : null
  const entries = catalogue.status === 'ready' ? catalogue.manifests : NO_ENTRIES
  const served = useMemo(() => manifestsIn(entries), [entries])
  const context = useMemo(() => contextKeysIn(entries), [entries])

  const on: BoardId = selected?.board ?? board
  const step = useMemo(() => {
    if (!definition || !selected || selected.steps.length !== 1) return undefined
    const only = selected.steps[0]
    const found = boardOf(definition, on)
    return only && found ? stepIn(found.steps, only) : undefined
  }, [definition, selected, on])

  const scope = useMemo(() => {
    if (!definition) return NO_SCOPE
    return step
      ? scopeFor(definition, { board: on, id: step.id }, served, context)
      : boardScope(definition, on, served, context)
  }, [definition, step, on, served, context])

  /**
   * The paths the selected Step already reads.
   *
   * Over the parsed AST rather than a search of the text, because
   * `{{ steps.s1.total }}` and `{{ steps.s1.totals }}` share a prefix and only
   * the grammar knows where a path ends — the same reason nothing here
   * pattern-matches a Reference out of a Template.
   */
  const referenced = useMemo(() => {
    if (!definition || !step) return NO_PATHS
    const manifest = served.find((entry) => entry.use === step.use)
    return pathsRead(slotsForStep(definition, on, step, manifest))
  }, [definition, step, on, served])

  return (
    <>
      <style href="hatua-data" precedence="hatua">
        {css}
      </style>
      <section aria-label="Data" className={cx(styles.data, className)} {...rest}>
        <div className={styles.head}>
          <p className={styles.title}>
            {step ? `What ${nameOf(step)} can read` : 'What is in scope'}
          </p>
          {/* One live region, mounted for the life of the panel. Rendered
              conditionally it announces nothing much of the time: a live region
              generally has to EXIST before its content changes for the change
              to be announced. */}
          <p className={cx(styles.said, !copied && styles.silent)} role="status">
            {copied}
          </p>
        </div>

        <div className={styles.body}>
          {state.status === 'unconfigured' ? (
            <p className={styles.note}>
              No workflow is wired up. Hatua has no storage of its own — a Host supplies it as{' '}
              <code className={styles.code}>{'ports={{ workflows }}'}</code>, and names which
              workflow to open as <code className={styles.code}>workflowId</code>, both on{' '}
              <code className={styles.code}>{'<HatuaProvider>'}</code>.
            </p>
          ) : null}

          {state.status === 'opening' ? <p className={styles.note}>Opening the workflow…</p> : null}

          {state.status === 'failed' ? (
            <p className={styles.note} role="alert">
              The workflow could not be opened. {state.error.message}
            </p>
          ) : null}

          {state.status === 'ready' && !definition ? (
            <p className={styles.note}>
              This document is not a valid Workflow Definition yet, so nothing can be resolved
              against it. Your text is intact — nothing has been discarded.
            </p>
          ) : null}

          {definition && !step ? (
            <p className={styles.note}>
              {selected && selected.steps.length > 1
                ? 'Several steps are selected. This is what every one of them can read; pick a single step to see its own.'
                : 'Nothing is selected, so this is what any step here can read before anything has run.'}
            </p>
          ) : null}

          {definition ? (
            <ReferenceTree
              scope={scope}
              referenced={referenced}
              empty="There is nothing to read here yet."
              onChoose={(path) => copy(path, setCopied)}
              onHighlight={onHighlight}
            />
          ) : null}
        </div>
      </section>
    </>
  )
}

/**
 * Put the token on the clipboard, and say what happened.
 *
 * Drag is the gesture this panel is built around and it has no keyboard
 * equivalent — the same gap the catalogue's click path exists to fill. Copying
 * is the one action that fits a panel nothing is edited in: it writes to no
 * document, and it works from the keyboard because the row is a `<button>`.
 *
 * The clipboard is unavailable in plenty of ordinary places — an insecure
 * origin, a permission the user has refused — so the failure is said rather
 * than swallowed. Silence would read as a control that did nothing.
 */
function copy(path: string, said: (message: string) => void) {
  const token = `{{ ${path} }}`
  navigator.clipboard
    ?.writeText(token)
    .then(() => said(`Copied ${token}`))
    .catch(() => said('That could not be copied. Drag it into a field instead.'))
}

/** Every Reference path a set of Slots reads. */
function pathsRead(slots: readonly { template: string }[]): ReadonlySet<string> {
  const paths = new Set<string>()
  for (const slot of slots) {
    const parsed = tryParseTemplate(slot.template)
    if (!parsed.ok) continue
    for (const segment of parsed.template.segments) {
      if (segment.kind !== 'Hole') continue
      for (const node of referencesIn(segment.expr)) {
        const path = referencePath(node)
        if (path !== null) paths.add(path)
      }
    }
  }
  return paths
}
