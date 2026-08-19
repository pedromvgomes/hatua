import type { ComponentPropsWithRef } from 'react'
import { cx } from '../primitives/classNames'
import styles from './Data.module.css'
import css from './Data.module.css?inline'
import { Placeholder } from './Placeholder'

export type DataProps = ComponentPropsWithRef<'section'>

/**
 * The Data tab: the values a Template can read — a Trigger's declared outputs,
 * each Step's outputs, the workflow's variables and its Connections.
 *
 * A stub until the data PR. It is the same vocabulary the reference picker
 * offers, shown as a browsable tree rather than a popover.
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
