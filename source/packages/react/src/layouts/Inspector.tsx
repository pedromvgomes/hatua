import type { ComponentPropsWithRef } from 'react'
import { cx } from '../primitives/classNames'
import styles from './Inspector.module.css'
import css from './Inspector.module.css?inline'
import { Placeholder } from './Placeholder'

export type InspectorProps = ComponentPropsWithRef<'aside'>

/**
 * The step editor: the selected Step's fields, each one a Slot holding a
 * Template typed by the Component Manifest.
 *
 * A stub until the step editor PR. It is an <aside> rather than a <section>
 * because it is about whatever is selected elsewhere — which is also why a Host
 * can mount it in a drawer of its own and lose nothing.
 */
export function Inspector({ className, ...rest }: InspectorProps) {
  return (
    <>
      <style href="hatua-inspector" precedence="hatua">
        {css}
      </style>
      <aside aria-label="Inspector" className={cx(styles.inspector, className)} {...rest}>
        <Placeholder>The selected Step's fields land here, one Slot at a time.</Placeholder>
      </aside>
    </>
  )
}
