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

  // Two flags, not one shared `paused`: with a single boolean, leaving with the
  // pointer would resume a countdown that focus is still holding, and a toast
  // would then dismiss itself out from under the button someone had tabbed to.
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused

  const durationMs = (autoDismissAfter ?? 0) * 1000
  const timed = open && onDismiss !== undefined && durationMs > 0

  // How much of the wait has been spent. A ref rather than state: it changes on
  // every pause and resume, and nothing renders from it — the bar is a CSS
  // animation, which pauses itself.
  const elapsedRef = useRef(0)

  // Whether this showing has already asked to be closed. The toast is
  // controlled, so a caller is free to leave it open after onDismiss — and
  // without this the effect below would ask again on every re-render that
  // brings a fresh onDismiss closure, since the remaining wait has collapsed to
  // zero. One showing asks once.
  const askedRef = useRef(false)

  // A new showing is a new countdown. Closing deliberately does NOT reset the
  // elapsed time, so the cleanup below can still charge what the last showing
  // used.
  useEffect(() => {
    if (!open) return
    elapsedRef.current = 0
    askedRef.current = false
    setHovered(false)
    setFocused(false)
  }, [open])

  // Finding a toast untimed clears the pause flags, because the handlers that
  // would clear them are attached only while it IS timed. A toast that loses
  // its timer under the pointer — a store swapping autoDismissAfter to
  // undefined — otherwise never sees the pointer leave, and `hovered` latches
  // at true: restoring the timer without cycling `open` would leave a frozen
  // bar on a toast that never dismisses.
  useEffect(() => {
    if (timed) return
    setHovered(false)
    setFocused(false)
  }, [timed])

  useEffect(() => {
    if (!timed || paused || askedRef.current) return
    const startedAt = Date.now()
    const timer = setTimeout(
      () => {
        askedRef.current = true
        onDismiss?.()
      },
      Math.max(0, durationMs - elapsedRef.current),
    )
    return () => {
      clearTimeout(timer)
      // Charge the elapsed time, so resuming continues the wait instead of
      // restarting it. This also makes the effect safe to re-run when a caller
      // passes a fresh onDismiss closure on every render.
      elapsedRef.current += Date.now() - startedAt
    }
  }, [timed, paused, durationMs, onDismiss])

  if (!container) return null

  const pauseHandlers = timed
    ? {
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
        onFocus: () => setFocused(true),
        onBlur: () => setFocused(false),
      }
    : undefined

  return createPortal(
    <>
      <style href="hatua-toast" precedence="hatua">
        {css}
      </style>
      {/*
        The live region stays mounted whether or not a toast is showing. Screen
        readers announce a region whose CONTENTS change; one inserted with its
        text already in place is routinely missed, which would leave the toast
        silent for exactly the people relying on it. This only holds while the
        <Toast> itself stays mounted — the controlled `open` prop is what makes
        that the natural way to use it.
      */}
      <div className={styles.region} role="status" aria-live="polite">
        {open && (
          <div
            className={cx(styles.toast, styles[tone])}
            data-paused={timed && paused ? 'true' : undefined}
            {...pauseHandlers}
          >
            <span className={styles.body}>{children}</span>
            {onDismiss && (
              <button
                type="button"
                className={styles.dismiss}
                onClick={onDismiss}
                aria-label="Dismiss"
              >
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
        )}
      </div>
    </>,
    container,
  )
}
