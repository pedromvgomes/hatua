import {
  type Board,
  type BoardId,
  blockIdOf,
  boardOf,
  type Diagnostic,
  nameOf,
  type Region,
  regionsOf,
  type Segment,
  type StepRef,
  segmentHolds,
  segmentOf,
  stepKey,
  summaryOf,
  troubledBlocks,
} from '@hatua/model'
import type { Branch, Step } from '@hatua/schema'
import {
  type EditingState,
  type InsertPoint,
  moveStep,
  removeStep,
  type ValidationState,
} from '@hatua/services'
import {
  type ComponentPropsWithRef,
  Fragment,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { Button } from '../primitives/Button'
import { cx } from '../primitives/classNames'
import { useEditingStore, useValidationStore } from '../theme/HatuaProvider'
import styles from './StepList.module.css'
import css from './StepList.module.css?inline'

/**
 * The Flow tab: the Workflow Definition's Steps as a tree, depth-first, with
 * the Branch headers and the insert points between them.
 *
 * A list, not a map. The tree and the map are on screen together — this in the
 * 304px side panel, <FlowMap> filling the middle — and they are not redundant:
 * the list is dense, ordered and scannable at a glance in a long workflow, and
 * it is where a Step is dragged from and where the insert points are
 * unambiguous. The map shows structure, which no list does well.
 *
 * The **Flow** tab holds this, not the canvas. A canvas mounted as one of three
 * tabs is visible only while that tab is open and never beside the panel it is
 * edited from, which is no canvas at all.
 *
 * ## The structural edits are here
 *
 * Insert, remove, drag and Alt+Arrow. A list has a gap between every two
 * siblings and a map of cards has none, which is what makes an insert point
 * unambiguous here and would make it an invention there — and an empty Board is
 * a root node with no cards under it at all. The canvas selects, folds and opens
 * a call; it reads the document and writes none of it.
 *
 * ## One Board, and which one
 *
 * `board` says which: a Block's id, or `null` for the root. A plain prop rather
 * than state, because nothing in a list is a doorway — a call is opened on the
 * canvas (ADR-0013) and `<Build>` holds one Board for both surfaces, so this
 * follows it. Two surfaces showing two different Boards at once is the map and
 * the list disagreeing about what is on screen.
 *
 * ## Where the document comes from
 *
 * Not from props, and not from a fetch of its own. Hatua has no storage and no
 * idea where a workflow lives; the Host supplies a `WorkflowStore`, and
 * <HatuaProvider> turns it into the editing store this subscribes to. Both
 * embeddings mount this region bare — `apps/playground/src/host.tsx` writes
 * `<StepList />` and `layouts/regions.test.tsx` renders it with nothing above
 * it — so a document prop would break the promise those two exist to keep.
 *
 * ## What is chrome and what is the document
 *
 * Selection and collapse are chrome, held here, and deliberately NOT in the
 * Workflow Definition — the same line `TabbedPanel` draws around which tab is
 * open. ADR-0001 is the reason it matters: a file the user hand-edits must not
 * gain keys about what some session had highlighted, and node positions are
 * already excluded on exactly that argument.
 *
 * Structural change is the opposite: it goes through the editing store as a
 * command against the document, which is what makes a canvas edit and a text
 * edit the same edit.
 */
export interface StepListProps extends Omit<ComponentPropsWithRef<'section'>, 'onSelect'> {
  /**
   * Fired when the selection changes. Optional, and its absence is meaningful
   * in the same way `Components`'s is: with no handler there is still selection
   * to show, but nothing outside this region hears about it.
   *
   * `undefined` means nothing is selected — which is what removing the selected
   * Step leaves behind. A caller holding the selection across a remount has to
   * hear that, or it keeps handing back the id of a Step that is gone.
   */
  onSelect?: (segment: Segment | undefined) => void
  /**
   * Fired when an insert point is chosen. Optional — this region knows where a
   * Step would go and nothing at all about which Component to put there, so it
   * hands the point out and the Components tab fills it in.
   */
  onInsert?: (at: InsertPoint) => void
  /**
   * Which Board this lists: a Block's id, or `null` for the root.
   *
   * A plain prop rather than state, because nothing in a list is a doorway —
   * a call is opened on the canvas (ADR-0013), and this follows it so the two
   * surfaces are never showing two different Boards at once.
   */
  board?: BoardId
  /**
   * What is selected, as a **Segment** and never a bare id: ids are Board-local,
   * so two Blocks may each hold a Step called `ret` and a bare `ret` highlights
   * a row on both Boards.
   *
   * A Segment because selection is one thing across this region, the canvas and
   * the step editor (ADR-0020), and the canvas is where more than one Step is
   * picked. **This region highlights a Segment and offers no gesture that
   * builds one** — a list is not where a stretch of Steps is chosen, and a
   * second way to build one would be a second answer to what a selection is.
   * Clicking a row selects that row alone, as it always has.
   *
   * Controlled when given, seeded by `defaultSelected` when not. Only one of
   * the three surfaces is remounted by the tab strip, so the region that holds
   * it has to be able to say what the others show.
   *
   * `undefined` means uncontrolled; `null` is a value and means nothing is
   * selected. Two spellings because one value cannot carry both meanings, and
   * `onSelect` reports `undefined` when the selected Step is removed — a caller
   * handing that straight back would otherwise be saying "nobody said" and get
   * the row this region last highlighted itself.
   */
  selected?: Segment | null
  defaultSelected?: Segment
  /**
   * Which containers start collapsed, and a way to hear about it.
   *
   * Both are chrome and both stay chrome — they never reach the document, the
   * same line ADR-0001 draws around node positions. What they are not is
   * necessarily short-lived: `<TabbedPanel>` renders only the open tab, so
   * anything held in here is thrown away every time the user looks at another
   * tab. In `<Build>` that happens on the way to adding a Step — Flow, then
   * Components, then back — which is precisely when losing the selection and
   * re-expanding every container is most annoying.
   *
   * So a caller that wants this state to outlive a remount holds it and hands
   * it back, the way the design already has selection work. A caller that does
   * not, does nothing, and the region behaves as it always has.
   */
  defaultCollapsed?: readonly StepRef[]
  /** Which containers are collapsed, when the caller wants to say. */
  collapsed?: readonly StepRef[]
  /** Fired when a container is expanded or collapsed, with everything now collapsed. */
  onCollapseChange?: (collapsed: StepRef[]) => void
}

/** "The Host wired nothing" is not a phase of the load, so it is not the store's to report. */
type ListState = EditingState | { status: 'unconfigured' }

const UNCONFIGURED = { status: 'unconfigured' } as const
const OPENING = { status: 'opening' } as const

// Module-level and therefore stable: useSyncExternalStore re-subscribes
// whenever `subscribe` changes identity, and re-renders forever if `getSnapshot`
// returns a fresh object each call.
const subscribeToNothing = () => () => {}
const NO_PROBLEMS: ReadonlyMap<string, Diagnostic[]> = new Map()
/** The same, for the Blocks a row may report as unable to run. */
const NO_TROUBLE: ReadonlySet<string> = new Set()
const UNCHECKED: ValidationState = {
  byStep: NO_PROBLEMS,
  byTrigger: NO_PROBLEMS,
  byBlock: NO_PROBLEMS,
  all: [],
  ready: false,
}
const readUnchecked = (): ValidationState => UNCHECKED
const readUnconfigured = (): ListState => UNCONFIGURED
const readOpening = (): ListState => OPENING

export function StepList({
  onSelect,
  onInsert,
  board = null,
  selected,
  defaultSelected,
  defaultCollapsed,
  collapsed,
  onCollapseChange,
  className,
  ...rest
}: StepListProps) {
  const store = useEditingStore()
  const validation = useValidationStore()
  const [ownSelected, setOwnSelected] = useState<Segment | undefined>(defaultSelected)
  const [ownCollapsed, setOwnCollapsed] = useState<readonly StepRef[]>(defaultCollapsed ?? [])
  const [dragging, setDragging] = useState<string | null>(null)

  // The one side effect: tell the store somebody is reading. It is idempotent,
  // so every region that mounts may call it and only the first opens the Draft.
  useEffect(() => {
    // `load()` opens the Draft AND asks for the catalogue, because validation
    // needs both. A Host mounting this region and no catalogue would otherwise
    // never fetch a manifest, and every Step would sit unchecked with nothing
    // saying why.
    if (validation) validation.load()
    else store?.open()
  }, [store, validation])

  const state = useSyncExternalStore<ListState>(
    store ? store.subscribe : subscribeToNothing,
    store ? store.getSnapshot : readUnconfigured,
    // Without a server snapshot this throws during SSR, and the whole package is
    // built to render there (ADR-0003). Opening is the honest answer: claiming
    // the edit is a client concern, so that is also what hydration matches.
    store ? readOpening : readUnconfigured,
  )

  const workflow = state.status === 'ready' ? state.workflow : null
  const definition = workflow?.definition ?? null
  // Resolved against the document every render. A Block deleted in Text Mode
  // while its Board is listed would otherwise leave this drawing a tree that is
  // gone; falling back to the root is what the canvas's breadcrumb does too.
  const listed = definition ? (boardOf(definition, board) ?? boardOf(definition, null)) : undefined

  const selection = selected !== undefined ? (selected ?? undefined) : ownSelected
  const folded = collapsed ?? ownCollapsed
  const foldedHere = new Set(folded.filter((ref) => ref.board === listed?.id).map((ref) => ref.id))
  const refOf = (id: string): StepRef => ({ board: listed?.id ?? null, id })

  const checks = useSyncExternalStore<ValidationState>(
    validation ? validation.subscribe : subscribeToNothing,
    validation ? validation.getSnapshot : readUnchecked,
    readUnchecked,
  )
  // Absent, not empty. "Not checked yet" and "checked and fine" must not look
  // the same: every Step is an unknown component until the manifests land, so
  // painting `byStep` before `ready` would flash a marker on every row of a
  // perfectly good workflow on each load.
  const problems = checks.ready ? checks.byStep : NO_PROBLEMS

  /*
   * The Blocks that will not run, so a call into one says so rather than
   * looking finished. Derived and never a diagnostic: the problem is reported
   * on the Board that holds it, and a second one per call site would count one
   * fault once per doorway (`troubledBlocks`). Absent, not empty, for the same
   * reason `problems` is.
   */
  const troubled = useMemo(
    () => (checks.ready && definition ? troubledBlocks(definition, checks.all) : NO_TROUBLE),
    [checks.ready, checks.all, definition],
  )

  const select = (id: string) => {
    const picked = segmentOf(refOf(id))
    // The internal state is kept in step even while controlled, so a caller that
    // stops passing `selected` does not snap back to whatever was highlighted
    // when it started.
    setOwnSelected(picked)
    onSelect?.(picked)
  }

  const toggle = (id: string) => {
    const key = stepKey(refOf(id))
    const next = folded.some((one) => stepKey(one) === key)
      ? folded.filter((one) => stepKey(one) !== key)
      : [...folded, refOf(id)]
    setOwnCollapsed(next)
    onCollapseChange?.([...next])
  }

  const remove = (id: string) => {
    store?.apply(removeStep(refOf(id)))
    if (!segmentHolds(selection, refOf(id))) return
    // The whole selection goes, not only the row that went: a Segment with one
    // of its Steps taken out of the middle is no longer contiguous, and the one
    // shape a selection has is the shape this region must not be the first to
    // break (ADR-0020).
    setOwnSelected(undefined)
    // Told, not just forgotten locally. <Build> holds this across the unmount
    // the tab strip forces, so a selection cleared only in here comes back on
    // the next mount naming a Step the document no longer has.
    onSelect?.(undefined)
  }

  const move = (id: string, to: InsertPoint) => {
    store?.apply(moveStep(refOf(id), to))
    setDragging(null)
  }

  /**
   * Alt+Arrow moves a Step within its own list.
   *
   * Dragging is the design's mechanism and it is implemented below, but a
   * pointer is not the only way anyone edits a workflow: HTML5 drag and drop is
   * unreachable from the keyboard, so a list where reordering is drag-only is a
   * list some people cannot reorder. Within the list rather than across it,
   * because moving between Branches needs a target the user can see, and that
   * is what the insert points are for.
   */
  const nudge = (
    event: KeyboardEvent<HTMLLIElement>,
    step: Step,
    at: InsertPoint,
    count: number,
  ) => {
    if (!event.altKey) return

    // Only this row's own controls. A nested list's insert points are DOM
    // descendants of their container's <li>, so the innermost handler an
    // Alt+Arrow from a `+` inside a loop reaches is the LOOP's — and stopping
    // propagation cannot help, because there is no nearer handler to stop it
    // at. Pressing it there moved the loop rather than doing nothing.
    if ((event.target as HTMLElement).closest('li') !== event.currentTarget) return
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
    if (delta === 0) return

    // Stopped here, before anything else is decided.
    //
    // A container Step's <li> WRAPS its children's, so this handler is bound at
    // every level the event bubbles through: one Alt+Arrow on a Step inside a
    // loop moved that Step and then moved the loop, two document mutations and
    // two undo entries from one keypress. `preventDefault` does not stop that —
    // only propagation does. It also has to happen on the clamped no-op, or a
    // Step already at the end of its list silently moves its parent instead.
    event.stopPropagation()
    event.preventDefault()

    const target = at.index + delta
    if (target < 0 || target > count - 1) return
    // +1 on the way down, because `moveStep` reads its index against the list
    // as it stands BEFORE the Step is lifted out of it.
    store?.apply(moveStep(refOf(step.id), { ...at, index: delta > 0 ? target + 1 : target }))
  }

  const liveMessage =
    state.status === 'opening'
      ? 'Opening the workflow…'
      : workflow?.save.state === 'halted'
        ? 'Saving stopped. Your changes are still here.'
        : ''

  return (
    <>
      <style href="hatua-step-list" precedence="hatua">
        {css}
      </style>
      <section aria-label="Steps" className={cx(styles.stepList, className)} {...rest}>
        <div className={styles.body}>
          {state.status === 'unconfigured' ? (
            <p className={styles.note}>
              No workflow is wired up. Hatua has no storage of its own — a Host supplies it as{' '}
              <code className={styles.code}>{'ports={{ workflows }}'}</code>, and names which
              workflow to open as <code className={styles.code}>workflowId</code>, both on{' '}
              <code className={styles.code}>{'<HatuaProvider>'}</code>.
            </p>
          ) : null}

          {/* One live region, mounted for the life of the panel. Rendered
              conditionally it announces nothing much of the time: a live region
              generally has to EXIST before its content changes for the change
              to be announced. */}
          <p className={cx(styles.note, !liveMessage && styles.silent)} role="status">
            {liveMessage}
          </p>

          {state.status === 'failed' ? (
            <div className={styles.failure} role="alert">
              <p className={styles.failureText}>
                The workflow could not be opened. {state.error.message}
              </p>
              <Button size="sm" onClick={() => store?.reopen()}>
                Try again
              </Button>
            </div>
          ) : null}

          {/*
            Parsed, held, and not a Workflow Definition — the state ADR-0001
            forces this region to have. `toJSON()` throws here, so the tree
            cannot be drawn; the document is still open and still editable, and
            Text Mode is where it gets fixed. Saying so is the difference
            between a panel that looks broken and one that explains itself.
          */}
          {workflow && !definition ? (
            <p className={styles.note}>
              This document is not a valid Workflow Definition yet, so there is no tree to draw.{' '}
              {workflow.invalid?.message} Your text is intact — nothing has been discarded.
            </p>
          ) : null}

          {workflow && listed ? (
            // No special case for the empty workflow: a <Sequence> of nothing
            // renders exactly one insert point, and that insert point already
            // knows how to be an empty state.
            <Sequence
              steps={listed?.steps ?? []}
              scope={boardScopeName(listed)}
              // Every insert point below is derived from this one, so naming the
              // Board once here is what makes an edit on a Block's Board the
              // same command as an edit on the root's.
              at={{ board: listed?.id ?? null, index: 0 }}
              selection={selection}
              problems={problems}
              troubled={troubled}
              collapsed={foldedHere}
              dragging={dragging}
              onSelect={select}
              onToggle={toggle}
              onRemove={remove}
              onInsert={onInsert}
              onDropStep={move}
              onDragStart={setDragging}
              onDragEnd={() => setDragging(null)}
              onNudge={nudge}
            />
          ) : null}
        </div>
      </section>
    </>
  )
}

interface SequenceProps {
  steps: readonly Step[]
  /**
   * What this list belongs to — "the workflow", a Branch's label, a loop's
   * name. Only the first insert point needs it: every other one names the Step
   * it follows, which is both shorter and unambiguous.
   */
  scope: string
  /** The insert point at index 0 of this list; every other one is derived from it. */
  at: Omit<InsertPoint, 'index'> & { index: number }
  selection: Segment | undefined
  /** Diagnostics per `stepKey`; a Step with none is absent. */
  problems: ReadonlyMap<string, Diagnostic[]>
  /** The Blocks that will not run, so a call into one can say so. */
  troubled: ReadonlySet<string>
  /** The ids collapsed on THIS Board. A Board is already `at.board`. */
  collapsed: ReadonlySet<string>
  dragging: string | null
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onRemove: (id: string) => void
  onInsert?: (at: InsertPoint) => void
  onDropStep: (id: string, to: InsertPoint) => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onNudge: (event: KeyboardEvent<HTMLLIElement>, step: Step, at: InsertPoint, count: number) => void
}

/**
 * One list of sibling Steps, with a gap before the first and after every one.
 *
 * Nested `<ul>`s rather than one flat list with a computed indent. The design
 * specifies `depth × 14px`, which reads as a flat DOM, but the visual result is
 * identical either way and the nesting is the part a screen reader can use: a
 * flat list says "eleven items" where the tree has three at the top and eight
 * inside branches, and there is no way to say otherwise outside `role="tree"`.
 */
function Sequence({ steps, scope, at, ...handlers }: SequenceProps) {
  const { selection, problems, troubled, collapsed, dragging, onInsert, onDropStep } = handlers

  return (
    <ul className={styles.sequence}>
      <Gap
        at={{ ...at, index: 0 }}
        label={
          steps.length === 0
            ? `Add the first Step to ${scope}`
            : `Insert a Step at the start of ${scope}`
        }
        // An empty list has exactly one insert point, and it is the only thing
        // in it — so it stops being a 16px sliver that appears on hover and
        // becomes the branch's empty state.
        empty={steps.length === 0}
        onInsert={onInsert}
        dragging={dragging}
        onDrop={onDropStep}
      />
      {steps.map((step, index) => {
        const here: InsertPoint = { ...at, index }
        const open = !collapsed.has(step.id)

        return (
          <Fragment key={step.id}>
            <li
              className={styles.item}
              draggable
              onDragStart={(event) => {
                // A container's <li> WRAPS its children's, so this fires again
                // at every enclosing level and the last one to run wins:
                // dragging a Step inside a loop left `dragging` holding the
                // LOOP's id, and dropping it into that loop's own list was then
                // refused as a move into itself. Nothing happened, and nothing
                // said why. Root-level rows have no ancestor <li>, which is
                // exactly why only nested drags were broken.
                event.stopPropagation()
                event.dataTransfer.effectAllowed = 'move'
                // Set for the platform's sake — a drag with no data is a no-op
                // in some browsers — while the id we actually read is held in
                // React state, because `dataTransfer` is unreadable during
                // dragover, which is where the drop targets light up.
                event.dataTransfer.setData('text/plain', step.id)
                handlers.onDragStart(step.id)
              }}
              onDragEnd={(event) => {
                event.stopPropagation()
                handlers.onDragEnd()
              }}
              onKeyDown={(event) => handlers.onNudge(event, step, here, steps.length)}
            >
              <Row
                step={step}
                problems={problems.get(stepKey({ board: at.board ?? null, id: step.id }))}
                callsBrokenBlock={callsTrouble(step, troubled)}
                selected={segmentHolds(selection, { board: at.board ?? null, id: step.id })}
                expanded={open}
                dragging={dragging === step.id}
                onSelect={handlers.onSelect}
                onToggle={handlers.onToggle}
                onRemove={handlers.onRemove}
              />

              {open ? <Regions step={step} at={at} handlers={handlers} /> : null}
            </li>

            <Gap
              at={{ ...at, index: index + 1 }}
              label={`Insert a Step after ${nameOf(step)}`}
              onInsert={onInsert}
              dragging={dragging}
              onDrop={onDropStep}
            />
          </Fragment>
        )
      })}
    </ul>
  )
}

/**
 * Every region one container owns, in document order.
 *
 * Enumerated with `regionsOf` rather than read off `branches:`, `steps:` and
 * `handler:` here. That is the single answer to "what does this Step nest", and
 * a surface that answers it for itself is one that can forget a region — a
 * region no rule draws is a Step a diagnostic names and nobody can select or
 * delete. `@hatua/layout` asks the same generator, so the map and this list
 * cannot disagree about which regions there are; `Region.keyword` is the word
 * over each, so they cannot disagree about what they are called either.
 *
 * The Branches are grouped into one list and everything else is stacked below
 * it. `regionsOf` yields a Step's Branches first, so grouping them costs no
 * second ordering rule.
 *
 * The canvas arranges the same regions differently — every one of them is a
 * column in one row (ADR-0015) — and that is not a disagreement to fix. A list
 * has one dimension and no width problem, and the two surfaces have to agree
 * about *which* regions exist and what each is called, which `regionsOf` and
 * `Region.keyword` guarantee. How far apart they are drawn is each surface's
 * own question.
 *
 * The verb is never consulted about whether a region exists. A `handler:` on a
 * `core.fork` is meaningless and no runner reads it, but `walkSteps` yields the
 * Steps inside it and every generic rule reports against them by name — so
 * hiding it does not make it absent from the document, it makes it unreachable.
 */
function Regions({
  step,
  at,
  handlers,
}: {
  step: Step
  at: SequenceProps['at']
  handlers: Omit<SequenceProps, 'steps' | 'scope' | 'at'>
}) {
  const regions = [...regionsOf(step)]
  const branches = regions.filter((region) => region.kind === 'branch')
  const stacked = regions.filter((region) => region.kind !== 'branch')
  const board = at.board ?? null

  return (
    <>
      {branches.length > 0 ? (
        <ul className={styles.branches}>
          {branches.map((region, branchIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a Branch has no id in the schema and its ORDER is its meaning — "first match wins, and the last branch may be unconditional". The index is the identity here, not a stand-in for one.
            <li key={`${step.id}:${branchIndex}`} className={styles.branch}>
              <BranchHeader branch={region.branch} keyword={region.keyword} />
              <Sequence
                {...handlers}
                steps={region.steps}
                scope={`the “${region.branch?.label}” branch`}
                at={{ board, parentId: step.id, branchIndex, index: 0 }}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {stacked.map((region) => (
        <div key={region.kind} className={styles.loop}>
          <span className={styles.keyword}>{region.keyword}</span>
          <Sequence
            {...handlers}
            steps={region.steps}
            scope={`the “${nameOf(step)}” ${regionNoun(region)}`}
            at={{
              board,
              parentId: step.id,
              region: region.kind === 'handler' ? 'handler' : undefined,
              index: 0,
            }}
          />
        </div>
      ))}
    </>
  )
}

/**
 * The 16px row between every two Steps: where a Step is dropped, and where a
 * new one is asked for.
 *
 * It is a real button rather than a hover affordance, because it is the only
 * unambiguous way to say "here and not there" in a dense list — and because a
 * drop target nobody can reach from the keyboard needs a sibling that can.
 */
function Gap({
  at,
  label,
  empty = false,
  onInsert,
  dragging,
  onDrop,
}: {
  at: InsertPoint
  /**
   * Spelled out rather than numbered. "Insert a Step at position 3" is three
   * different places in a tree with two Branches, and a screen reader reading
   * the panel top to bottom would hear the same sentence at each of them.
   */
  label: string
  /**
   * This gap is the only one in its list, because the list is empty — so it
   * draws as the design's dashed box rather than as a sliver between two rows.
   *
   * One element, not two: an empty list's insert point IS its empty state. A
   * hover-revealed gap plus a static box would be two affordances for one
   * place, of which only one works.
   *
   * It says Step rather than Component deliberately. The Components cards are
   * not draggable and sit behind another tab, so no Component can be dropped
   * here; what can is an existing Step from the tree.
   */
  empty?: boolean
  onInsert?: (at: InsertPoint) => void
  dragging: string | null
  onDrop: (id: string, to: InsertPoint) => void
}) {
  const [over, setOver] = useState(false)
  const active = dragging !== null

  return (
    <li
      className={cx(
        empty ? styles.emptyGap : styles.gap,
        over && active && (empty ? styles.emptyOver : styles.gapOver),
      )}
      onDragOver={(event) => {
        if (!active) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false)
        if (!dragging) return
        event.preventDefault()
        onDrop(dragging, at)
      }}
    >
      {empty ? null : <span className={styles.gapLine} />}
      {onInsert ? (
        <button
          type="button"
          className={empty ? styles.emptyInsert : styles.insert}
          aria-label={label}
          onClick={() => onInsert(at)}
        >
          {empty ? '+ Add a Step' : '+'}
        </button>
      ) : (
        // No handler, so nothing here can add a Step — but the drop target is
        // still live, because moving an existing Step into an empty Branch
        // needs no catalogue at all.
        empty && <span className={styles.emptyNote}>Drop a Step here</span>
      )}
    </li>
  )
}

function Row({
  step,
  problems,
  callsBrokenBlock,
  selected,
  expanded,
  dragging,
  onSelect,
  onToggle,
  onRemove,
}: {
  step: Step
  problems?: Diagnostic[]
  /** Whether the Block this row calls will not run — a boolean, never a Diagnostic. */
  callsBrokenBlock?: boolean
  selected: boolean
  expanded: boolean
  dragging: boolean
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onRemove: (id: string) => void
}) {
  const container = Boolean(step.branches?.length || step.steps || step.handler)

  /*
   * Everything wrong with this row, whether it is wrong here or behind the
   * doorway. Hovering anywhere on the row explains the marker, rather than
   * asking anyone to find a 3px edge with a pointer.
   */
  const reasons = [
    ...(problems ?? []).map((problem) => problem.message),
    ...(callsBrokenBlock ? [CALLS_BROKEN_BLOCK] : []),
  ]
  const summary = reasons.length > 0 ? reasons.join(' ') : undefined

  return (
    <div
      className={cx(
        styles.row,
        selected && styles.selected,
        dragging && styles.lifted,
        summary && styles.invalid,
      )}
      title={summary}
    >
      {/*
        The drag grip. Decoration, not a control: the whole row is draggable, so
        this says so without being a second thing to tab through.

        Dots rather than a bar, which is the design's `more-horizontal` rotated
        90°. A solid stripe down the edge of a row reads as status — a severity
        or a state — and this row already carries a real status marker. The dots
        mean "grab me" and nothing else.
      */}
      <svg
        className={styles.grip}
        viewBox="0 0 4 16"
        width="4"
        height="16"
        focusable="false"
        aria-hidden="true"
      >
        <circle cx="2" cy="4" r="1" />
        <circle cx="2" cy="8" r="1" />
        <circle cx="2" cy="12" r="1" />
      </svg>

      <button
        type="button"
        className={styles.identity}
        aria-current={selected || undefined}
        onClick={() => onSelect(step.id)}
      >
        <span className={styles.name}>{nameOf(step)}</span>
        <span className={styles.meta}>{summaryOf(step)}</span>
      </button>

      {reasons.length > 0 ? <Problems reasons={reasons} name={nameOf(step)} /> : null}
      {container ? (
        <button
          type="button"
          className={styles.chevron}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${nameOf(step)}`}
          onClick={() => onToggle(step.id)}
        >
          {expanded ? '⌄' : '›'}
        </button>
      ) : null}

      <button
        type="button"
        className={styles.remove}
        aria-label={`Remove ${nameOf(step)}`}
        onClick={() => onRemove(step.id)}
      >
        {/*
          A bin, not a cross. `×` is the glyph for dismissing a thing — closing
          a panel, clearing a filter — and this deletes a Step out of the
          document. The two are worth telling apart before the click, not after.

          Drawn rather than set in type: the only bin in a text font is an emoji,
          which renders at a size and colour the row does not control.
        */}
        <svg
          className={styles.icon}
          viewBox="0 0 16 16"
          width="14"
          height="14"
          focusable="false"
          aria-hidden="true"
        >
          <path d="M3 4.5h10M6.5 4.5V3.2a.7.7 0 0 1 .7-.7h1.6a.7.7 0 0 1 .7.7v1.3" />
          <path d="M4.4 4.5l.6 8a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.6-8" />
          <path d="M6.8 7v3.6M9.2 7v3.6" />
        </svg>
      </button>
    </div>
  )
}

/**
 * The reasons, in words, for everyone the coloured edge does not reach.
 *
 * The marker itself is a stripe down the row's inline end: the rows all share
 * that edge however deeply they are nested, so the marks line up into a column
 * that can be scanned in one pass, which a dot sitting inside the row never
 * does.
 *
 * A stripe is colour alone, though — invisible to a screen reader and to anyone
 * who cannot distinguish the hue — so this carries the count and the reasons as
 * text. It is not rendered visually; the row's `title` says the same thing to a
 * pointer.
 *
 * `role="status"` rather than `alert`: an unfilled field is the normal state of
 * a Step someone just added, and interrupting a screen reader for it every time
 * would make the builder unusable. ADR-0009 draws the same line — this blocks
 * Publish, never editing.
 */
function Problems({ reasons, name }: { reasons: readonly string[]; name: string }) {
  const summary = reasons.join(' ')
  const label = `${name}: ${reasons.length === 1 ? '1 problem' : `${reasons.length} problems`}. ${summary}`

  return (
    <span className={styles.offscreen} role="status">
      {label}
    </span>
  )
}

function BranchHeader({ branch, keyword }: { branch?: Branch; keyword: string }) {
  return (
    <p className={styles.branchHeader}>
      <span className={styles.keyword}>{keyword}</span>
      <span className={styles.branchLabel}>{branch?.label}</span>
      {branch?.when ? <code className={styles.when}>{branch.when}</code> : null}
    </p>
  )
}

/**
 * The word inside the sentence a screen reader hears on an insert point.
 *
 * The chip's word and this are two different jobs: `attempt` is what goes over
 * the region, and "the “Publish” attempt" is what an insert point inside it is
 * called. Derived from the region rather than from the verb a second time.
 */
const regionNoun = (region: Region): string =>
  region.kind === 'handler' ? 'handler' : region.keyword

/**
 * What the first insert point on a Board is adding to.
 *
 * "the workflow" at the root and the Block's name inside one, so the sentence a
 * screen reader hears says which Board it is standing on — which is the whole
 * of what changes when the canvas opens a call.
 */
const boardScopeName = (board: Board | undefined): string =>
  board?.id == null ? 'the workflow' : `the “${board.block?.name || board.id}” block`

/** Whether a row's Step calls a Block that will not run. */
const callsTrouble = (step: Step, troubled: ReadonlySet<string>): boolean => {
  const called = blockIdOf(step.use)
  return called !== null && troubled.has(called)
}

/**
 * What a call row says when the Block behind it will not run.
 *
 * The same sentence `NodeCard` carries, because it is the same fact about the
 * same Step drawn by another region — and two spellings of one sentence is two
 * things to keep in step.
 */
const CALLS_BROKEN_BLOCK = 'The block this opens has problems inside it.'
