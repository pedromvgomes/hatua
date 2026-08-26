import type { Band, Link } from '@hatua/layout'
import { layout, regionRefOf } from '@hatua/layout'
import {
  type Board,
  type BoardId,
  blockIdOf,
  blockOf,
  boardKey,
  boardOf,
  type Diagnostic,
  type InsertPoint,
  nameOf,
  type Region,
  type RegionRef,
  regionKey,
  regionsOf,
  type StepRef,
  stepKey,
  TRY_VERB,
} from '@hatua/model'
import type { Manifest, ManifestEntry, Step, WorkflowDefinition } from '@hatua/schema'
import { manifestsIn } from '@hatua/schema'
import {
  type EditingState,
  type ManifestState,
  moveStep,
  type ValidationState,
} from '@hatua/services'
import {
  type ComponentPropsWithRef,
  type Dispatch,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { cx } from '../primitives/classNames'
import { useEditingStore, useManifestStore, useValidationStore } from '../theme/HatuaProvider'
import { type BoardTab, BoardTabs } from '../units/BoardTabs'
import { CanvasControls } from '../units/CanvasControls'
import { Connectors } from '../units/Connectors'
import { InsertDot } from '../units/InsertDot'
import { JoinMarker } from '../units/JoinMarker'
import { NodeCard } from '../units/NodeCard'
import { RegionBand } from '../units/RegionBand'
import { RegionNest } from '../units/RegionNest'
import { RootNode } from '../units/RootNode'
import { COMPONENT_MIME, type ComponentDrag, decodeComponent } from './dragging'
import styles from './FlowMap.module.css'
import css from './FlowMap.module.css?inline'
import {
  fitView,
  openingView,
  panInto,
  stepZoom,
  type Viewport,
  wheelScale,
  wheelTravel,
  ZOOM,
  zoomAbout,
  zoomTo,
} from './viewport'

/**
 * The canvas: one Board's Step tree, drawn where `@hatua/layout` says.
 *
 * NOT the Flow tab. That holds `<StepList>` — the same tree as a dense, ordered
 * list — and the two are on screen together. The list is scannable and is where
 * the insert points are unambiguous; the map shows structure, which no list does
 * well. The tab labelled "Flow" and the region called `FlowMap` are two
 * different things, and one name between them is how they get confused.
 *
 * ## It computes no geometry
 *
 * Every number on screen comes from one `layout(board, …)` call: the cards from
 * `placements`, each region's frame and its word from `bands`, each container's
 * extent from `nests`, the mark where a Step's columns converge from `joins`,
 * where every line runs and where every `+` on one sits from `links`, and the
 * node above the first Step from `root`.
 *
 * The one thing it decides for itself is the edge style, because that is a
 * question about a region's *siblings* rather than about its own extent: a
 * column is dashed when it does not always run AND its Step owns more than one
 * region (ADR-0015). Positions are
 * never stored (ADR-0001), so a hand-edited Workflow Definition cannot disagree
 * with the map — and the map cannot disagree with the list, because both
 * enumerate regions with `regionsOf` and name them with the same `keyword`.
 *
 * ## Nothing is drawn between a Step and its regions
 *
 * A line on this map means "then", and a Step does not run after its own body.
 * So containment is drawn as *overlap* instead: a card sits astride its own
 * `<RegionNest>`, whose top edge crosses it `LAYOUT.nodeLid` below the card's
 * top, and the `<RegionBand>`s inside that are the regions themselves. Nothing
 * joins the two, which is what keeps the one idiom to one meaning.
 *
 * ## One Board at a time
 *
 * A call is a doorway into another Board rather than a body drawn inline
 * (ADR-0013): drawing a Block at its call sites hands back everything the
 * extraction bought, and a Block called from three places is drawn three times.
 * So a call site's card carries an **Open** control, and the canvas keeps a
 * tab strip: Boards are peers rather than a path, so a working set with one in
 * front is what says where you are and how to get anywhere else (ADR-0017).
 * Which Board is chrome — the document has no key for it, the same line
 * ADR-0001 draws around node positions — so it is held here and lifted into a
 * caller that wants the Flow tab to follow, exactly as `TabbedPanel` lifts
 * which tab is open. WHICH Boards are open is not lifted, because nothing
 * outside the canvas has tabs.
 *
 * ## The canvas pans and zooms, and the viewport is chrome
 *
 * There is no scroll container. The clipped box is fixed and `.surface` carries
 * a pan and a zoom (ADR-0016): a trackpad pans, ⌘/Ctrl + wheel and a pinch zoom
 * about the pointer, space and the middle button pan from anywhere, and a plain
 * drag on empty canvas does nothing at all — that gesture is reserved for the
 * marquee this canvas will want, and taking it for panning means retraining
 * people later.
 *
 * The viewport is held here and offered as two props rather than three. Every
 * other piece of chrome on this region is a controlled trio because a second
 * reader appeared for it; nothing reads a viewport. `defaultViewport` and
 * `onViewportChange` are enough for a Host to put somebody back where they
 * were, and not enough for a caller to drive the canvas into a state it cannot
 * get itself out of.
 */
export interface FlowMapProps extends Omit<ComponentPropsWithRef<'section'>, 'onSelect'> {
  /** Which Board the canvas opens on. `null` is the root Board. */
  defaultBoardId?: BoardId
  /**
   * Which Board is drawn, when the caller wants to say.
   *
   * `undefined` means uncontrolled; `null` is a value, and is the root Board.
   * That is why this is resolved with an explicit `!== undefined` rather than
   * `??`, which would read the root Board as "nobody said".
   */
  boardId?: BoardId
  /** Fired when a call is opened, or another tab is brought forward. */
  onBoardChange?: (board: BoardId) => void
  /**
   * Which Step is selected, as a `StepRef` and never a bare id.
   *
   * Ids are Board-local, so two Blocks may each hold a Step called `ret`
   * (ADR-0013) and a bare `ret` selects both. Selection now spans this region,
   * `<StepList>` and the step editor, which is when that stops being latent.
   *
   * `undefined` means uncontrolled; `null` is a value and means nothing is
   * selected. Resolved with an explicit `!== undefined` rather than `??`, for
   * the reason `boardId` above is — otherwise a caller clearing the selection
   * is indistinguishable from one that never had an opinion, and the canvas
   * falls back to whatever it last selected itself.
   */
  selected?: StepRef | null
  defaultSelected?: StepRef
  /**
   * Fired when a Step is selected, and never with nothing.
   *
   * The canvas has no gesture that clears a selection — a press on empty canvas
   * pans, and a press on a card selects it — so this reports a Step or does not
   * fire. Clearing is the caller's, by passing `selected={null}`.
   */
  onSelect?: (ref: StepRef) => void
  /**
   * Which containers are drawn collapsed, and a way to hear about it.
   *
   * `StepRef`s for the same reason selection is: a collapsed set of bare ids is
   * one set shared by every Board, so folding `each` on the root Board folds a
   * Block's `each` too. `layout` takes bare ids because a Board is already its
   * argument — this filters the set down to the Board on screen.
   */
  collapsed?: readonly StepRef[]
  defaultCollapsed?: readonly StepRef[]
  onCollapseChange?: (collapsed: StepRef[]) => void
  /**
   * Which individual columns are folded shut, and a way to hear about it.
   *
   * Beside `collapsed` and not merged with it, because the two are different
   * reliefs: the card's chevron folds a Step and its Nest is not drawn at all,
   * while a legend folds one column and leaves its siblings drawn. A wide Fork
   * has the problem a big `core.try` has, so any sibling column folds
   * (ADR-0015).
   *
   * `RegionRef`s for the reason `collapsed` holds `StepRef`s: a region is named
   * by its Board, its owner and which region it is, and `regionKey` is the flat
   * spelling `layout` reads them against.
   */
  collapsedRegions?: readonly RegionRef[]
  defaultCollapsedRegions?: readonly RegionRef[]
  onCollapsedRegionsChange?: (collapsed: RegionRef[]) => void
  /**
   * Fired when a `+` on the map is chosen. Optional — this region knows where a
   * Step would go and nothing at all about which Component to put there, so it
   * hands the point out and the Components tab fills it in.
   *
   * Its absence is meaningful and is a state the playground mounts: with no
   * handler the `+` is a drop target and nothing else, because moving an
   * existing Step needs no catalogue while adding a new one does.
   */
  onInsert?: (at: InsertPoint) => void
  /**
   * Fired when a Component card is dropped onto a `+`, with what it carried.
   *
   * What the drag holds rather than the Manifest: `dataTransfer` holds strings,
   * and this region has no catalogue to resolve one against anyway. Whatever is
   * above both regions turns it into a Step, the same way it does for a click —
   * so the two gestures produce the same command, and only one of them costs a
   * round trip through the tab strip.
   */
  onDropComponent?: (component: ComponentDrag, at: InsertPoint) => void
  /**
   * Where the canvas opens, read once when it first draws a Board.
   *
   * Uncontrolled and deliberately without a `viewport` twin: a controlled
   * viewport lets a caller pin the canvas somewhere the gestures cannot undo,
   * and observation on its own would be half a feature — a Host could record
   * where somebody was looking and never put them back.
   *
   * Opening a Block's Board ignores it and re-centres, because coordinates are
   * Board-local and carrying a pan across Boards lands in empty space.
   */
  defaultViewport?: Viewport
  /** Fired whenever the canvas is panned, zoomed or fitted. */
  onViewportChange?: (view: Viewport) => void
}

/** "The Host wired nothing" is not a phase of the load, so it is not the store's to report. */
type MapState = EditingState | { status: 'unconfigured' }

const UNCONFIGURED = { status: 'unconfigured' } as const
const OPENING = { status: 'opening' } as const

// Module-level and therefore stable: useSyncExternalStore re-subscribes whenever
// `subscribe` changes identity, and re-renders forever if `getSnapshot` returns
// a fresh object each call.
const subscribeToNothing = () => () => {}
const NO_PROBLEMS: ReadonlyMap<string, Diagnostic[]> = new Map()
const UNCHECKED: ValidationState = {
  byStep: NO_PROBLEMS,
  byTrigger: NO_PROBLEMS,
  all: [],
  ready: false,
}
type CatalogueState = ManifestState | { status: 'unconfigured' }
const CATALOGUE_UNCONFIGURED = { status: 'unconfigured' } as const
const CATALOGUE_LOADING = { status: 'loading' } as const
const NO_ENTRIES: ManifestEntry[] = []
const readCatalogueUnconfigured = (): CatalogueState => CATALOGUE_UNCONFIGURED
const readCatalogueLoading = (): CatalogueState => CATALOGUE_LOADING
const readUnchecked = (): ValidationState => UNCHECKED
const readUnconfigured = (): MapState => UNCONFIGURED
const readOpening = (): MapState => OPENING

export function FlowMap({
  defaultBoardId = null,
  boardId,
  onBoardChange,
  selected,
  defaultSelected,
  onSelect,
  collapsed,
  defaultCollapsed,
  onCollapseChange,
  collapsedRegions,
  defaultCollapsedRegions,
  onCollapsedRegionsChange,
  onInsert,
  onDropComponent,
  defaultViewport,
  onViewportChange,
  className,
  ...rest
}: FlowMapProps) {
  const store = useEditingStore()
  const catalogue = useManifestStore()
  const validation = useValidationStore()
  const [ownBoard, setOwnBoard] = useState<BoardId>(defaultBoardId)
  /*
   * Which Boards are open, root first.
   *
   * Held here and offered as no prop at all, the same call the viewport makes:
   * every other piece of chrome on this region is a controlled trio because a
   * second reader appeared for it, and nothing outside the canvas has tabs.
   * Which Board is ACTIVE keeps its trio — the step editor and a <StepList> a
   * Host mounts beside this both follow it.
   *
   * The root is always in the set and always first, so there is always a Board
   * to fall back to when one is closed (ADR-0017).
   */
  const [ownOpen, setOwnOpen] = useState<readonly BoardId[]>([null])
  const [ownSelected, setOwnSelected] = useState<StepRef | undefined>(defaultSelected)
  const [ownCollapsed, setOwnCollapsed] = useState<readonly StepRef[]>(defaultCollapsed ?? [])
  const [ownFoldedRegions, setOwnFoldedRegions] = useState<readonly RegionRef[]>(
    defaultCollapsedRegions ?? [],
  )
  /*
   * How many times something has been folded or unfolded.
   *
   * The boxes tween because `boxOf` writes animatable properties; the
   * connectors cannot, so they fade in over the same window rather than
   * pointing at boxes on their way somewhere else. This counts the folds
   * alone: an ordinary re-render must not make the lines blink.
   */
  const [redraws, setRedraws] = useState(0)
  const [dragging, setDragging] = useState<string | null>(null)
  /*
   * A Component from the catalogue is over the canvas.
   *
   * Separate from `dragging`, which names a Step this canvas is moving. The two
   * are different drags with different payloads and only one of them is a thing
   * this region can identify — but they are the same to a gap, which is either a
   * target or it is not, so they meet as one flag there.
   */
  const [carrying, setCarrying] = useState(false)

  // The one side effect: tell each store somebody is reading. Both are
  // idempotent, so every region that mounts may call them and only the first
  // opens the Draft or fetches the catalogue.
  useEffect(() => {
    if (validation) validation.load()
    else store?.open()
    catalogue?.load()
  }, [store, validation, catalogue])

  const state = useSyncExternalStore<MapState>(
    store ? store.subscribe : subscribeToNothing,
    store ? store.getSnapshot : readUnconfigured,
    // Without a server snapshot this throws during SSR, and the whole package is
    // built to render there (ADR-0003). Opening is the honest answer.
    store ? readOpening : readUnconfigured,
  )

  const served = useSyncExternalStore<CatalogueState>(
    catalogue ? catalogue.subscribe : subscribeToNothing,
    catalogue ? catalogue.getSnapshot : readCatalogueUnconfigured,
    catalogue ? readCatalogueLoading : readCatalogueUnconfigured,
  )
  // Keyed by `use`, which is how both `layout` and a card ask for one. Built
  // here rather than in the layout so the two readers cannot key it differently.
  const manifests = useMemo(() => {
    const entries = served.status === 'ready' ? served.manifests : NO_ENTRIES
    return new Map<string, Manifest>(
      manifestsIn(entries).map((manifest) => [manifest.use, manifest]),
    )
  }, [served])

  const checks = useSyncExternalStore<ValidationState>(
    validation ? validation.subscribe : subscribeToNothing,
    validation ? validation.getSnapshot : readUnchecked,
    readUnchecked,
  )
  // Absent, not empty. Every Step is an unknown component until the manifests
  // land, so painting `byStep` before `ready` marks every card on every load.
  const problems = checks.ready ? checks.byStep : NO_PROBLEMS

  const definition = state.status === 'ready' ? (state.workflow.definition ?? null) : null
  const wanted = boardId !== undefined ? boardId : ownBoard
  // Resolved against the document every render rather than held. A Block the
  // user deletes in Text Mode while its Board is open would otherwise leave this
  // drawing a tree that is gone; falling back to the root is what a tab
  // pointing at nothing would have to do anyway.
  const board = definition ? (boardOf(definition, wanted) ?? boardOf(definition, null)) : undefined

  /*
   * The open Boards that still exist, root first.
   *
   * Filtered against the document every render rather than pruned when a Block
   * goes, for the reason `board` is resolved that way: a Block deleted in Text
   * Mode would otherwise leave a tab whose Board is not there, and pressing it
   * is how the user would find out.
   */
  const open = ownOpen.includes(wanted) ? ownOpen : [...ownOpen, wanted]
  const tabs: BoardTab[] = definition
    ? open
        .filter((id) => id === null || blockOf(definition, id) !== undefined)
        .map((id) => ({ id, label: tabLabel(definition, id) }))
    : []

  /*
   * A Block deleted while its Board is open puts the canvas back on the root,
   * and says so rather than only looking as though it did.
   *
   * `board` already falls back, so nothing draws a tree that is gone — but the
   * fallback alone leaves `wanted` naming the deleted Block. The viewport is
   * keyed by it, so the root would be drawn at the dead Board's pan, every pan
   * after would be written into an entry nothing reads, and the root's own
   * saved viewport would be shadowed with no fit to recover it. A caller
   * holding which Board is open would still hold the deleted one, so a Step
   * added from the catalogue would target a Board that is not there.
   *
   * Reported once per Board. A controlled caller that ignores the change leaves
   * `wanted` naming the same missing Block on the next render, and re-reporting
   * it is a loop between this and whatever handed the prop down.
   */
  const disowned = useRef<BoardId>(null)
  useEffect(() => {
    if (!definition) return

    // Released the moment the Board it names is back — an undo, or a Host
    // writing the Block again. Held, the SECOND deletion of the same Block is
    // silent: the fallback below sees its own latch and reports nothing, and
    // `wanted` goes on naming a Board that is not there.
    if (disowned.current !== null && blockOf(definition, disowned.current)) {
      disowned.current = null
    }

    if (wanted === null || blockOf(definition, wanted)) return
    if (disowned.current === wanted) return
    disowned.current = wanted
    setOwnBoard(null)
    onBoardChange?.(null)
  }, [definition, wanted, onBoardChange])

  /*
   * `undefined` means uncontrolled and `null` is a value — nothing selected —
   * which is the same shape `boardId` carries and for the same reason. A `??`
   * here reads "the caller cleared it" as "nobody said" and falls through to
   * the selection this region made itself, which is what makes `onSelect`'s
   * documented clear impossible to perform.
   */
  const selection = selected !== undefined ? (selected ?? undefined) : ownSelected
  const folded = collapsed ?? ownCollapsed
  const foldedRegions = collapsedRegions ?? ownFoldedRegions

  const openBoard = (next: BoardId) => {
    // The internal state is kept in step even while controlled, so a caller that
    // stops passing `boardId` does not snap back to the Board it opened on.
    setOwnBoard(next)
    // One tab per Board and never per call site: a Block called from three
    // places has one Board, so opening it a second time brings its tab forward
    // rather than adding another (ADR-0017).
    setOwnOpen((was) => (was.includes(next) ? was : [...was, next]))
    onBoardChange?.(next)
  }

  /*
   * Close one Block's tab.
   *
   * Closing the Board being looked at falls back to the root rather than to a
   * neighbour, because the root is the one tab that is always there — a
   * neighbour is a tab that may itself have just been closed.
   */
  const closeBoard = (block: string) => {
    setOwnOpen((was) => was.filter((id) => id !== block))
    // The viewport goes with the tab. Kept, re-opening the Board restores a pan
    // made before it was closed rather than fitting to it — and the fit only
    // runs where there is no entry, so a Block whose contents changed in the
    // meantime opens on empty canvas with nothing to bring it back.
    setViews(({ [boardKey(block)]: _closed, ...rest }) => rest)
    if (wanted === block) openBoard(null)
  }

  const select = (ref: StepRef) => {
    setOwnSelected(ref)
    onSelect?.(ref)
  }

  const toggle = (ref: StepRef) => {
    setRedraws((count) => count + 1)
    const key = stepKey(ref)
    const next = folded.some((one) => stepKey(one) === key)
      ? folded.filter((one) => stepKey(one) !== key)
      : [...folded, ref]
    setOwnCollapsed(next)
    onCollapseChange?.([...next])
  }

  const toggleRegion = (ref: RegionRef) => {
    setRedraws((count) => count + 1)
    const key = regionKey(ref)
    const next = foldedRegions.some((one) => regionKey(one) === key)
      ? foldedRegions.filter((one) => regionKey(one) !== key)
      : [...foldedRegions, ref]
    setOwnFoldedRegions(next)
    onCollapsedRegionsChange?.([...next])
  }

  const move = (id: string, to: InsertPoint) => {
    store?.apply(moveStep({ board: board?.id ?? null, id }, to))
    setDragging(null)
  }

  /*
   * The pan and the zoom.
   *
   * Held here rather than inside `<Canvas>`, which is rendered only while the
   * document projects: a Text Mode edit that is briefly not a Workflow
   * Definition would otherwise unmount the canvas and take the viewport with
   * it, snapping the user back to the middle of the map on the next keystroke.
   *
   * `null` is "not placed yet" — the opening viewport needs the size of a box
   * that does not exist until the canvas has rendered once, so the canvas
   * measures one and fills this in.
   *
   * `defaultViewport` is read here and nowhere else. Read once means the
   * `useState` initialiser: consuming it during a render is consuming it in a
   * pass React may throw away, and under a Host's `StrictMode` — which is every
   * Host in development — it is the discarded pass that reads it.
   */
  const [views, setViews] = useState<Readonly<Record<string, Viewport>>>(() =>
    defaultViewport ? { [boardKey(defaultBoardId)]: defaultViewport } : {},
  )

  /*
   * One viewport per Board, and a Board with no entry yet is `null` — which is
   * what makes the canvas measure a box and fit to it.
   *
   * Coordinates are Board-local, so a pan carried across Boards lands in empty
   * space; a pan carried BACK to the Board it was made on lands exactly where
   * it was left. Keyed rather than reset, a tab therefore keeps its own place
   * without anything having to notice that the Board changed (ADR-0017).
   *
   * Keyed on the Board that was asked for rather than the one that resolved, so
   * an entry settles before the document has loaded and is not re-made when it
   * does.
   */
  const viewKey = boardKey(wanted)
  const view = views[viewKey] ?? null

  /*
   * Keyed on the Board, and memoised on it rather than on nothing.
   *
   * `useViewport` lists this as a dependency of the layout effect that measures
   * the box and of the hand-registered `wheel` listener, so a setter with a
   * fresh identity every render would re-measure and re-register on every one.
   * Changing identity when the BOARD changes is not that — it is exactly when
   * re-measuring is correct.
   *
   * The Board is read from the render that produced this closure and never
   * through a ref written during render: a render React throws away — which
   * under a Host's `StrictMode` is every second one — would leave the ref
   * naming a Board that is not on screen, and the next pan would be committed
   * into its entry instead. The Board on screen would not move and another
   * would be silently displaced.
   */
  const setView = useCallback<Dispatch<SetStateAction<Viewport | null>>>(
    (next) =>
      setViews((was) => {
        const to = typeof next === 'function' ? next(was[viewKey] ?? null) : next
        // A Board with no viewport holds no entry rather than a `null` one:
        // absent and "not placed yet" are the same answer, and storing both
        // spellings would make them look like different states.
        return to ? { ...was, [viewKey]: to } : was
      }),
    [viewKey],
  )

  /*
   * The observer is held in a ref and the report keyed on the viewport alone. A
   * Host passing an inline arrow — which is every Host — would otherwise make
   * this fire on every render of the region rather than on every move of it.
   */
  const tell = useRef(onViewportChange)
  useEffect(() => {
    tell.current = onViewportChange
  })
  useEffect(() => {
    if (view) tell.current?.(view)
  }, [view])

  // Held while the drag is over the canvas and dropped the moment it leaves, so
  // a drag that wanders off and ends elsewhere does not leave every gap lit.
  const dragIn = () => setCarrying(true)
  const dragOut = () => setCarrying(false)

  return (
    <>
      <style href="hatua-flow-map" precedence="hatua">
        {css}
      </style>
      <section aria-label="Flow map" className={cx(styles.flowMap, className)} {...rest}>
        {state.status === 'unconfigured' ? (
          <p className={styles.note}>
            No workflow is wired up. Hatua has no storage of its own — a Host supplies it as{' '}
            <code className={styles.code}>{'ports={{ workflows }}'}</code>, and names which workflow
            to open as <code className={styles.code}>workflowId</code>, both on{' '}
            <code className={styles.code}>{'<HatuaProvider>'}</code>.
          </p>
        ) : null}

        {state.status === 'opening' ? <p className={styles.note}>Opening the workflow…</p> : null}

        {state.status === 'failed' ? (
          <p className={styles.note} role="alert">
            The workflow could not be opened. {state.error.message}
          </p>
        ) : null}

        {/*
          Parsed, held, and not a Workflow Definition — the state ADR-0001 forces
          on every region that draws the tree. `toJSON()` throws, so there is no
          tree to lay out; the document is still open and still editable, and
          Text Mode is where it gets fixed.
        */}
        {state.status === 'ready' && !definition ? (
          <p className={styles.note}>
            This document is not a valid Workflow Definition yet, so there is no map to draw. Your
            text is intact — nothing has been discarded.
          </p>
        ) : null}

        {definition && board ? (
          <Canvas
            definition={definition}
            board={board}
            view={view}
            onView={setView}
            manifests={manifests}
            selection={selection}
            folded={folded}
            foldedRegions={foldedRegions}
            problems={problems}
            redraws={redraws}
            dragging={dragging}
            carrying={carrying}
            onSelect={select}
            onToggle={toggle}
            onToggleRegion={toggleRegion}
            tabs={tabs}
            onOpenBoard={openBoard}
            onCloseBoard={closeBoard}
            onInsert={onInsert}
            onDropComponent={onDropComponent}
            onDragStart={setDragging}
            onDragEnd={() => setDragging(null)}
            onDropStep={move}
            onDragIn={dragIn}
            onDragOut={dragOut}
          />
        ) : null}
      </section>
    </>
  )
}

function Canvas({
  definition,
  board,
  view,
  onView,
  manifests,
  selection,
  folded,
  foldedRegions,
  problems,
  redraws,
  dragging,
  carrying,
  onSelect,
  onToggle,
  onToggleRegion,
  tabs,
  onOpenBoard,
  onCloseBoard,
  onInsert,
  onDropComponent,
  onDragStart,
  onDragEnd,
  onDropStep,
  onDragIn,
  onDragOut,
}: {
  definition: WorkflowDefinition
  board: Board
  view: Viewport | null
  onView: Dispatch<SetStateAction<Viewport | null>>
  manifests: ReadonlyMap<string, Manifest>
  selection: StepRef | undefined
  folded: readonly StepRef[]
  foldedRegions: readonly RegionRef[]
  problems: ReadonlyMap<string, Diagnostic[]>
  redraws: number
  dragging: string | null
  carrying: boolean
  onSelect: (ref: StepRef) => void
  onToggle: (ref: StepRef) => void
  onToggleRegion: (ref: RegionRef) => void
  tabs: readonly BoardTab[]
  onOpenBoard: (board: BoardId) => void
  onCloseBoard: (block: string) => void
  onInsert?: (at: InsertPoint) => void
  onDropComponent?: (component: ComponentDrag, at: InsertPoint) => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDropStep: (id: string, to: InsertPoint) => void
  onDragIn: () => void
  onDragOut: () => void
}) {
  // Bare ids, because a Board is already `layout`'s argument. This is where a
  // set that spans Boards becomes the set for one of them, and it is the only
  // place the two spellings meet.
  const collapsed = new Set(folded.filter((ref) => ref.board === board.id).map((ref) => ref.id))
  // Not filtered by Board, because `regionKey` carries the Board itself — the
  // spelling is the same one `layout` mints, so a Block's `handler` and the root
  // Board's cannot collide the way two bare ids would.
  const collapsedRegions = new Set(foldedRegions.map(regionKey))
  const map = layout(board, { collapsed, collapsedRegions, manifests })
  const steps = new Map<string, Step>()
  for (const { step, ref } of walk(board)) steps.set(stepKey(ref), step)
  const connections = new Map(
    (definition.connections ?? []).map((one) => [one.id, one.ref ?? one.id]),
  )

  const canvas = useViewport({ root: map.root, content: map, at: view, onView })

  return (
    /*
      The clipped box. It never scrolls and never moves; `.surface` inside it
      carries the pan and the zoom, so the toolbar and the tab strip stay put
      while the map goes past underneath them.

      No role and no handler that would make it one: watching a wheel and a
      middle-drag go over a region is not something a user does TO it, and every
      target on the map is a `<button>` inside that is reachable on its own.
    */
    /* biome-ignore lint/a11y/noStaticElementInteractions: see above.
       biome-ignore lint/a11y/useKeyWithClickEvents: the click handler adds no
       command of its own — it moves focus off a control a pointer just pressed,
       and a keyboard press is the one case it deliberately leaves alone. There
       is nothing for a key to trigger. */
    <div
      ref={canvas.box}
      /*
        Focusable, and only programmatically: it is where focus goes after a
        pointer press on a control here, and a box that could be Tabbed onto
        would be a stop in the tab order that does nothing.
      */
      tabIndex={-1}
      className={cx(
        styles.viewport,
        canvas.grabbable && styles.grabbable,
        canvas.grabbing && styles.grabbing,
      )}
      onPointerDown={canvas.onPointerDown}
      onPointerMove={canvas.onPointerMove}
      onPointerUp={canvas.onPointerUp}
      onPointerCancel={canvas.onPointerUp}
      onFocus={canvas.onFocus}
      onClick={canvas.onClick}
    >
      {/*
        Only once a Block's Board is open. A strip holding nothing but the root
        names the one Board the canvas can draw, which is chrome over the map
        saying what the map already is.
      */}
      {tabs.length > 1 ? (
        <BoardTabs tabs={tabs} active={board.id} onActivate={onOpenBoard} onClose={onCloseBoard} />
      ) : null}
      {/*
        A Component dragged in from the catalogue is recognised here, at the
        surface, rather than at each gap.

        `dataTransfer` refuses `getData` until the drop, but it lists the types
        on every `dragover` — which is all this needs, because the private MIME
        type means "a Component, and the rest is inside" by itself. Without it a
        gap cannot tell a drag is happening until the pointer is already on top
        of it, so every gap stays a 20px target that has to be aimed at, while a
        Step dragged across this same canvas lights all of them. One drag, one
        affordance.

        `dragleave` fires on every child the pointer crosses, so leaving is the
        pointer landing outside this element and nowhere else.
      */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the surface is not a
          control and must not claim to be one — it watches a drag pass over it,
          which is not something a user does TO it. Every target the drag can
          land on is a `<button>` inside, and each is reachable on its own. */}
      <div
        ref={canvas.surface}
        className={styles.surface}
        style={{
          width: map.width,
          height: map.height,
          transform: `translate(${canvas.at.x}px, ${canvas.at.y}px) scale(${canvas.at.scale})`,
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(COMPONENT_MIME)) onDragIn()
        }}
        onDragLeave={(event) => {
          const to = event.relatedTarget
          if (!(to instanceof Node) || !event.currentTarget.contains(to)) onDragOut()
        }}
        onDrop={onDragOut}
      >
        {/*
          Frames first, then the lines, then everything that takes a pointer.
          A Nest before the Bands inside it, so a container's own extent is
          behind its regions rather than over them.
        */}
        {map.nests.map((nest) => (
          <RegionNest key={stepKey(nest.owner)} nest={nest} />
        ))}

        {/*
          Keyed by what the box IS and never by where it is, so folding a column
          moves the same element rather than unmounting one and mounting
          another — which is the whole of what makes the boxes tween.
        */}
        {map.bands.map((band) => {
          const { region, siblings } = regionOn(band, steps)
          const holder = steps.get(stepKey(band.owner))
          return (
            <RegionBand
              key={regionKey(regionRefOf(band))}
              band={band}
              owner={holder ? nameOf(holder) : band.owner.id}
              label={region?.branch?.label}
              when={region?.branch?.when}
              count={region?.steps.length ?? 0}
              dashed={!band.always && siblings > 1}
              onToggle={() => onToggleRegion(regionRefOf(band))}
            />
          )
        })}

        <Connectors links={map.links} width={map.width} height={map.height} redraws={redraws} />

        <RootNode
          rect={map.root}
          title={rootTitle(board)}
          summary={rootSummary(definition, board)}
        />

        {map.joins.map((join) => {
          const owner = steps.get(stepKey(join.owner))
          return (
            <JoinMarker
              key={stepKey(join.owner)}
              join={join}
              name={owner ? nameOf(owner) : join.owner.id}
            />
          )
        })}

        {/*
          The cards and the gaps between them are one list, the way <StepList>'s
          rows and its insert points are: a screen reader hears a list of Steps
          with somewhere to add one between each, rather than a flat set of
          buttons whose relationship is drawn and nothing else.
        */}
        <ul className={styles.cards} aria-label="Steps">
          {map.links.map((link, index) =>
            link.at && link.dotAt ? (
              <InsertDot
                // biome-ignore lint/suspicious/noArrayIndexKey: a gap is identified by where it is in the emitted order — a link has no identity of its own.
                key={`gap:${index}`}
                at={link.dotAt}
                label={insertLabel(link, steps, board)}
                active={dragging !== null || carrying}
                onInsert={onInsert ? () => onInsert(link.at as InsertPoint) : undefined}
                onDrop={
                  dragging || onDropComponent
                    ? (data) => {
                        const at = link.at as InsertPoint
                        // A Component card carries what it is under a private
                        // type; a Step being moved is one this canvas already
                        // knows about, held in state because `dataTransfer` is
                        // unreadable while a drag is over a target.
                        const component = decodeComponent(data.getData(COMPONENT_MIME))
                        if (component) onDropComponent?.(component, at)
                        else if (dragging) onDropStep(dragging, at)
                      }
                    : undefined
                }
              />
            ) : null,
          )}

          {map.placements.map((placement) => {
            const key = stepKey(placement.ref)
            const step = steps.get(key)
            if (!step) return null
            const opens = blockIdOf(step.use)
            return (
              <NodeCard
                key={key}
                step={step}
                rect={placement}
                manifest={manifests.get(step.use)}
                connections={connections}
                selected={selection !== undefined && stepKey(selection) === key}
                dragging={dragging === placement.ref.id}
                expanded={!collapsed.has(placement.ref.id)}
                opens={opens && blockOf(definition, opens) ? opens : undefined}
                problems={problems.get(key)}
                onSelect={() => onSelect(placement.ref)}
                onToggle={() => onToggle(placement.ref)}
                onOpen={() => opens && onOpenBoard(opens)}
                onDragStart={() => onDragStart(step.id)}
                onDragEnd={onDragEnd}
              />
            )
          })}
        </ul>
      </div>

      <CanvasControls
        scale={canvas.at.scale}
        min={ZOOM.min}
        max={ZOOM.max}
        levels={ZOOM.levels}
        onZoomIn={canvas.zoomIn}
        onZoomOut={canvas.zoomOut}
        onZoomTo={canvas.snapTo}
        onFit={canvas.fit}
      />
    </div>
  )
}

