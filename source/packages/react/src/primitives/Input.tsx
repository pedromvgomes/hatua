import type { ComponentPropsWithRef } from 'react'
import { cx } from './classNames'
import styles from './Input.module.css'
import css from './Input.module.css?inline'

export interface InputProps extends ComponentPropsWithRef<'input'> {
  /** Renders the error treatment and sets `aria-invalid`. */
  invalid?: boolean
}

export function Input({ invalid, className, ...rest }: InputProps) {
  return (
    <>
      <style href="hatua-input" precedence="hatua">
        {css}
      </style>
      <input
        className={cx(styles.input, invalid && styles.invalid, className)}
        aria-invalid={invalid || undefined}
        {...rest}
      />
    </>
  )
}
