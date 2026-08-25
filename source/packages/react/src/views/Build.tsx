import type { BoardId, StepRef } from '@hatua/model'
import { addStep, type InsertPoint, rootStepCount } from '@hatua/services'
import { type ComponentPropsWithRef, useState } from 'react'
import { Components } from '../layouts/Components'
import { FlowMap } from '../layouts/FlowMap'
import { Inspector } from '../layouts/Inspector'
import { TabbedPanel } from '../layouts/TabbedPanel'
import { TopBar } from '../layouts/TopBar'
import { Workflow } from '../layouts/Workflow'
import { cx } from '../primitives/classNames'
import { useEditingStore } from '../theme/HatuaProvider'
import styles from './Build.module.css'
import css from './Build.module.css?inline'

export type BuildProps = ComponentPropsWithRef<'div'>

/**
 * The designer screen: the toolbar across the top, then three columns — the
 * tabbed side panel, the canvas, and the step editor.
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
  const [selected, setSelected] = useState<StepRef | undefined>(undefined)
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
            <TopBar />
          </div>
          <div className={styles.side}>
            <TabbedPanel
              // The tab labels and the region names are two vocabularies, and
              // the Flow tab is <StepList> — the tree as a list. The map beside
              // it is <FlowMap>, which is not a tab and never was. See
              // layouts/README.
              tabs={[
                { id: 'workflow', label: 'Workflow', content: <Workflow /> },
                {
                  id: 'components',
                  label: 'Components',
                  content: (
                    <Components
                      pending={pending !== null}
                      onSelect={(manifest) => {
                        store?.apply(
                          addStep(
                            { use: manifest.use, name: manifest.name },
                            pending ?? appendPoint(),
                          ),
                        )
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
                // carried what, so nothing is left pending because nothing was
                // left unanswered.
                store?.apply(addStep(component, at))
              }}
              boardId={board}
              onBoardChange={(next) => {
                setBoard(next)
                // Selection does not survive the doorway. A `StepRef` names the
                // Board it is on, so a selection from the Board just left would
                // highlight nothing here and would still be what the step
                // editor was handed — a panel describing a Step on a screen
                // nobody is looking at.
                setSelected(undefined)
                // And the pending insert point goes with it, for the reason the
                // tab strip drops it: kept, it names a list on another Board and
                // the next Component would land somewhere nobody chose.
                setPending(null)
              }}
              selected={selected}
              onSelect={setSelected}
              collapsed={collapsed}
              onCollapseChange={setCollapsed}
            />
          </div>
          <div className={styles.aside}>
            <Inspector />
          </div>
        </div>
      </div>
    </>
  )
}