/** The middle button, which pans from anywhere the way space does. */
const MIDDLE_BUTTON = 1

/** Nowhere, for the paint before the canvas has been measured. */
const UNPLACED: Viewport = { x: 0, y: 0, scale: 1 }
const NO_BOX = { width: 0, height: 0 }

/**
 * Whether the key belongs to whatever has focus rather than to the canvas.
 *
 * Space presses a focused button and types a space in a focused field. Arming a
 * pan on it as well would mean a `+` on the map could not be pressed from the
 * keyboard.
 */
const takesSpace = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(?:input|textarea|select|button|a)$/i.test(target.tagName))

/**
 * The pan and the zoom, and every gesture that moves them (ADR-0016).
 *
 * The arithmetic is all in `./viewport`, over plain numbers, because jsdom has
 * no layout engine: a scale worked out inside a render is a number no test can
 * see. What is left here is which gesture calls which function.
 *
 * ## The gestures do not fight the drag-and-drop already on the canvas
 *
 * A card is moved with HTML5 drag-and-drop, which starts from a plain
 * pointer-down on a `<NodeCard>`. So panning claims neither: it answers to
 * space and to the middle button, and a plain drag on empty canvas does
 * nothing. That is not an omission — it is the gesture marquee selection will
 * want, and a canvas that pans on it would have to be retrained later.
 *
 * ## It is placed before it is painted
 *
 * The opening viewport needs the size of a box that does not exist until the
 * canvas has rendered once, so it is `null` until a layout effect can measure
 * one. A layout effect rather than an ordinary one because the difference is a
 * painted frame of the map in the wrong place.
 */
