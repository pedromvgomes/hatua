import type { Band } from '@hatua/layout'
import { layout } from '@hatua/layout'
import {
  type Board,
  type BoardId,
  blockIdOf,
  blockOf,
  boardOf,
  type Diagnostic,
  nameOf,
  regionsOf,
  type StepRef,
  stepKey,
} from '@hatua/model'
import type { Branch, Step, WorkflowDefinition } from '@hatua/schema'
import type { EditingState, ValidationState } from '@hatua/services'
import { type ComponentPropsWithRef, useEffect, useState, useSyncExternalStore } from 'react'
import { cx } from '../primitives/classNames'
import { useEditingStore, useValidationStore } from '../theme/HatuaProvider'
import { JoinMarker } from '../units/JoinMarker'
import { NodeCard } from '../units/NodeCard'
import { RegionBand } from '../units/RegionBand'
import { RootNode } from '../units/RootNode'
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
 * the mark where a Fork's Branches converge from `joins`, and the node above the
 * first Step from `root`. Positions are never stored (ADR-0001), so a
 * hand-edited Workflow Definition cannot disagree with the map — and the map
 * cannot disagree with the list, because both enumerate regions with `regionsOf`
 * and name them with the same `keyword`.
 *
 * ## Nothing is drawn between cards
 *
 * There are no connectors on this map, and no unit for one. A Step runs because
 * of where it nests (ADR-0013), so there is no edge to draw and nothing to
 * attach one to — but that only refuses an *attachable* edge, and a plain rule
 * between two cards would still have been a decision. It is refused too: the
 * gap between two cards is what reads as a run of the flow, which is what
 * `LAYOUT.verticalGap` exceeding `nodeHeight` is for (`docs/handoff.md` § Flow
 * map geometry). A line down a column of cards that already share one spine
 * restates their adjacency and adds nothing. Where the flow does something a
 * column cannot say — alternatives, and where they converge — the band and the
 * join marker say it, and both are geometry this is handed.
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
  className,
  ...rest
}: FlowMapProps) {
  const store = useEditingStore()
  const validation = useValidationStore()
  const [ownBoard, setOwnBoard] = useState<BoardId>(defaultBoardId)
  const [ownSelected, setOwnSelected] = useState<StepRef | undefined>(defaultSelected)
  const [ownCollapsed, setOwnCollapsed] = useState<readonly StepRef[]>(defaultCollapsed ?? [])

  // The one side effect: tell the store somebody is reading. Idempotent, so
  // every region that mounts may call it and only the first opens the Draft.
  useEffect(() => {
    if (validation) validation.load()
    else store?.open()
  }, [store, validation])

  const state = useSyncExternalStore<MapState>(
    store ? store.subscribe : subscribeToNothing,
    store ? store.getSnapshot : readUnconfigured,
    // Without a server snapshot this throws during SSR, and the whole package is
    // built to render there (ADR-0003). Opening is the honest answer.
    store ? readOpening : readUnconfigured,
  )

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
            selection={selection}
            folded={folded}
            problems={problems}
            onSelect={select}
            onToggle={toggle}
            onOpenBoard={openBoard}
          />
        ) : null}
      </section>
    </>
  )
}

function Canvas({
  definition,
  board,
  selection,
  folded,
  problems,
  onSelect,
  onToggle,
  onOpenBoard,
}: {
  definition: WorkflowDefinition
  board: Board
  selection: StepRef | undefined
  folded: readonly StepRef[]
  problems: ReadonlyMap<string, Diagnostic[]>
  onSelect: (ref: StepRef) => void
  onToggle: (ref: StepRef) => void
  onOpenBoard: (board: BoardId) => void
}) {
  // Bare ids, because a Board is already `layout`'s argument. This is where a
  // set that spans Boards becomes the set for one of them, and it is the only
  // place the two spellings meet.
  const collapsed = new Set(folded.filter((ref) => ref.board === board.id).map((ref) => ref.id))
  const map = layout(board, { collapsed })
  const steps = new Map<string, Step>()
  for (const { step, ref } of walk(board)) steps.set(stepKey(ref), step)
  const branches = branchesByBand(map.bands, steps)

  return (
    <div className={styles.viewport}>
      <Breadcrumb board={board} onOpenBoard={onOpenBoard} />
      <div className={styles.surface} style={{ width: map.width, height: map.height }}>
        <RootNode
          rect={map.root}
          title={rootTitle(board)}
          summary={rootSummary(definition, board)}
        />

        {/* Bands first, so a region's frame sits behind the cards it holds. */}
        {map.bands.map((band) => {
          const branch = branches.get(band)
          return (
            <RegionBand
              key={`${stepKey(band.owner)}:${band.kind}:${band.x}:${band.y}`}
              band={band}
              label={branch?.label}
              when={branch?.when}
            />
          )
        })}

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
              selected={selection !== undefined && stepKey(selection) === key}
              expanded={!collapsed.has(placement.ref.id)}
              opens={opens && blockOf(definition, opens) ? opens : undefined}
              problems={problems.get(key)}
              onSelect={() => onSelect(placement.ref)}
              onToggle={() => onToggle(placement.ref)}
              onOpen={() => opens && onOpenBoard(opens)}
            />
          )
        })}
      </div>
    </div>
  )
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

/**
 * Which Branch each branch band is, so the band can show the label and the
 * condition beside the keyword.
 *
 * By position, never by the keyword: a fork of four conditions carries three
 * bands all reading `else if`. `regionsOf` yields a Step's Branches in document
 * order and `layout` keeps that order, so the nth branch band under one owner is
 * that owner's nth Branch.
 */
function branchesByBand(
  bands: readonly Band[],
  steps: ReadonlyMap<string, Step>,
): Map<Band, Branch> {
  const seen = new Map<string, number>()
  const found = new Map<Band, Branch>()

  for (const band of bands) {
    if (band.kind !== 'branch') continue
    const key = stepKey(band.owner)
    const index = seen.get(key) ?? 0
    seen.set(key, index + 1)
    const branch = steps.get(key)?.branches?.[index]
    if (branch) found.set(band, branch)
  }

  return found
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
