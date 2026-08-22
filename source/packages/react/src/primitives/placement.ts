/**
 * Where a floating layer goes, given the thing it belongs to.
 *
 * Three components ask the same question — the completion list, the picker and
 * the tooltip — and the answer has two parts that are easy to get subtly wrong
 * twice.
 *
 * **It flips when there is less room below AND more above**, never on a fixed
 * threshold. A fixed one flipped a panel above a button with 460px of space
 * beneath it and ran it off the top of the window.
 *
 * **It clamps sideways.** The anchor is a caret or a small button near the edge
 * of a 304px column, and a layer wider than that hung off it lands half of
 * itself outside the window.
 *
 * What it does NOT do is cap the layer's height: it reports the room that
 * exists and each caller decides what to do with it, because how much of that
 * room is the scrolling part differs — a picker has a head and a tab strip
 * outside its body, a tooltip is all body.
 */

export interface Anchor {
  /** Viewport coordinates of the thing the layer belongs to. */
  left: number
  top: number
  bottom: number
}

export interface Placement {
  left: number
  /** Set when the layer hangs below the anchor. */
  top?: number
  /** Set when it sits above instead, measured from the bottom of the window. */
  bottom?: number
  /** How much room the chosen direction actually has. */
  space: number
  flipped: boolean
}

/** What a window measures, so this stays callable where there is no window. */
const viewport = () => ({
  width: typeof window === 'undefined' ? 1280 : window.innerWidth,
  height: typeof window === 'undefined' ? 800 : window.innerHeight,
})

export function place(
  anchor: Anchor,
  width: number,
  { gap = 6, margin = 12, wants = 260 }: { gap?: number; margin?: number; wants?: number } = {},
): Placement {
  const screen = viewport()
  const below = screen.height - anchor.bottom - margin
  const above = anchor.top - margin
  const flipped = below < wants && above > below

  return {
    left: Math.max(margin, Math.min(anchor.left, screen.width - width - margin)),
    ...(flipped ? { bottom: screen.height - anchor.top + gap } : { top: anchor.bottom + gap }),
    space: Math.max(0, flipped ? above : below),
    flipped,
  }
}
