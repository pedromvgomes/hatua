import { type ComponentPropsWithRef, useCallback, useEffect, useRef, useState } from 'react'
import { cx } from './classNames'
import styles from './Select.module.css'
import css from './Select.module.css?inline'
import { Tooltip } from './Tooltip'
import { useTextOverflowing } from './useOverflowing'

export interface SelectProps extends ComponentPropsWithRef<'select'> {
  /**
   * Offer the whole of the chosen option when the box is showing less than it
   * holds. Opt-in, for the reason `InputProps.revealOnOverflow` gives.
   *
   * Measured differently from an input's, and it has to be: a `<select>`
   * reports the same scrollWidth as clientWidth however long the chosen option
   * is, because the closed box is chrome rather than content it lays out. The
   * text is measured against the room inside the padding instead.
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

  /*
   * The chosen option's text, read from the element rather than from props.
   *
   * Not read during render: the ref is null on the first pass, and nothing
   * about a ref filling in later causes a second one — so the text stayed empty
   * for ever and the box never looked like it was showing less than it holds.
   * Not derived from `children` either, which are arbitrary nodes and would
   * make this guess at markup a caller owns.
   *
   * The equality guard is what keeps a dependency-free effect from being a
   * loop, and it settles in one extra render.
   */
  const [chosen, setChosen] = useState('')
  const read = useCallback(() => {
    const text = own.current?.selectedOptions?.[0]?.text ?? ''
    setChosen((current) => (current === text ? current : text))
  }, [])

  useEffect(read)

  /*
   * And on the element's own `change`, because an uncontrolled `<select>`
   * changes without anything re-rendering — so a reveal left over from the
   * previous option would sit there describing a value no longer chosen.
   */
  useEffect(() => {
    const element = own.current
    if (!element) return
    element.addEventListener('change', read)
    return () => element.removeEventListener('change', read)
  }, [read])

  const overflowing = useTextOverflowing(own, chosen)

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
