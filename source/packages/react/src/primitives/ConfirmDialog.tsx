import { type ReactNode, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { usePortalContainer } from '../theme/HatuaProvider'
import { Button } from './Button'
import styles from './ConfirmDialog.module.css'
import css from './ConfirmDialog.module.css?inline'

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

  // Escape is registered on the document because focus may legitimately sit on
  // the backdrop or on a control the Host rendered behind it.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onCancel])

  // `container` belongs in the dependencies: it is null on the first render,
  // so on that pass there is no dialog and nothing to focus.
  useEffect(() => {
    if (open && container) confirmRef.current?.focus()
  }, [open, container])

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
            <Button variant="ghost" onClick={onCancel}>
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