function useViewport({
  root,
  content,
  at,
  onView,
}: {
  root: { x: number; width: number }
  content: { width: number; height: number }
  at: Viewport | null
  onView: Dispatch<SetStateAction<Viewport | null>>
}) {
  const box = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  /** Space is down, so the next drag anywhere on the canvas pans it. */
  const [armed, setArmed] = useState(false)
  const [grabbing, setGrabbing] = useState(false)
  const grab = useRef<{ id: number; x: number; y: number } | null>(null)

  const setAt = onView
  const shift = (fn: (from: Viewport) => Viewport) => setAt((from) => (from ? fn(from) : from))
  const sizeOf = () => box.current?.getBoundingClientRect() ?? NO_BOX

  /*
   * Whether the viewport on screen is one THIS placed against a box with no
   * size. A viewport a caller supplied is neither provisional nor this
   * effect's to redo, however the canvas happened to measure at the time.
   */
  const provisional = useRef(false)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const frame = el.getBoundingClientRect()

    /*
     * A canvas measured before it is laid out is 0×0 — a Host mounting Hatua
     * inside a hidden tab panel is the ordinary way to arrive there — and
     * `openingView` then centres the root against a width of nothing. Placed
     * once and never again, that pan is permanent and only Fit recovers it.
     *
     * So a placement made against no box is provisional: kept, because it is
     * the best answer available and every later gesture builds on it, and
     * redone the first time a real measurement arrives. `map` is rebuilt on
     * every render, so this effect is already running whenever anything moves.
     */
    if (at && !provisional.current) return
    if (at && frame.width === 0) return

    provisional.current = frame.width === 0
    setAt(openingView(root, frame))
  }, [at, root, setAt])

  /*
   * `wheel` is registered by hand because it has to be cancellable: React
   * attaches its own passively, and a passive listener cannot call
   * `preventDefault` — so ⌘+wheel would zoom the canvas AND the browser's page
   * at the same time, and a two-finger pan would scroll whatever is behind.
   */
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const frame = el.getBoundingClientRect()
      const travel = wheelTravel(event, frame)
      setAt((from) => {
        if (!from) return from
        // A trackpad pinch arrives as a wheel with `ctrlKey` set, which is why
        // one branch serves both it and the modifier.
        if (event.ctrlKey || event.metaKey) {
          return zoomAbout(from, wheelScale(from.scale, travel.y), {
            x: event.clientX - frame.left,
            y: event.clientY - frame.top,
          })
        }
        return { ...from, x: from.x - travel.x, y: from.y - travel.y }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setAt])

  /*
   * Space arms a pan only while the canvas is the thing being used — the
   * pointer over it, or focus inside it.
   *
   * Hatua is a guest in someone's page. A window-wide space key that swallowed
   * the keystroke would take page-down away from every other part of the Host's
   * product for as long as a canvas is mounted anywhere on the screen.
   */
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ours = () => el.matches(':hover') || el.contains(document.activeElement)
    const down = (event: KeyboardEvent) => {
      if (event.key !== ' ' || takesSpace(event.target) || !ours()) return
      // Every repeat is consumed, not only the first. Holding space is how a
      // pan is held, and a repeat that reaches the document scrolls the Host's
      // page out from under the gesture — the browser starts sending them about
      // half a second in, which is well inside one drag.
      event.preventDefault()
      if (!event.repeat) setArmed(true)
    }
    const up = (event: KeyboardEvent) => {
      if (event.key === ' ') setArmed(false)
    }
    // A window that loses focus mid-gesture never sends the keyup, and the
    // canvas would come back grabbing at a key nobody is holding.
    const drop = () => setArmed(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', drop)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', drop)
    }
  }, [])

  return {
    box,
    surface,
    at: at ?? UNPLACED,
    grabbable: armed,
    grabbing,

    onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      if (!armed && event.button !== MIDDLE_BUTTON) return
      // Consumed, so the middle button does not also start the browser's own
      // autoscroll and so space+drag does not begin a text selection.
      event.preventDefault()
      grab.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
      setGrabbing(true)
      // Last, and only an improvement on the gesture: capture keeps a pan
      // tracking once the pointer has left the canvas, and a pan that stops
      // dead at the edge is a worse pan than one that carries on. Taking it
      // first would mean a pointer the browser will not hand over — a
      // synthesised one, a device that has already gone — throwing away the
      // whole gesture rather than the improvement to it.
      event.currentTarget.setPointerCapture(event.pointerId)
    },

    onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
      const from = grab.current
      if (!from || from.id !== event.pointerId) return
      const dx = event.clientX - from.x
      const dy = event.clientY - from.y
      grab.current = { id: from.id, x: event.clientX, y: event.clientY }
      // The offset is in screen pixels at every zoom, so a pointer delta is
      // added to it whole and nothing is divided by the scale.
      setAt((was) => (was ? { ...was, x: was.x + dx, y: was.y + dy } : was))
    },

    onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
      if (grab.current?.id !== event.pointerId) return
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      grab.current = null
      setGrabbing(false)
    },

    /*
     * Anything **on the map** that takes focus is panned to.
     *
     * A scroll container brings a focused child into view on its own; a
     * transform inside a clipped box has nothing to scroll, so this is where
     * that happens instead. Without it, tabbing to a card off the edge of the
     * map moves focus to something nobody can see.
     *
     * The chrome is excluded, and it has to be: the toolbar and the tab strip
     * sit closer to the frame's edge than the margin a pan aims for, so panning
     * to them would shift the map a few pixels every time one is pressed — and
     * they never move, so every press shifts it again.
     */
    onFocus(event: ReactFocusEvent<HTMLDivElement>) {
      const el = box.current
      if (!el || !surface.current?.contains(event.target)) return
      const frame = el.getBoundingClientRect()
      // A canvas with no size cannot say what is on screen, and every edge test
      // against an empty box reads as "off it".
      if (frame.width === 0 || frame.height === 0) return
      setAt((was) => (was ? panInto(was, event.target.getBoundingClientRect(), frame) : was))
    },

    /*
     * A pointer press anywhere here hands focus to the canvas itself.
     *
     * The canvas pans on space, and a browser leaves a clicked control focused
     * — so after one press of `+`, or one click on a card, the space bar
     * belongs to that control and pressing it repeats the press instead of
     * arming a pan. Refusing space to a focused button is not the alternative:
     * a `+` on the map has to answer the space bar, which is what a button is.
     *
     * Focus lands on the canvas box rather than nowhere, so the next Tab
     * carries on from the map instead of restarting at the top of the Host's
     * document.
     *
     * Only a pointer press. `detail` is 0 when a keyboard activated the
     * control, and there focus is the only thing saying where the user is.
     */
    onClick(event: ReactMouseEvent<HTMLDivElement>) {
      if (event.detail === 0) return
      box.current?.focus({ preventScroll: true })
    },

    zoomIn: () => shift((from) => stepZoom(from, 1, sizeOf())),
    zoomOut: () => shift((from) => stepZoom(from, -1, sizeOf())),
    snapTo: (scale: number) => shift((from) => zoomTo(from, scale, sizeOf())),
    fit: () => setAt(fitView(content, sizeOf())),
  }
}

