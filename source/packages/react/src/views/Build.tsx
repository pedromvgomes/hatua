import type { BoardId, StepRef } from '@hatua/model'
import { addStep, type InsertPoint, rootStepCount } from '@hatua/services'
import { type ComponentPropsWithRef, useState } from 'react'
import { Components } from '../layouts/Components'
import { FlowMap } from '../layouts/FlowMap'
import { Inspector } from '../layouts/Inspector'
import { StepList } from '../layouts/StepList'
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
 * The canvas has a column of its own, and did not until now. <Build> used to
 * hand the whole work area to <TabbedPanel> and mount <FlowMap> inside it as
 * the "Flow" tab, which left the screen with nowhere to put a canvas: it
 * appeared only while one of three tabs was open, and never beside the panel it
 * is edited from. The tab labelled "Flow" and the region called `FlowMap` had
 * become two different things wearing one name — the tab is the Step tree as a
 * list (<StepList>), the region is the map. Both are on screen at once now,
 * which is what the design has always shown.
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
   * Neither region can do it alone, and neither should. <StepList> knows where
   * a Step would go and nothing about the catalogue; <Components> knows the
   * Components and nothing about the tree. Both emit rather than reach — props
   * out, the rule layouts/README states — so something has to be above both,
   * and the composition root is where that belongs.
   *
   * The pending point is chrome, held here and never in the document, the same
   * line drawn around which tab is open. Appending is the fallback: a Component
   * picked with no insert point pending goes at the end of the workflow, which
   * is what "add this" means when nowhere was named.
   *
   * The Flow tab's selection and collapse are held here for a different reason,
   * and it is this view's doing rather than that region's. <TabbedPanel>
   * renders only the open tab, and adding a Step goes Flow → Components → Flow,
   * so <StepList> is unmounted and remounted every time — which threw away
   * which Step was selected and re-expanded every container the user had
   * collapsed, on the one action most likely to follow another. The state stays
   * chrome and never reaches the document; it just outlives the region now,
   * which is what the design means by the composition root holding selection.
   */
  const [tab, setTab] = useState('flow')
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
                {
                  // The Flow tab stays. It was here on the strength of a gap —
                  // nothing else could select a Step — and the canvas closes
                  // that gap without replacing this: a list has a gap between
                  // every two siblings and a map of cards has none, so this is
                  // where a Step is inserted, dragged and reordered. An empty
                  // Board settles it: a root node, no Steps, and no `+`
                  // anywhere on the canvas unless one is invented for it.
                  id: 'flow',
                  label: 'Flow',
                  content: (
                    <StepList
                      board={board}
                      selected={selected}
                      onSelect={setSelected}
                      collapsed={collapsed}
                      onCollapseChange={setCollapsed}
                      onInsert={(at) => {
                        setPending(at)
                        // The design: "Clicking it opens the Components tab
                        // with that insertion point pending."
                        setTab('components')
                      }}
                    />
                  ),
                },
                {
                  id: 'components',
                  label: 'Components',
                  content: (
                    <Components
                      onSelect={(manifest) => {
                        store?.apply(
                          addStep(
                            { use: manifest.use, name: manifest.name },
                            pending ?? appendPoint(),
                          ),
                        )
                        setPending(null)
                        setTab('flow')
                      }}
                    />
                  ),
                },
                { id: 'workflow', label: 'Workflow', content: <Workflow /> },
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
