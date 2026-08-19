import { type ReactNode, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { usePortalContainer } from '../theme/HatuaProvider'
import { Button } from './Button'
import styles from './ConfirmDialog.module.css'
import css from './ConfirmDialog.module.css?inline'

/**
 * What Tab can reach. Deliberately not exhaustive — the dialog holds its own
 * two buttons plus whatever a caller puts in `description`, and a caller who
 * needs more than this in a confirmation is asking the wrong component.
 */
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** `danger` for destructive confirmations — discarding a Draft, deleting a Step. */
  tone?: 'default' | 'danger'
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Portals into the provider's container rather than document.body, for the
 * reason set out in Toast.tsx and ADR-0002.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const container = usePortalContainer()
  const titleId = useId()
  const descriptionId = useId()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<Element | null>(null)

  // Declared before the focus effect below, so it records who had focus BEFORE
  // the confirm button takes it. Without giving it back, closing the dialog
  // drops focus onto document.body and a keyboard user loses their place in the
  // designer entirely.
  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement
    return () => {
      const previous = restoreRef.current
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [open])

  /*
   * `container` belongs in the dependencies: it is null on the first render, so
   * on that pass there is no dialog and nothing to focus.
   *
   * A danger dialog opens on Cancel, not Confirm. The destructive action is the
   * one the dialog exists to put a step in front of, and focusing it hands that
   * step straight back: someone who presses Enter or Space reflexively as the
   * dialog appears — which is exactly what happens when the keystroke that
   * opened it is still under their finger — would discard the Draft. Focus the
   * safe action and the reflex costs nothing.
   */
  useEffect(() => {
    if (!open || !container) return
    const opensOn = tone === 'danger' ? cancelRef.current : confirmRef.current
    opensOn?.focus()
  }, [open, container, tone])

  /*
   * Escape, and the focus trap.
   *
   * Both are registered on the document rather than the dialog: focus may
   * legitimately sit outside it — on the backdrop, or on something the Host
   * rendered behind it — and those are exactly the cases that have to be caught.
   *
   * The trap is what makes `aria-modal="true"` on the dialog true. That
   * attribute tells assistive technology the rest of the page is unreachable;
   * without keeping Tab inside, it would be a claim the markup does not honour,
   * and the backdrop would be blocking pointer users only.
   */
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Consumed, not merely observed. A Host with its own document-level
        // Escape — closing a side panel, leaving a full-screen editor — would
        // otherwise act on the same keystroke, so dismissing the dialog would
        // also tear down the UI behind it. aria-modal="true" tells assistive
        // technology that UI is unreachable; letting its shortcuts fire anyway
        // is the same claim broken for everyone else.
        event.preventDefault()
        event.stopPropagation()
        onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return

      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => !element.hasAttribute('disabled'),
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      const active = document.activeElement
      const escapingBackwards = event.shiftKey && (active === first || !dialog.contains(active))
      const escapingForwards = !event.shiftKey && (active === last || !dialog.contains(active))
      if (escapingBackwards) {
        event.preventDefault()
        last.focus()
      } else if (escapingForwards) {
        event.preventDefault()
        first.focus()
      }
    }
    // Capture, so stopPropagation above actually stops something: a listener
    // the Host registered on document or window is reached later in the
    // dispatch and is skipped once the stop flag is set. In the bubble phase
    // there is nothing left to stop.
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, onCancel])

  if (!open || !container) return null

  return createPortal(
    <>
      <style href="hatua-confirm-dialog" precedence="hatua">
        {css}
      </style>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a
          convenience for pointer users; Escape and Cancel are the real paths. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: same. */}
      <div
        className={styles.backdrop}
        onClick={(event) => {
          if (event.target === event.currentTarget) onCancel()
        }}
      >
        <div
          ref={dialogRef}
          className={styles.dialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
        >
          <h2 className={styles.title} id={titleId}>
            {title}
          </h2>
          {description && (
            <p className={styles.description} id={descriptionId}>
              {description}
            </p>
          )}
          <div className={styles.actions}>
            <Button ref={cancelRef} variant="ghost" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button
              ref={confirmRef}
              variant={tone === 'danger' ? 'danger' : 'primary'}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </>,
    container,
  )
}
