import { type ComponentPropsWithRef, useRef } from 'react'
import { cx } from './classNames'
import styles from './Input.module.css'
import css from './Input.module.css?inline'
import { Tooltip } from './Tooltip'
import { useOverflowing } from './useOverflowing'

export interface InputProps extends ComponentPropsWithRef<'input'> {
  /** Renders the error treatment and sets `aria-invalid`. */
  invalid?: boolean
  /**
   * Offer the whole value when the box is showing less than it holds.
   *
   * Opt-in, because a tooltip on every truncated string in an application is
   * noise nobody reads. Turn it on where the value is one someone has to be
   * able to check — a path, a key, a connection's name — and leave it off where
   * the point is the shape of the thing rather than its every character.
   */
  revealOnOverflow?: boolean
}

export function Input({ invalid, revealOnOverflow, className, ref, ...rest }: InputProps) {
  const own = useRef<HTMLInputElement>(null)
  const overflowing = useOverflowing(own)

  return (
    <>
      <style href="hatua-input" precedence="hatua">
        {css}
      </style>
      <input
        ref={(element) => {
          own.current = element
          if (typeof ref === 'function') ref(element)
          else if (ref) ref.current = element
        }}
        className={cx(styles.input, invalid && styles.invalid, className)}
        aria-invalid={invalid || undefined}
        {...rest}
      />
      {revealOnOverflow ? (
        <Tooltip anchor={own} enabled={overflowing} content={String(rest.value ?? '')} />
      ) : null}
    </>
  )
}
