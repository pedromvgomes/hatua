import { type BoardId, boardKey, type Segment, type StepRef } from '@hatua/model'
import { addStep, type InsertPoint, rootStepCount } from '@hatua/services'
import { type ComponentPropsWithRef, useState } from 'react'
import { Components } from '../layouts/Components'
import { Data } from '../layouts/Data'
import { FlowMap } from '../layouts/FlowMap'
import { Inspector } from '../layouts/Inspector'
import { TabbedPanel } from '../layouts/TabbedPanel'
import { TopBar } from '../layouts/TopBar'
import { boardTabLabel, Workflow } from '../layouts/Workflow'
import { cx } from '../primitives/classNames'
import { useEditingStore } from '../theme/HatuaProvider'
import styles from './Build.module.css'
import css from './Build.module.css?inline'

export type BuildProps = ComponentPropsWithRef<'div'>

/**
 * The designer screen: the toolbar across the top, then three columns — the
 * tabbed side panel, the canvas, and the step editor — and a fourth the editor
 * expands leftward into, which has no width until it is asked for.
 *
 * **The canvas is how a workflow is built.** It has a column of its own and is
 * always on screen: every card, every `+` between two cards, and the doorway
 * into a Block's Board are there. The side panel is **Workflow** and
 * **Components** — everything scoped to the workflow rather than to a Step, and
 * the catalogue a Step is chosen from.
 *
 * `<StepList>` is not in that set. It is a real region and a Host that wants a
 * dense, keyboard-reorderable list of the tree mounts it — `apps/playground/src/host.tsx`
 * does exactly that — but it is not what Hatua's own screen leads with, and a
 * tab labelled *Flow* beside a region called `FlowMap` is the name collision
 * this repo has already paid for once.
 *
 * <Build> is the convenience; the regions it composes are the seam. There are
 * two ways to embed and only two — write <Hatua>, which mounts this, or mount
 * the regions yourself and arrange them however you like. Deliberately no slot
 * props: a `topBar={…}` escape hatch would be a third mechanism that does what
 * importing <TopBar> already does, and every region added afterwards would owe
 * it a prop.
 *
 * The wrappers below carry the grid placement rather than the regions carrying
 * it themselves. A region that positioned itself would only be movable into a
 * container shaped like this one, which is the opposite of the claim.
 *
 * `className` and the rest of the props land on the OUTER element, which is the
 * horizontal scroller rather than the grid. That is the usual meaning of
 * spreading props onto a root, and it is worth stating because the root moved:
 * a `style={{ gridTemplateColumns: … }}` handed to <Build> now styles the
 * scroller and changes no column. Nothing here will tell you — BuildProps is a
 * <div>'s props either way. It is also not a regression to fix: <Build> takes no
 * slot props for the same reason it should take no layout overrides, and a Host
 * that wants different columns imports the regions and writes its own grid,
 * which is strictly more capable. See views/README.
 */
