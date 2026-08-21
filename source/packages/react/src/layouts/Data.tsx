import type { ComponentPropsWithRef } from 'react'
import { cx } from '../primitives/classNames'
import styles from './Data.module.css'
import css from './Data.module.css?inline'
import { Placeholder } from './Placeholder'

export type DataProps = ComponentPropsWithRef<'section'>

/**
 * The Data panel: everything the selected Step can read, as a read-only tree —
 * a Trigger's declared outputs, each upstream Step's outputs, Run Context and
 * the workflow's variables.
 *
 * A stub until the reference-tree PR. It is the same component the picker's
 * **Reference** tab mounts, and it is not a tab: the step editor expands
 * leftward into it, so a run of mappings does not mean reopening a popover each
 * time. Drag out of it; do not edit in it — a variable is *edited* in the
 * Workflow tab and *read* here, one place to change a thing and one place to
 * use it.
 */
export function Data({ className, ...rest }: DataProps) {
  return (
    <>
      <style href="hatua-data" precedence="hatua">
        {css}
      </style>
      <section aria-label="Data" className={cx(styles.data, className)} {...rest}>
        <Placeholder>
          The values a Template can read land here — Trigger payloads, Step outputs, variables.
        </Placeholder>
      </section>
    </>
  )
}