/**
 * The region a Band draws, and how many regions its Step owns.
 *
 * Both from one walk of `regionsOf`, because the two questions are asked of the
 * same Step at the same moment and a second enumeration is a second answer. The
 * region gives the Branch's label and condition for the legend and how many
 * Steps a folded box is holding back; the count decides the edge.
 *
 * A Branch is found by the index `layout` put on the band and never by matching
 * the keyword: a fork of four conditions carries three bands all reading
 * `else if`, and the legend has to name the right one of them.
 *
 * **The dash needs a solid sibling.** A region is dashed when it does not always
 * run AND its Step owns more than one region. Dashed already means *placeholder*
 * in this codebase — the `+` is a dashed circle, an empty Band a dashed box —
 * and it survives that collision only beside a solid sibling to be read against
 * (ADR-0015). A lone `core.for_each` body has none, so it stays solid even
 * though its list may be empty.
 */
function regionOn(
  band: Band,
  steps: ReadonlyMap<string, Step>,
): { region: Region | undefined; siblings: number } {
  const step = steps.get(stepKey(band.owner))
  if (!step) return { region: undefined, siblings: 0 }

  const regions = [...regionsOf(step)]
  let branches = 0
  const region = regions.find((one) =>
    one.kind === 'branch' ? band.branchIndex === branches++ : one.kind === band.kind,
  )
  return { region, siblings: regions.length }
}

