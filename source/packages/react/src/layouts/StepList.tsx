import type { ComponentPropsWithRef } from 'react'
import { cx } from '../primitives/classNames'
import { Placeholder } from './Placeholder'
import styles from './StepList.module.css'
import css from './StepList.module.css?inline'

export type StepListProps = ComponentPropsWithRef<'section'>

/**
 * The Flow tab: the Workflow Definition's Steps as a tree, depth-first, with
 * the Branch headers and the insert points between them.
 *
 * A stub until the flow tab PR.
 *
 * This region was retired in PR 2 and is back, because retiring it was a
 * mistake. `layouts/README.md` reasoned that "the tree is the map now, and the
 * three tabs are Library, Flow and Data — there is no fourth panel for it to
 * be." Both halves are wrong: the design has the tree *and* the map on screen
 * together, the tree in the 304px side panel and the map filling the middle,
 * and it is the tree that lives behind the **Flow** tab. So the fourth panel
 * was never needed — the side panel is where this always belonged, and it was
 * <FlowMap> that had been put in the tab strip in its place.
 *
 * The consequence of that swap is what forced this: with the canvas mounted as
 * a tab, the screen had nowhere to *put* a canvas. It was visible only while
 * the Flow tab was open, and never beside the panel it is edited from.
 *
 * A list, not a map. The two show the same tree and are not redundant: the list
 * is dense, ordered and scannable at a glance in a long workflow, and it is
 * where a Step is dragged from and where the insert points are unambiguous.
 */
export function StepList({ className, ...rest }: StepListProps) {
  return (
    <>
      <style href="hatua-step-list" precedence="hatua">
        {css}
      </style>
      <section aria-label="Steps" className={cx(styles.stepList, className)} {...rest}>
        <Placeholder>
          The Steps land here as a tree — each one draggable, with an insert point between every
          two.
        </Placeholder>
      </section>
    </>
  )
}
