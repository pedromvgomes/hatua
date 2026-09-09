import { type BoardId, boardKey, type RegionRef, type Segment, type StepRef } from '@hatua/model'
import { type ComponentPropsWithRef, useEffect, useState, useSyncExternalStore } from 'react'
import { FlowMap } from '../layouts/FlowMap'
import { RunList } from '../layouts/RunList'
import { RunStep } from '../layouts/RunStep'
import { TabbedPanel } from '../layouts/TabbedPanel'
import { TextMode } from '../layouts/TextMode'
import type { BarView } from '../layouts/TopBar'
import { TopBar } from '../layouts/TopBar'
import { boardTabLabel, Workflow } from '../layouts/Workflow'
import { cx } from '../primitives/classNames'
import { useEditingStore, useExecutionStore } from '../theme/HatuaProvider'
import { TextToggle } from '../units/TextToggle'
import styles from './Runs.module.css'
import css from './Runs.module.css?inline'

/**
 * The **Runs** view: the workflow's **Workflow Executions**, and one of them
 * drawn on the map against the version it references.
 *
 * ## It owns the Preview for as long as it is mounted
 *
 * A run is a **Preview** (ADR-0025): opening one loads the record, then puts the
 * version that record names on screen through the editing store, and every
 * region follows without being taught anything — the map draws that version, the
 * **Workflow** tab reads it, and `useReadOnly()` already says no to all of it.
 *
 * Mounting leaves any version chosen from the bar's list, and unmounting leaves
 * the run's. The two never coexist and neither leaks into the other view: a
 * run's version drawn under **Build** would carry no marks and would be
 * captioned as an ordinary preview of a version nobody picked.
 *
 * ## The map waits for a run
 *
 * A run is drawn against the version it references, so with no run there is no
 * version to draw against — and the **Draft** is not an answer to "which run am
 * I looking at". The column says what to do instead, and `<FlowMap>` mounts when
 * a run opens.
 */
export interface RunsProps extends ComponentPropsWithRef<'div'> {
  /** Which view is on screen, forwarded to the bar's segmented control. */
  view?: BarView
  onViewChange?: (view: BarView) => void
}

export function Runs({ className, view = 'runs', onViewChange, ...rest }: RunsProps) {
  const executions = useExecutionStore()
  const editing = useEditingStore()

  /*
   * Selection, the Board and the folds, held here for the reason `views/Build`
   * holds them: the map and the pane must not disagree about which Step is being
   * read, and a `Segment` names the Board it is on.
   */
  const [selectedOn, setSelectedOn] = useState<Readonly<Record<string, Segment>>>({})
  const [board, setBoard] = useState<BoardId>(null)
  const [collapsed, setCollapsed] = useState<readonly StepRef[]>([])
  const [foldedRegions, setFoldedRegions] = useState<readonly RegionRef[]>([])
  const [tab, setTab] = useState('runs')
  const selected = selectedOn[boardKey(board)]

  /*
   * Which of the two ways of drawing the version is on screen.
   *
   * The panels stay either way, and that is the difference from the designer:
   * there they are the map's tools and a second writer on the document, and here
   * nothing writes at all. `RunList` picks which run, `RunStep` describes it, and
   * the text shows the version it ran against — three readers on one subject,
   * which is what this view is for.
   *
   * No leave guard for the same reason: `useReadOnly()` is true throughout, so
   * the box never holds an edit to lose.
   */
  const [text, setText] = useState(false)

  const open = useSyncExternalStore(
    executions ? executions.subscribe : subscribeToNothing,
    executions ? () => executions.getSnapshot().open.status : readNone,
    readNone,
  )

  /*
   * What this view leaves behind, in both directions.
   *
   * On the way in, a version the reader chose from the bar's list: it belongs to
   * the designer, and leaving it standing would put a **Preview** cluster over a
   * **Runs** list. On the way out, the run's own: it belongs to this view, and a
   * run's version surviving into **Build** would be drawn with no marks on it.
   */
  useEffect(() => {
    editing?.exitPreview()
    return () => {
      executions?.close()
      editing?.exitPreview()
    }
  }, [editing, executions])

  const openRun = async (runId: string) => {
    if (!executions) return
    try {
      const execution = await executions.open(runId)
      /*
       * The record first, the screen second. A run whose record the Host cannot
       * serve must not move the screen at all — and `preview` refuses a version
       * it cannot parse for the same reason, so a failure at either step leaves
       * what is on screen exactly as it was, reported on the row that asked.
       */
      await editing?.preview(execution.workflow.version, { runId })
    } catch {
      // Both stores report their own failure into their own snapshot, and the
      // row and the pane draw them. There is nothing left for this to say.
    }
  }

  return (
    <>
      <style href="hatua-runs-view" precedence="hatua">
        {css}
      </style>
      <div className={cx(styles.scroller, className)} {...rest}>
        <div className={styles.runs}>
          <div className={styles.bar}>
            <TopBar view={view} onViewChange={onViewChange} />
          </div>
          <div className={styles.side}>
            <TabbedPanel
              tabs={[
                {
                  id: 'runs',
                  label: 'Runs',
                  content: <RunList onOpen={(id: string) => void openRun(id)} />,
                },
                {
                  id: 'workflow',
                  label: boardTabLabel(board),
                  /*
                   * The same region the designer mounts, and not a read-only
                   * variant of it. It asks `useReadOnly()` like every other
                   * region, and a run is a Preview — so it is already answering
                   * no, and a second way of saying so would be a second answer.
                   */
                  content: <Workflow board={board} />,
                },
              ]}
              tabId={tab}
              onTabChange={setTab}
            />
          </div>
          <div className={styles.map}>
            {open !== 'ready' ? (
              <p className={styles.empty}>Pick a run to see it on the map.</p>
            ) : text ? (
              <TextMode />
            ) : (
              <FlowMap
                boardId={board}
                onBoardChange={setBoard}
                selected={selected ?? null}
                onSelect={(segment) =>
                  setSelectedOn((was) => {
                    if (!segment) {
                      const { [boardKey(board)]: _cleared, ...rest } = was
                      return rest
                    }
                    return { ...was, [boardKey(board)]: segment }
                  })
                }
                collapsed={collapsed}
                collapsedRegions={foldedRegions}
                onCollapsedRegionsChange={setFoldedRegions}
                onCollapseChange={setCollapsed}
              />
            )}
            {/* Only once there is a version to draw: with no run open the column
                is saying what to do, and a control that swapped how nothing is
                drawn would be one more thing to press for no effect. */}
            {open === 'ready' ? (
              <TextToggle pressed={text} onToggle={() => setText((was) => !was)} />
            ) : null}
          </div>
          <div className={styles.aside}>
            <RunStep selected={selected ?? null} />
          </div>
        </div>
      </div>
    </>
  )
}

// Module-level and therefore stable: useSyncExternalStore re-subscribes whenever
// `subscribe` changes identity.
const subscribeToNothing = () => () => {}
const readNone = () => 'none' as const
