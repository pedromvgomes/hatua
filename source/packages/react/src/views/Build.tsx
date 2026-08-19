import type { ComponentPropsWithRef } from 'react'
import { Data } from '../layouts/Data'
import { FlowMap } from '../layouts/FlowMap'
import { Inspector } from '../layouts/Inspector'
import { Library } from '../layouts/Library'
import { TabbedPanel } from '../layouts/TabbedPanel'
import { TopBar } from '../layouts/TopBar'
import { cx } from '../primitives/classNames'
import styles from './Build.module.css'
import css from './Build.module.css?inline'

export type BuildProps = ComponentPropsWithRef<'div'>

/**
 * The designer screen: the toolbar, the tabbed work area and the step editor.
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
 */
export function Build({ className, ...rest }: BuildProps) {
  return (
    <>
      <style href="hatua-build" precedence="hatua">
        {css}
      </style>
      <div className={cx(styles.build, className)} {...rest}>
        <div className={styles.bar}>
          <TopBar />
        </div>
        <div className={styles.work}>
          <TabbedPanel
            // The tab labels and the region names are two vocabularies for the
            // same three things: the Flow tab is <FlowMap>. See layouts/README.
            tabs={[
              { id: 'library', label: 'Library', content: <Library /> },
              { id: 'flow', label: 'Flow', content: <FlowMap /> },
              { id: 'data', label: 'Data', content: <Data /> },
            ]}
            defaultTabId="flow"
          />
        </div>
        <div className={styles.aside}>
          <Inspector />
        </div>
      </div>
    </>
  )
}