export function Build({ className, ...rest }: BuildProps) {
  const store = useEditingStore()

  /*
   * The one thing this view does beyond placing regions: it introduces the two
   * halves of "add a Step" to each other.
   *
   * Neither region can do it alone, and neither should. The canvas knows where
   * a Step would go and nothing about the catalogue; <Components> knows the
   * Components and nothing about the tree. Both emit rather than reach — props
   * out, the rule layouts/README states — so something has to be above both,
   * and the composition root is where that belongs.
   *
   * The pending point is chrome, held here and never in the document, the same
   * line drawn around which tab is open. Appending is the fallback: a Component
   * picked with no insert point pending goes at the end of the Board on screen,
   * which is what "add this" means when nowhere was named.
   *
   * Selection, collapse and which Board is open are held here for a different
   * reason: they are one answer shared by two surfaces. The canvas and a
   * <StepList> a Host mounts beside it must not highlight two different Steps
   * or show two different Boards, and the step editor can only be handed one.
   */
  const [tab, setTab] = useState('components')
  const [pending, setPending] = useState<InsertPoint | null>(null)
  /*
   * What is selected on each Board, keyed by Board.
   *
   * One per Board rather than one shared: a `Segment` names the Board it is on,
   * so a selection is meaningless on any other, and going through a doorway and
   * coming back finds the Steps that were left selected rather than nothing
   * (ADR-0017).
   */
  const [selectedOn, setSelectedOn] = useState<Readonly<Record<string, Segment>>>({})
  const [collapsed, setCollapsed] = useState<readonly StepRef[]>([])
  /*
   * Which Board is on screen, and the reason it is up here rather than inside
   * either region.
   *
   * A call is a doorway into another Board (ADR-0013) and the canvas is where
   * that door is, so <FlowMap> is what changes it — but the Flow tab lists
   * `definition.steps` for one Board too, and two surfaces showing two
   * different Boards at once is the "the map and the list disagree" defect this
   * repo has already paid for twice. So the canvas reports, this holds, and the
   * list follows.
   *
   * It stays chrome and never reaches the document, the same line ADR-0001
   * draws around node positions: a Board a session happened to be looking at is
   * a diff in the Host's repository for nothing.
   */
  const [board, setBoard] = useState<BoardId>(null)
  /*
   * Whether the Data panel stands open, and which leaf it is pointing at.
   *
   * Both are chrome and both are shared by two regions, which is the same
   * reason selection is up here: the panel reports a leaf and the step editor
   * marks the fields reading it, and neither can hold an answer the other has
   * to see.
   */
  const [data, setData] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  const selected = selectedOn[boardKey(board)]

  /**
   * Read at click time, not at render time. <Build> deliberately does not
   * subscribe to the editing store — it places regions, and a re-render of the
   * whole screen on every keystroke would be the opposite of why the store is
   * external — so a length captured during render would be whatever it was when
   * this last happened to render.
   */
  const appendPoint = (): InsertPoint => {
    const state = store?.getSnapshot()
    // Counted off the document rather than off `definition`, which is null
    // while the document does not project — and `?.steps.length ?? 0` cannot
    // tell that apart from an empty workflow, so a half-written file would
    // append at index 0, which is the front.
    //
    // On the Board that is on screen, not on the root: "add this" means "add it
    // where I am looking", and appending to the root while a Block's Board is
    // open puts the Step somewhere the user cannot see it land.
    return {
      board,
      index: state?.status === 'ready' ? rootStepCount(state.workflow.document, board) : 0,
    }
  }

  return (
    <>
      <style href="hatua-build" precedence="hatua">
        {css}
      </style>
      <div className={cx(styles.scroller, className)} {...rest}>
        <div className={styles.build}>
          <div className={styles.bar}>
            <TopBar
              /*
               * Where a blocking problem actually is.
               *
               * The bar knows what is wrong and nothing about Boards, tabs or
               * selection; this view holds all three already, for the canvas and
               * the list. So the bar emits the diagnostic and the translation
               * lives here — the same shape as `onInsert` and `onSelect`, and
               * the same reason: a region that reached for chrome would be a
               * second answer to a question this view already answers.
               *
               * A diagnostic names a Board and, usually, a Step. What it never
               * names is a tab, so the Workflow tab is opened only for a Trigger
               * — a Trigger is not a Step and is edited there rather than in the
               * step editor.
               */
              onRevealDiagnostic={(diagnostic) => {
                const target: BoardId = diagnostic.blockId ?? null
                setBoard(target)
                // An insert point names a list on the Board it was made on, so
                // it does not survive going to another one — the same rule the
                // canvas's doorway and the tab strip both follow, and for the
                // same reason: the next Component picked would land somewhere
                // nobody chose, on a Board nobody is looking at.
                setPending(null)
                /*
                 * And unfold the Board, or the reveal can arrive at something
                 * nothing draws.
                 *
                 * `collapsed` is handed straight to `layout`, and a folded
                 * container hides its descendants outright — so a bad `when:`
                 * inside a collapsed Fork would select a Step that is not on
                 * screen, and the row meant to be the way to the problem would
                 * do nothing observable.
                 *
                 * The whole Board rather than the ancestors of the one Step:
                 * nothing exported names a Step's ancestors, and inventing that
                 * walk here would be a second answer to a question
                 * `@hatua/model` owns. Unfolding more than strictly necessary is
                 * visible and undoable; arriving at a blank canvas is neither.
                 */
                setCollapsed((held) =>
                  held.filter((ref) => boardKey(ref.board) !== boardKey(target)),
                )

                if (diagnostic.triggerId !== undefined) {
                  setTab('workflow')
                  return
                }

                const { stepId } = diagnostic
                if (stepId === undefined) return
                setSelectedOn((held) => ({
                  ...held,
                  [boardKey(target)]: { board: target, steps: [stepId] },
                }))
              }}
            />
          </div>
          <div className={styles.side}>
            <TabbedPanel
              // The tab labels and the region names are two vocabularies, and
              // the Flow tab is <StepList> — the tree as a list. The map beside
              // it is <FlowMap>, which is not a tab and never was. See
              // layouts/README.
              tabs={[
                {
                  // The id is stable and the label is not. The label names the
                  // KIND of thing the tab holds — the canvas's strip already
                  // says which Block — and an id that moved with it would
                  // reopen the Components tab every time a doorway was walked
                  // through.
                  id: 'workflow',
                  label: boardTabLabel(board),
                  content: (
                    <Workflow
                      board={board}
                      onBoardRename={(from, to) => {
                        // A renamed Block is a Block nothing resolves under its
                        // old id, which every reader here — the canvas included
                        // — reads as a deleted one. Following the rename keeps
                        // the Board on screen and its selection with it.
                        setBoard((was) => (was === from ? to : was))
                        setSelectedOn((was) => {
                          const held = was[boardKey(from)]
                          if (!held) return was
                          const { [boardKey(from)]: _gone, ...rest } = was
                          return { ...rest, [boardKey(to)]: { ...held, board: to } }
                        })
                      }}
                    />
                  ),
                },
                {
                  id: 'components',
                  label: 'Components',
                  content: (
                    <Components
                      pending={pending !== null}
                      onSelect={(component) => {
                        store?.apply(addStep(component, pending ?? appendPoint()))
                        setPending(null)
                      }}
                      onBoardOpen={(block) => {
                        // A Block's tab opens when the Block is declared
                        // (ADR-0017), and there is nothing on its Board yet —
                        // so the canvas going there is what says it exists.
                        setBoard(block)
                        setPending(null)
                      }}
                    />
                  ),
                },
              ]}
              tabId={tab}
              onTabChange={(next) => {
                // Navigating away by hand abandons the insertion point. Kept,
                // it would silently govern where the NEXT Component lands
                // instead of appending — or name a Step removed in the
                // meantime, which every command refuses, so the click would do
                // nothing at all and say nothing about why.
                //
                // A click on the tab ALREADY open is not navigating away.
                // <TabbedPanel> reports every click, including that one, and
                // clicking "Components" while looking at it is what anyone
                // does to focus it — losing the pending point there
                // would be the same silent misplacement, arrived at by
                // touching nothing.
                if (next !== tab) setPending(null)
                setTab(next)
              }}
            />
          </div>
          <div className={styles.map}>
            <FlowMap
              onInsert={(at) => {
                // The design: "Clicking it opens the Components tab with that
                // insertion point pending."
                setPending(at)
                setTab('components')
              }}
              onDropComponent={(component, at) => {
                // The same introduction as the click, arriving in one gesture
                // rather than three: the canvas already knows where and the drag
                // carried what, so the drop answers where by itself.
                store?.apply(addStep(component, at))
                // Including a question somebody had already asked. A `+` pressed
                // before the drag left an insert point outstanding, and the drop
                // is the answer to it — kept, the panel goes on saying "pick a
                // component" after one was picked, and the next card clicked
                // lands at an index the drop has already shifted.
                setPending(null)
              }}
              boardId={board}
              onBoardChange={(next) => {
                setBoard(next)
                // The pending insert point does not survive the doorway: kept,
                // it names a list on another Board and the next Component would
                // land somewhere nobody chose. Selection does survive, held per
                // Board — the step editor is handed the one belonging to the
                // Board on screen, and never a Step nobody is looking at.
                setPending(null)
              }}
              // `null` and not `undefined`: this view holds the selection, so
              // it is saying "nothing is selected on this Board" rather than
              // "nobody has an opinion" — and the two are different props.
              selected={selected ?? null}
              onSelect={(segment) =>
                setSelectedOn((was) => {
                  // Cleared, and dropped rather than stored as an empty entry:
                  // `selected` below reads a missing key as `null`, which is
                  // the one spelling for "nothing is selected on this Board".
                  if (!segment) {
                    const { [boardKey(board)]: _cleared, ...rest } = was
                    return rest
                  }
                  return { ...was, [boardKey(board)]: segment }
                })
              }
              collapsed={collapsed}
              onCollapseChange={setCollapsed}
            />
          </div>
          {/*
            The Data panel is the step editor's left extension, not a tab. Its
            column exists only while it is open, so the canvas gets the room
            back when it is not — and both regions are placed here rather than
            one mounting the other, which is what keeps either mountable alone.
          */}
          {data ? (
            <div className={styles.data}>
              <Data selected={selected ?? null} board={board} onHighlight={setHighlight} />
            </div>
          ) : null}
          <div className={styles.aside}>
            <Inspector
              selected={selected ?? null}
              highlight={highlight}
              expanded={data}
              onExpandedChange={(open) => {
                setData(open)
                // A highlight outlives the panel that produced it otherwise,
                // and marks fields for a leaf nobody can see any more.
                if (!open) setHighlight(null)
              }}
            />
          </div>
        </div>
      </div>
    </>
  )
}
