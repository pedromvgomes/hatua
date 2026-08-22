import { type ReactNode, type RefObject, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePortalContainer } from '../theme/HatuaProvider'
import { place } from './placement'
import styles from './Tooltip.module.css'
import css from './Tooltip.module.css?inline'

/**
 * What a truncated thing says in full.
 *
 * ## It attaches to an element rather than wrapping one
 *
 * The caller owns the element and passes its ref; this renders the layer and
 * wires the listeners onto it. Wrapping the child instead means either a
 * wrapper box in the middle of somebody's layout, or `cloneElement` to graft
 * handlers onto a component whose props it cannot see — and every control here
 * already holds a ref for its own reasons.
 *
 * ## Hover is not enough
 *
 * A tooltip that only answers to a pointer is invisible to a keyboard and on a
 * touch screen. So it opens on focus as well, `Escape` dismisses it, and the
 * anchor gets `aria-describedby` while it is open, which is what carries the
 * text to a screen reader whether or not anything ever appeared on screen.
 *
 * It takes no focus of its own and traps none: Hatua is a guest in someone's
 * page. That is also why it is not a `dialog` — nothing here is to be
 * interacted with, so `role="tooltip"` is the whole of it.
 */
export interface TooltipProps {
  /** The element it describes. Held by the caller, which already has a ref to it. */
  anchor: RefObject<HTMLElement | null>
  /**
   * What it says. A node rather than a string, because the interesting case is
   * a value that is already rendered — a Template's chips, wrapped over as many
   * lines as it takes — and re-describing that as text would say it twice.
   */
  content: ReactNode
  /**
   * Whether there is anything worth saying. False is the ordinary state of a
   * `revealOnOverflow` control whose value fits, and it must not merely hide
   * the layer: an `aria-describedby` pointing at the full text of something
   * already fully visible reads it out twice.
   */
  enabled?: boolean
  /** Overrides the automatic id, for a caller that needs to know it. */
  id?: string
}

export function Tooltip({ anchor, content, enabled = true, id }: TooltipProps) {
  const container = usePortalContainer()
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null)

  // One id per mounted tooltip, so `aria-describedby` names something real.
  const [described] = useState(() => id ?? `hatua-tip-${Math.random().toString(36).slice(2, 9)}`)

  /*
   * Listening happens whether or not there is anything to say.
   *
   * Gated on `enabled`, the listeners came and went with it — so a pointer
   * already resting on the control when it became worth describing had already
   * sent its `pointerenter`, and nothing would appear until it left and came
   * back. Choosing a short option and then a long one again is exactly that.
   */
  useEffect(() => {
    const element = anchor.current
    if (!element) return

    const show = () => setOpen(true)
    const hide = () => setOpen(false)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }

    element.addEventListener('pointerenter', show)
    element.addEventListener('pointerleave', hide)
    element.addEventListener('focusin', show)
    element.addEventListener('focusout', hide)
    element.addEventListener('keydown', onKeyDown)
    return () => {
      element.removeEventListener('pointerenter', show)
      element.removeEventListener('pointerleave', hide)
      element.removeEventListener('focusin', show)
      element.removeEventListener('focusout', hide)
      element.removeEventListener('keydown', onKeyDown)
      setOpen(false)
    }
  }, [anchor])

  /*
   * Described whenever there is something to say, not only while the layer is
   * on screen. A screen reader is the one reader for whom "hover" means
   * nothing, so waiting for a pointer would be waiting for ever.
   */
  useEffect(() => {
    const element = anchor.current
    if (!element || !enabled) return
    element.setAttribute('aria-describedby', described)
    return () => element.removeAttribute('aria-describedby')
  }, [anchor, enabled, described])

  // Measured on open rather than held: the anchor may have scrolled, and a
  // position from the last time it was shown is a layer somewhere else.
  // `enabled` is a dependency because it can turn on while the pointer is
  // already resting on the anchor, and the layer is about to be shown from a
  // position measured before it had one.
  useEffect(() => {
    if (!open || !enabled) return setAt(null)
    const box = anchor.current?.getBoundingClientRect()
    if (!box) return
    const { left, top, bottom } = place(box, WIDTH, { wants: 120 })
    setAt({ left, top, bottom })
  }, [open, enabled, anchor])

  if (!enabled || !container) return null

  return createPortal(
    <>
      <style href="hatua-tooltip" precedence="hatua">
        {css}
      </style>
      {/*
        Mounted whether or not it is on screen, because `aria-describedby`
        above points at it — an id naming nothing is a description a screen
        reader offers and then cannot find.
      */}
      <div
        id={described}
        role="tooltip"
        className={styles.tip}
        style={at ?? undefined}
        data-open={open && at ? 'true' : undefined}
      >
        {content}
      </div>
    </>,
    container,
  )
}

/** Matches `.tip`'s `max-inline-size`; the clamp needs it as a number. */
const WIDTH = 320
