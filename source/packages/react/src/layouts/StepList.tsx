import type { Diagnostic } from '@hatua/model'
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
   * Fired when a Step row is activated. Optional, and its absence is meaningful
   * in the same way `Library`'s is: with no handler there is still selection to
   * show, but nothing outside this region hears about it.
   */
  onSelect?: (stepId: string) => void
  /**
   * Fired when an insert point is chosen. Optional — this region knows where a
   * Step would go and nothing at all about which Component to put there, so it
   * hands the point out and the Library fills it in.
   */
  onInsert?: (at: InsertPoint) => void
  /** Which Step starts selected. Uncontrolled, like TabbedPanel's defaultTabId. */
  defaultSelectedId?: string
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
const UNCHECKED: ValidationState = { byStep: NO_PROBLEMS, all: [], ready: false }
const readUnchecked = (): ValidationState => UNCHECKED
const readUnconfigured = (): ListState => UNCONFIGURED
const readOpening = (): ListState => OPENING

export function StepList({
  onSelect,
  onInsert,
  defaultSelectedId,
  className,
  ...rest
}: StepListProps) {
  const store = useEditingStore()
  const validation = useValidationStore()
  const [selectedId, setSelectedId] = useState<string | undefined>(defaultSelectedId)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [dragging, setDragging] = useState<string | null>(null)

  // The one side effect: tell the store somebody is reading. It is idempotent,
  // so every region that mounts may call it and only the first opens the Draft.
  useEffect(() => {
    // `load()` opens the Draft AND asks for the catalogue, because validation
    // needs both. A Host mounting this region and no Library would otherwise
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

  const select = (id: string) => {
    setSelectedId(id)
    onSelect?.(id)
  }

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const remove = (id: string) => {
    store?.apply(removeStep(id))
    if (selectedId === id) setSelectedId(undefined)
  }

  const move = (id: string, to: InsertPoint) => {
    store?.apply(moveStep(id, to))
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
    store?.apply(moveStep(step.id, { ...at, index: delta > 0 ? target + 1 : target }))
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

          {workflow && definition ? (
            // No special case for the empty workflow: a <Sequence> of nothing
            // renders exactly one insert point, and that insert point already
            // knows how to be an empty state.
            <Sequence
              steps={definition.steps}
              scope="the workflow"
              at={{ index: 0 }}
              selectedId={selectedId}
              problems={problems}
              collapsed={collapsed}
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
  selectedId: string | undefined
  /** Diagnostics per Step id; a Step with none is absent. */
  problems: ReadonlyMap<string, Diagnostic[]>
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
  const { selectedId, problems, collapsed, dragging, onInsert, onDropStep } = handlers

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
                problems={problems.get(step.id)}
                selected={selectedId === step.id}
                expanded={open}
                dragging={dragging === step.id}
                onSelect={handlers.onSelect}
                onToggle={handlers.onToggle}
                onRemove={handlers.onRemove}
              />

              {open && step.branches?.length ? (
                <ul className={styles.branches}>
                  {step.branches.map((branch, branchIndex) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a Branch has no id in the schema and its ORDER is its meaning — "first match wins, and the last branch may be unconditional". The index is the identity here, not a stand-in for one.
                    <li key={`${step.id}:${branchIndex}`} className={styles.branch}>
                      <BranchHeader
                        branch={branch}
                        keyword={keywordFor(step.branches ?? [], branchIndex)}
                      />
                      <Sequence
                        {...handlers}
                        steps={branch.steps}
                        scope={`the “${branch.label}” branch`}
                        at={{ parentId: step.id, branchIndex, index: 0 }}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}

              {open && step.steps ? (
                <div className={styles.loop}>
                  <span className={styles.keyword}>loop</span>
                  <Sequence
                    {...handlers}
                    steps={step.steps}
                    scope={`the “${nameOf(step)}” loop`}
                    at={{ parentId: step.id, index: 0 }}
                  />
                </div>
              ) : null}
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
   * It says Step rather than Component deliberately. The Library's cards are
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
  selected,
  expanded,
  dragging,
  onSelect,
  onToggle,
  onRemove,
}: {
  step: Step
  problems?: Diagnostic[]
  selected: boolean
  expanded: boolean
  dragging: boolean
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onRemove: (id: string) => void
}) {
  const container = Boolean(step.branches?.length || step.steps)

  return (
    <div className={cx(styles.row, selected && styles.selected, dragging && styles.lifted)}>
      {/* Decoration: the whole row is draggable, and the grip says so without
          being a second control to tab through. */}
      <span className={styles.grip} aria-hidden="true" />

      <button
        type="button"
        className={styles.identity}
        aria-current={selected || undefined}
        onClick={() => onSelect(step.id)}
      >
        <span className={styles.name}>{nameOf(step)}</span>
        <span className={styles.meta}>{metaFor(step)}</span>
      </button>

      {problems?.length ? <Problems problems={problems} name={nameOf(step)} /> : null}

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
        ×
      </button>
    </div>
  )
}

/**
 * The design's 7px error dot, and a sentence for everyone it does not reach.
 *
 * Colour alone is not an indicator: it is invisible to a screen reader and to
 * anyone who cannot distinguish the hue, and this dot is 7px — the hardest case
 * there is. So the marker carries the count and the reasons as text, which also
 * makes it useful to a mouse user hovering it rather than a decoration they
 * have to guess at.
 *
 * `role="status"` rather than `alert`: an unfilled field is the normal state of
 * a Step someone just added, and interrupting a screen reader for it every time
 * would make the builder unusable. ADR-0009 draws the same line — this blocks
 * Publish, never editing.
 */
function Problems({ problems, name }: { problems: Diagnostic[]; name: string }) {
  const summary = problems.map((problem) => problem.message).join(' ')
  const label = `${name}: ${problems.length === 1 ? '1 problem' : `${problems.length} problems`}. ${summary}`

  return (
    <span className={styles.problems} role="status" aria-label={label} title={summary}>
      <span className={styles.dot} aria-hidden="true" />
    </span>
  )
}

function BranchHeader({ branch, keyword }: { branch: Branch; keyword: string }) {
  return (
    <p className={styles.branchHeader}>
      <span className={styles.keyword}>{keyword}</span>
      <span className={styles.branchLabel}>{branch.label}</span>
      {branch.when ? <code className={styles.when}>{branch.when}</code> : null}
    </p>
  )
}

/** The display name, falling back to the id — which is what a Step always has. */
const nameOf = (step: Step) => step.name || step.id

/**
 * `if` / `else if` / `else` for a condition fork, `and` for a parallel one.
 *
 * Read from the branches rather than from a mode field, because the schema has
 * no mode field: "absent on the fallback branch of a condition fork — order
 * matters there, first match wins, and the last branch may be unconditional."
 * A fork where no branch carries `when` is the parallel one.
 */
function keywordFor(branches: readonly Branch[], index: number): string {
  if (!branches.some((branch) => branch.when)) return 'and'
  if (branches[index]?.when) return index === 0 ? 'if' : 'else if'
  return 'else'
}

/** `core.fork · 2 branches` — the verb, and what makes this Step structural. */
function metaFor(step: Step): string {
  const count = step.branches?.length
  if (count) return `${step.use} · ${count} ${count === 1 ? 'branch' : 'branches'}`

  const nested = step.steps?.length
  if (nested !== undefined) return `${step.use} · ${nested} ${nested === 1 ? 'step' : 'steps'}`

  return step.use
}
