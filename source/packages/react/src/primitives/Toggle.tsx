import { type ReactNode, useId } from 'react'
import { cx } from './classNames'
import styles from './Toggle.module.css'
import css from './Toggle.module.css?inline'

export interface ToggleProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  /** Rendered beside the switch and wired to it; omit for an icon-only control. */
  label?: ReactNode
  /** Required when `label` is omitted, so the control still announces itself. */
  'aria-label'?: string
  id?: string
  className?: string
}

/**
 * `role="switch"` on a button rather than a styled checkbox: a checkbox cannot
 * be given the pill treatment without hiding the real control and duplicating
 * its keyboard behaviour on the visual one.
 */
export function Toggle({
  checked,
  onCheckedChange,
  disabled,
  label,
  id,
  className,
  'aria-label': ariaLabel,
}: ToggleProps) {
  const generatedId = useId()
  const toggleId = id ?? generatedId

  /*
   * One predicate, used by both branches below. `label={showLabel && 'Run in
   * parallel'}` is how a caller naturally writes a conditional label, and it
   * produces `false` — so false, null and '' all have to mean the same thing as
   * omitting it. Testing `!label` in one place and `label === undefined` in the
   * other made them disagree: the switch got an empty <label> and therefore no
   * accessible name at all, and `className` landed on two elements.
   */
  const hasLabel = label !== undefined && label !== null && label !== false && label !== ''

  const control = (
    <button
      type="button"
      id={toggleId}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cx(styles.toggle, !hasLabel && className)}
    >
      <span className={styles.thumb} />
    </button>
  )

  return (
    <>
      <style href="hatua-toggle" precedence="hatua">
        {css}
      </style>
      {hasLabel ? (
        <span className={cx(styles.field, className)}>
          {control}
          <label className={styles.label} htmlFor={toggleId}>
            {label}
          </label>
        </span>
      ) : (
        control
      )}
    </>
  )
}
