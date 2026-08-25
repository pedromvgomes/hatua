import type { Band, Link } from '@hatua/layout'
import { layout } from '@hatua/layout'
import {
  type Board,
  type BoardId,
  blockIdOf,
  blockOf,
  boardOf,
  type Diagnostic,
  type InsertPoint,
  nameOf,
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
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { cx } from '../primitives/classNames'
import { useEditingStore, useManifestStore, useValidationStore } from '../theme/HatuaProvider'
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
 * Every number on screen comes from one `layout(board, { collapsed })` call:
 * the cards from `placements`, each region's frame and its word from `bands`,
 * each container's extent from `nests`, the mark where a Fork's Branches
 * converge from `joins`, where every line runs and where every `+` on one sits
 * from `links`, and the node above the first Step from `root`. Positions are
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
 * So a call site's card carries an **Open** control, this region holds which
 * Board is on screen, and the breadcrumb goes back. Which Board is chrome — the
 * document has no key for it, the same line ADR-0001 draws around node
 * positions — so it is held here and lifted into a caller that wants the Flow
 * tab to follow, exactly as `TabbedPanel` lifts which tab is open.
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
  /** Fired when a call is opened or the breadcrumb goes back. */
  onBoardChange?: (board: BoardId) => void
  /**
   * Which Step is selected, as a `StepRef` and never a bare id.
   *
   * Ids are Board-local, so two Blocks may each hold a Step called `ret`
   * (ADR-0013) and a bare `ret` selects both. Selection now spans this region,
   * `<StepList>` and the step editor, which is when that stops being latent.
   */
  selected?: StepRef
  defaultSelected?: StepRef
  onSelect?: (ref: StepRef | undefined) => void
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
  onInsert,
  onDropComponent,
  className,
  ...rest
}: FlowMapProps) {
  const store = useEditingStore()
  const catalogue = useManifestStore()
  const validation = useValidationStore()
  const [ownBoard, setOwnBoard] = useState<BoardId>(defaultBoardId)
  const [ownSelected, setOwnSelected] = useState<StepRef | undefined>(defaultSelected)
  const [ownCollapsed, setOwnCollapsed] = useState<readonly StepRef[]>(defaultCollapsed ?? [])
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
  // drawing a tree that is gone; falling back to the root is what a breadcrumb
  // pointing at nothing would have to do anyway.
  const board = definition ? (boardOf(definition, wanted) ?? boardOf(definition, null)) : undefined

  const selection = selected ?? ownSelected
  const folded = collapsed ?? ownCollapsed

  const openBoard = (next: BoardId) => {
    // The internal state is kept in step even while controlled, so a caller that
    // stops passing `boardId` does not snap back to the Board it opened on.
    setOwnBoard(next)
    onBoardChange?.(next)
  }

  const select = (ref: StepRef) => {
    setOwnSelected(ref)
    onSelect?.(ref)
  }

  const toggle = (ref: StepRef) => {
    const key = stepKey(ref)
    const next = folded.some((one) => stepKey(one) === key)
      ? folded.filter((one) => stepKey(one) !== key)
      : [...folded, ref]
    setOwnCollapsed(next)
    onCollapseChange?.([...next])
  }

  const move = (id: string, to: InsertPoint) => {
    store?.apply(moveStep({ board: board?.id ?? null, id }, to))
    setDragging(null)
  }

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
            manifests={manifests}
            selection={selection}
            folded={folded}
            problems={problems}
            dragging={dragging}
            carrying={carrying}
            onSelect={select}
            onToggle={toggle}
            onOpenBoard={openBoard}
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
  manifests,
  selection,
  folded,
  problems,
  dragging,
  carrying,
  onSelect,
  onToggle,
  onOpenBoard,
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
  manifests: ReadonlyMap<string, Manifest>
  selection: StepRef | undefined
  folded: readonly StepRef[]
  problems: ReadonlyMap<string, Diagnostic[]>
  dragging: string | null
  carrying: boolean
  onSelect: (ref: StepRef) => void
  onToggle: (ref: StepRef) => void
  onOpenBoard: (board: BoardId) => void
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
  const map = layout(board, { collapsed, manifests })
  const steps = new Map<string, Step>()
  for (const { step, ref } of walk(board)) steps.set(stepKey(ref), step)
  const connections = new Map(
    (definition.connections ?? []).map((one) => [one.id, one.ref ?? one.id]),
  )

  return (
    <div className={styles.viewport}>
      <Breadcrumb board={board} onOpenBoard={onOpenBoard} />
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
        className={styles.surface}
        style={{ width: map.width, height: map.height }}
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
          <RegionNest key={`${stepKey(nest.owner)}:${nest.y}`} nest={nest} />
        ))}

        {map.bands.map((band) => {
          const branch = branchOn(band, steps)
          return (
            <RegionBand
              key={`${stepKey(band.owner)}:${band.kind}:${band.x}:${band.y}`}
              band={band}
              label={branch?.label}
              when={branch?.when}
            />
          )
        })}

        <Connectors links={map.links} width={map.width} height={map.height} />

        <RootNode
          rect={map.root}
          title={rootTitle(board)}
          summary={rootSummary(definition, board)}
        />

        {map.joins.map((join) => {
          const owner = steps.get(stepKey(join.owner))
          return (
            <JoinMarker
              key={`${stepKey(join.owner)}:${join.y}`}
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
    </div>
  )
}

/**
 * The Branch a Band is, when it is one — for the label and the condition beside
 * the keyword in its legend.
 *
 * By the index `layout` put on the band, never by matching the keyword: a fork
 * of four conditions carries three bands all reading `else if`.
 */
const branchOn = (band: Band, steps: ReadonlyMap<string, Step>) =>
  band.branchIndex === undefined
    ? undefined
    : steps.get(stepKey(band.owner))?.branches?.[band.branchIndex]

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
 * Where the canvas is, and the way back out.
 *
 * A Board is not nested inside another — a Block is called, possibly from three
 * places — so this is two entries and never a path. "The workflow" is where
 * Open came from and where Back returns to, which is the whole of the doorway.
 */
function Breadcrumb({
  board,
  onOpenBoard,
}: {
  board: Board
  onOpenBoard: (board: BoardId) => void
}) {
  if (board.id === null) return null

  return (
    <nav className={styles.crumbs} aria-label="Board">
      <button type="button" className={styles.back} onClick={() => onOpenBoard(null)}>
        ← The workflow
      </button>
      <span className={styles.here}>{board.block?.name || board.id}</span>
    </nav>
  )
}

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
