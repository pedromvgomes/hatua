import { type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePortalContainer } from '../theme/HatuaProvider'
import { cx } from './classNames'
import styles from './Toast.module.css'
import css from './Toast.module.css?inline'

export type ToastTone = 'info' | 'success' | 'error'

export interface ToastProps {
  open: boolean
  tone?: ToastTone
  /**
   * Seconds to wait before the toast asks to be closed, with a progress bar
   * counting the wait down. Requires `onDismiss` — the toast is controlled, so
   * it can ask, not act. Omit for a toast that stays until something closes it.
   *
   * The countdown pauses while the pointer or the keyboard focus is inside it,
   * so a message cannot expire out from under someone reading or reaching for
   * it.
   */
  autoDismissAfter?: number
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
export function Toast({ open, tone = 'info', autoDismissAfter, onDismiss, children }: ToastProps) {
  const container = usePortalContainer()
  const [paused, setPaused] = useState(false)

  const timed =
    open && onDismiss !== undefined && autoDismissAfter !== undefined && autoDismissAfter > 0

  // What is left of the wait, in ms. A ref rather than state: it changes on
  // every pause and resume, and nothing renders from it — the bar is a CSS
  // animation, which pauses itself.
  const remainingRef = useRef(0)

  // Refill the budget when the toast opens, so a toast shown again gets the
  // whole wait rather than whatever the last showing left of it.
  useEffect(() => {
    if (!open) return
    remainingRef.current = (autoDismissAfter ?? 0) * 1000
    setPaused(false)
  }, [open, autoDismissAfter])

  useEffect(() => {
    if (!timed || paused) return
    const startedAt = Date.now()
    const timer = setTimeout(() => onDismiss?.(), remainingRef.current)
    return () => {
      clearTimeout(timer)
      // Charge the elapsed time to the budget, so resuming continues the wait
      // instead of restarting it. This also makes the effect safe to re-run
      // when a caller passes a fresh onDismiss closure on every render.
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt))
    }
  }, [timed, paused, onDismiss])

  if (!open || !container) return null

  const pauseHandlers = timed
    ? {
        onMouseEnter: () => setPaused(true),
        onMouseLeave: () => setPaused(false),
        onFocus: () => setPaused(true),
        onBlur: () => setPaused(false),
      }
    : undefined

  return createPortal(
    <>
      <style href="hatua-toast" precedence="hatua">
        {css}
      </style>
      <div
        className={cx(styles.toast, styles[tone])}
        role="status"
        aria-live="polite"
        data-paused={timed && paused ? 'true' : undefined}
        {...pauseHandlers}
      >
        <span className={styles.body}>{children}</span>
        {onDismiss && (
          <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss">
            ×
          </button>
        )}
        {timed && (
          <span
            className={styles.progress}
            style={{ animationDuration: `${autoDismissAfter}s` }}
            data-testid="hatua-toast-progress"
          />
        )}
      </div>
    </>,
    container,
  )
}
