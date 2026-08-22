import { type ComponentPropsWithRef, useRef } from 'react'
import { cx } from './classNames'
import styles from './Select.module.css'
import css from './Select.module.css?inline'
import { Tooltip } from './Tooltip'
import { useOverflowing } from './useOverflowing'

export interface SelectProps extends ComponentPropsWithRef<'select'> {
  /**
   * Offer the whole of the chosen option when the box is showing less than it
   * holds. Opt-in, for the reason `InputProps.revealOnOverflow` gives.
   *
   * Approximate here in a way it is not on an input: the closed box is drawn by
   * the platform and does not always report the width of the option inside it,
   * so a long name may go unnoticed. A miss costs a tooltip nobody was offered,
   * never a wrong one.
   */
  revealOnOverflow?: boolean
}

/**
 * A native <select> underneath: the platform's own popup is keyboard- and
 * screen-reader-correct on every device for free, and nothing about a step's
 * component picker needs more than that. Only the closed control is restyled.
 */
export function Select({ className, children, revealOnOverflow, ref, ...rest }: SelectProps) {
  const own = useRef<HTMLSelectElement>(null)
  const overflowing = useOverflowing(own)
  const chosen = own.current?.selectedOptions?.[0]?.text ?? ''

  return (
    <>
      <style href="hatua-select" precedence="hatua">
        {css}
      </style>
      <span className={styles.wrapper}>
        <select
          ref={(element) => {
            own.current = element
            if (typeof ref === 'function') ref(element)
            else if (ref) ref.current = element
          }}
          className={cx(styles.select, className)}
          {...rest}
        >
          {children}
        </select>
        {revealOnOverflow ? (
          <Tooltip anchor={own} enabled={overflowing && chosen !== ''} content={chosen} />
        ) : null}
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