/**
 * What an insert point is called, spelled out rather than numbered.
 *
 * "Insert a Step at position 3" names three different places on a map with two
 * Branches. The sentence says which list and where in it, which is the same
 * thing `<StepList>`'s gaps say — the two surfaces offer the same insert points
 * and describe them the same way.
 */
function insertLabel(link: Link, steps: ReadonlyMap<string, Step>, board: Board): string {
  const at = link.at
  if (!at) return 'Insert a Step'

  const owner = at.parentId ? steps.get(stepKey({ board: board.id, id: at.parentId })) : undefined
  const scope = owner
    ? at.branchIndex !== undefined
      ? `the “${owner.branches?.[at.branchIndex]?.label ?? at.branchIndex}” branch`
      : at.region === 'handler'
        ? `the “${nameOf(owner)}” handler`
        : `the “${nameOf(owner)}” ${owner.use === TRY_VERB ? 'attempt' : 'loop'}`
    : board.id === null
      ? 'the workflow'
      : `the “${board.block?.name || board.id}” block`

  const list = owner
    ? at.branchIndex !== undefined
      ? (owner.branches?.[at.branchIndex]?.steps ?? [])
      : at.region === 'handler'
        ? (owner.handler ?? [])
        : (owner.steps ?? [])
    : board.steps

  if (list.length === 0) return `Add the first Step to ${scope}`
  if (at.index === 0) return `Insert a Step at the start of ${scope}`
  const after = list[at.index - 1]
  return after ? `Insert a Step after ${nameOf(after)}` : `Insert a Step at the end of ${scope}`
}

