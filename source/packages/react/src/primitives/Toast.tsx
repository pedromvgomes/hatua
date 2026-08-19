import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePortalContainer } from '../theme/HatuaProvider'
import { cx } from './classNames'
import styles from './Toast.module.css'
import css from './Toast.module.css?inline'

export type ToastTone = 'info' | 'success' | 'error'

export interface ToastProps {
  open: boolean
  tone?: ToastTone
  /** Omit to render a toast the user cannot dismiss. */
  onDismiss?: () => void
  children: ReactNode
}

/**
 * Portals into the provider's own container, never document.body — the body is
 * outside the element carrying the custom properties, so a toast mounted there
 * renders unthemed (ADR-0002's last consequence).
 *
 * usePortalContainer returns null until the provider has mounted; rendering
 * nothing for that one frame is the right answer, because the alternative
 * fallback — document.body — is precisely the bug.
 */
export function Toast({ open, tone = 'info', onDismiss, children }: ToastProps) {
  const container = usePortalContainer()
  if (!open || !container) return null

  return createPortal(
    <>
      <style href="hatua-toast" precedence="hatua">
        {css}
      </style>
      <div className={cx(styles.toast, styles[tone])} role="status" aria-live="polite">
        <span className={styles.body}>{children}</span>
        {onDismiss && (
          <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss">
            ×
          </button>
        )}
      </div>
    </>,
    container,
  )
}
