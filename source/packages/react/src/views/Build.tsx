import type { ComponentPropsWithRef } from 'react'
import { Data } from '../layouts/Data'
import { FlowMap } from '../layouts/FlowMap'
import { Inspector } from '../layouts/Inspector'
import { Library } from '../layouts/Library'
import { StepList } from '../layouts/StepList'
import { TabbedPanel } from '../layouts/TabbedPanel'
import { TopBar } from '../layouts/TopBar'
import { cx } from '../primitives/classNames'
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
                { id: 'flow', label: 'Flow', content: <StepList /> },
                { id: 'library', label: 'Library', content: <Library /> },
                { id: 'data', label: 'Data', content: <Data /> },
              ]}
              defaultTabId="flow"
            />
          </div>
          <div className={styles.map}>
            <FlowMap />
          </div>
          <div className={styles.aside}>
            <Inspector />
          </div>
        </div>
      </div>
    </>
  )
}