/**
 * What the strip calls one open Board.
 *
 * The root is "The workflow" rather than "Triggers": the tab names the whole
 * thing the user came from, while `rootTitle` names the node that starts it.
 */
const tabLabel = (definition: WorkflowDefinition, id: BoardId): string =>
  id === null ? 'The workflow' : blockOf(definition, id)?.name || id

/** Every Step on one Board, tagged with the ref that names it. */
function* walk(board: Board): Generator<{ step: Step; ref: StepRef }> {
  const from = function* (steps: readonly Step[]): Generator<{ step: Step; ref: StepRef }> {
    for (const step of steps) {
      yield { step, ref: { board: board.id, id: step.id } }
      for (const region of regionsOf(step)) yield* from(region.steps)
    }
  }
  yield* from(board.steps)
}

/** The Triggers at the root, the Block's name inside one. */
const rootTitle = (board: Board): string =>
  board.id === null ? 'Triggers' : board.block?.name || board.id

/**
 * The Board's parameter contract in a line.
 *
 * The root Board's is its Triggers and a Block's is what it declares — the same
 * row of the table ADR-0013 uses to say what each Board sees, which is why one
 * node says both.
 */
function rootSummary(definition: WorkflowDefinition, board: Board): string {
  if (board.id === null) {
    const count = definition.triggers?.length ?? 0
    return `${count} ${count === 1 ? 'trigger' : 'triggers'}`
  }
  const params = board.block?.params?.length ?? 0
  const outputs = board.block?.outputs?.length ?? 0
  return `${params} ${params === 1 ? 'param' : 'params'} · ${outputs} ${outputs === 1 ? 'output' : 'outputs'}`
}
