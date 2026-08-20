import type { ComponentPropsWithRef } from 'react'
import { cx } from '../primitives/classNames'
import styles from './FlowMap.module.css'
import css from './FlowMap.module.css?inline'
import { Placeholder } from './Placeholder'

export type FlowMapProps = ComponentPropsWithRef<'section'>

/**
 * The canvas: the Step tree drawn as a map of node cards and connectors, edited
 * in place. It fills the middle of the screen and is always on it.
 *
 * NOT the Flow tab, which is what this used to say. The Flow tab holds
 * <StepList> — the same tree as a dense, ordered list — and mounting the canvas
 * there instead left the designer with nowhere to put a canvas at all: it was
 * visible only while one of three tabs was open, and never beside the panel it
 * is edited from. The tab labelled "Flow" and the region called `FlowMap` were
 * two different things wearing one name.
 *
 * A stub until the canvas PR, which is preceded by the layout algorithm PR
 * because of Derived Layout: a Step's position is computed from the tree on
 * every render and never persisted, so there is nothing here for a Host to
 * store and nothing for this component to remember.
 */
export function FlowMap({ className, ...rest }: FlowMapProps) {
  return (
    <>
      <style href="hatua-flow-map" precedence="hatua">
        {css}
      </style>
      <section aria-label="Flow map" className={cx(styles.flowMap, className)} {...rest}>
        <Placeholder>
          The Step tree lands here, laid out from the document on every render.
        </Placeholder>
      </section>
    </>
  )
}
