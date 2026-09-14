import { useId, useRef, useState } from 'react'
import { cx } from '../primitives/classNames'
import styles from './CanvasControls.module.css'
import css from './CanvasControls.module.css?inline'

export interface CanvasControlsProps {
  /** The current scale, where `1` is 100%. */
  scale: number
  /**
   * The ends of the range. Held here so `−` and `+` can say when there is
   * nowhere further to go: a control that stays live and does nothing reads as
   * a fault rather than as a limit.
   */
  min: number
  max: number
  /**
   * The absolute scales the menu offers, in the order it lists them.
   *
   * A prop rather than a constant in this file, for the tier's rule: the range
   * and the ladder are one set of numbers and they belong wherever the viewport
   * is worked out, not in the thing that draws buttons for them.
   */
  levels: readonly number[]
  /** One multiplicative step. Where it lands is the caller's arithmetic. */
  onZoomIn: () => void
  onZoomOut: () => void
  /** Snap to exactly this scale. */
  onZoomTo: (scale: number) => void
  onFit: () => void
}

/**
 * The canvas's toolbar: `−`, the current percentage, `+`, and fit.
 *
 * ## It computes no geometry, and no arithmetic either
 *
 * It is handed a scale and reports which button was pressed. Where a step
 * lands, what fit works out to and where the range ends are the canvas's
 * questions — this one only has to be able to grey out an end (ADR-0016).
 *
 * Positioning itself is the exception, and it is chrome rather than geometry: a
 * toolbar that floats at the lower right of the canvas is what this unit *is*,
 * so it carries that placement and needs a positioned ancestor. The insets are
 * logical while `boxOf`'s are physical, and the difference is the point — map
 * coordinates are physical by definition, while a toolbar belongs at the end of
 * the reading direction and moves to the left under an RTL Host.
 *
 * ## Fit has one home
 *
 * The menu holds zoom levels and nothing else. Putting "Fit to screen" in it as
 * well as on its own button would be one command with two homes, and the button
 * is the one that can be reached without opening anything.
 *
 * ## A disclosure rather than a `menu`
 *
 * `role="menu"` is a promise that the arrow keys move between the items and Tab
 * leaves the whole thing. This is three buttons in a strip of buttons: Tab
 * through them is what the surrounding toolbar already does, and claiming a
 * role whose keyboard contract is not implemented is worse for a screen reader
 * than claiming none. So the trigger carries `aria-expanded` and the items are
 * ordinary buttons.
 */
export function CanvasControls({
  scale,
  min,
  max,
  levels,
  onZoomIn,
  onZoomOut,
  onZoomTo,
  onFit,
}: CanvasControlsProps) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const listId = useId()

  /*
   * Escape and a chosen item both land back on the trigger: dismissing an
   * overlay leaves focus on the thing that opened it, or the next Tab starts
   * from the top of the document.
   *
   * Nothing here hands focus away after a pointer press, though the canvas
   * behind it pans on space and a focused button would own the space bar. That
   * is the canvas's rule and it applies to every control on it — a card and a
   * `+` have the same problem — so it is stated once there rather than four
   * times here.
   */
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <>
      <style href="hatua-canvas-controls" precedence="hatua">
        {css}
      </style>
      {/*
        No role and no group label. Every button here names itself, and the
        wrapper's only job is to put them in a row: `toolbar` and `group` both
        promise a keyboard contract — arrow keys moving between the items —
        that this does not implement, and a promise a screen reader acts on and
        finds unkept is worse than no role at all.
      */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: it listens for the
          Escape that shuts the menu, wherever inside focus happens to be. That
          is not something a user does TO the strip; the controls are the
          buttons within it. */}
      <div
        className={styles.controls}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !open) return
          // Consumed rather than observed, for the reason ConfirmDialog gives:
          // a Host with its own Escape must not also act on the keystroke that
          // shut this.
          event.stopPropagation()
          close()
        }}
      >
        <button
          type="button"
          className={styles.step}
          aria-label="Zoom out"
          disabled={scale <= min}
          onClick={onZoomOut}
        >
          −
        </button>

        <button
          type="button"
          ref={trigger}
          className={styles.level}
          // The visible text is the whole accessible name's tail, so the two
          // agree for anyone driving this by voice.
          aria-label={`Zoom level: ${percentOf(scale)}%`}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen((was) => !was)}
        >
          {percentOf(scale)}%
        </button>

        <button
          type="button"
          className={styles.step}
          aria-label="Zoom in"
          disabled={scale >= max}
          onClick={onZoomIn}
        >
          +
        </button>

        <span className={styles.divide} aria-hidden="true" />

        <button type="button" className={styles.step} aria-label="Fit to screen" onClick={onFit}>
          {/*
            Corner brackets rather than a box glyph: the marks that say "as much
            of this as will go in the frame" are conventional, and a square is
            equally the sign for maximise. Drawn rather than typed because the
            dotted-square character is not in every UI face, and a face that
            lacks it substitutes a plain square — which is the reading this is
            avoiding.
          */}
          <svg viewBox="0 0 16 16" width="13" height="13" focusable="false" aria-hidden="true">
            <path
              d="M2.5 6v-3.5H6M13.5 6v-3.5H10M2.5 10v3.5H6M13.5 10v3.5H10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {open ? (
          <>
            {/* A click-away backdrop, and deliberately not an interactive
                element: Escape is the keyboard route out, and giving this a
                role would put a stop in the tab order for nothing. */}
            <div className={styles.away} onMouseDown={() => setOpen(false)} aria-hidden="true" />
            <ul className={styles.list} id={listId}>
              {levels.map((level) => (
                <li key={level}>
                  <button
                    type="button"
                    className={cx(styles.item, scale === level && styles.here)}
                    onClick={() => {
                      onZoomTo(level)
                      close()
                    }}
                  >
                    {percentOf(level)}%
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </>
  )
}

/**
 * A scale as whole percent.
 *
 * Rounded, because zoom is continuous: a pinch lands on 0.8333 and "83%" is
 * what a reader can act on. Two readers — the label and the menu items — so it
 * is one function and they cannot round differently.
 */
const percentOf = (scale: number): number => Math.round(scale * 100)
