import type { ComponentPropsWithRef } from 'react'
import { cx } from '../primitives/classNames'
import styles from './FlowMap.module.css'
import css from './FlowMap.module.css?inline'
import { Placeholder } from './Placeholder'

export type FlowMapProps = ComponentPropsWithRef<'section'>

/**
 * The canvas — the Flow tab. Renders the Step tree as a map and edits it in
 * place.
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
      <section aria-label="Flow" className={cx(styles.flowMap, className)} {...rest}>
        <Placeholder>
          The Step tree lands here, laid out from the document on every render.
        </Placeholder>
      </section>
    </>
  )
}
