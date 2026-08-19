import type { ComponentPropsWithRef } from 'react'
import styles from './Button.module.css'
import css from './Button.module.css?inline'
import { cx } from './classNames'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
}

/**
 * The component carries its own stylesheet (ADR-0003): React 19 hoists the
 * <style> to <head>, dedupes it by href across every instance, and emits it
 * during SSR — so a Host that never renders a Button never ships its CSS.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return (
    <>
      <style href="hatua-button" precedence="hatua">
        {css}
      </style>
      <button
        type={type}
        className={cx(styles.button, styles[size], styles[variant], className)}
        {...rest}
      />
    </>
  )
}
