import type { ComponentPropsWithRef } from 'react'
import { cx } from './classNames'
import styles from './Select.module.css'
import css from './Select.module.css?inline'

export type SelectProps = ComponentPropsWithRef<'select'>

/**
 * A native <select> underneath: the platform's own popup is keyboard- and
 * screen-reader-correct on every device for free, and nothing about a step's
 * component picker needs more than that. Only the closed control is restyled.
 */
export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <>
      <style href="hatua-select" precedence="hatua">
        {css}
      </style>
      <span className={styles.wrapper}>
        <select className={cx(styles.select, className)} {...rest}>
          {children}
        </select>
        <svg
          className={styles.chevron}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </>
  )
}
