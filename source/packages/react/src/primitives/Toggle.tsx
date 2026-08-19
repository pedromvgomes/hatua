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

  const control = (
    <button
      type="button"
      id={toggleId}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cx(styles.toggle, !label && className)}
    >
      <span className={styles.thumb} />
    </button>
  )

  return (
    <>
      <style href="hatua-toggle" precedence="hatua">
        {css}
      </style>
      {label === undefined ? (
        control
      ) : (
        <span className={cx(styles.field, className)}>
          {control}
          <label className={styles.label} htmlFor={toggleId}>
            {label}
          </label>
        </span>
      )}
    </>
  )
}
