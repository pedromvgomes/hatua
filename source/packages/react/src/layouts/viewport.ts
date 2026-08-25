/**
 * Where somebody is looking at the canvas, and the arithmetic that moves it.
 *
 * A viewport is chrome and not geometry (ADR-0016): `@hatua/layout` says where
 * every card on a Board goes, and this says which part of that is on screen and
 * how big. So it is here rather than in the layout package — nothing about a
 * pan belongs to a Workflow Definition, and ADR-0001 keeps positions out of the
 * document for the same reason it keeps this out.
 *
 * Plain functions over plain numbers, so the canvas can be checked without a
 * layout engine. jsdom has none, which is exactly why the arithmetic is not
 * left inside a component.
 */

/**
 * A pan and a zoom, as the surface's transform reads them.
 *
 * `x`/`y` are screen pixels and `scale` multiplies after them:
 * `translate(x, y) scale(scale)` from an origin of `0 0`. In that order the
 * offset stays in screen pixels at every zoom, which is what lets a pointer
 * delta be added to it without dividing by anything.
 */
export interface Viewport {
  x: number
  y: number
  scale: number
}

/** A box, in the same units on both sides: a `DOMRect` satisfies it. */
export interface Size {
  width: number
  height: number
}

/**
 * The ends of the range, one press of `+`, and what the menu offers.
 *
 * 10% to 400% (ADR-0016): at the bottom a card is 24px and the map is a
 * minimap, which is the point of the low end on a workflow that will not fit at
 * any readable scale; at the top a card is 944px, which is magnification for
 * someone who needs it.
 *
 * `step` multiplies rather than adds, so a press covers the same proportion of
 * the range at 20% as at 200% — 10 percentage points is most of the way out at
 * one end and imperceptible at the other.
 */
export const ZOOM = {
  min: 0.1,
  max: 4,
  step: 1.2,
  /**
   * Absolute, and that is what makes the menu the way back: `100%` does not
   * step, it snaps to exactly 1. The wheel and a pinch never land here, because
   * a pinch that snaps instead of tracking your fingers reads as a fault.
   */
  levels: [0.5, 1, 2] as readonly number[],
} as const

/** The breathing room around the map at first paint and at fit. */
export const MARGIN = 24

const UNMOVED: Viewport = { x: 0, y: 0, scale: 1 }

export const clampScale = (scale: number): number => Math.min(ZOOM.max, Math.max(ZOOM.min, scale))

/**
 * Zoom about a point, keeping whatever is under it under it.
 *
 * `at` is in the viewport's own coordinates — the offset of the pointer from
 * the top-left of the box the canvas is clipped to. Zooming about the centre of
 * the viewport instead was rejected: zooming to inspect something means zooming
 * to where you are looking, and a centre-anchored zoom walks the thing you were
 * pointing at off the screen.
 */
export function zoomAbout(view: Viewport, scale: number, at: { x: number; y: number }): Viewport {
  const next = clampScale(scale)
  const ratio = next / view.scale
  return {
    x: at.x - (at.x - view.x) * ratio,
    y: at.y - (at.y - view.y) * ratio,
    scale: next,
  }
}

/** One press of `+` or `−`, about the middle of what is on screen. */
export const stepZoom = (view: Viewport, direction: 1 | -1, box: Size): Viewport =>
  zoomAbout(view, direction > 0 ? view.scale * ZOOM.step : view.scale / ZOOM.step, {
    x: box.width / 2,
    y: box.height / 2,
  })

/** Snap to an absolute scale, about the middle of what is on screen. */
export const zoomTo = (view: Viewport, scale: number, box: Size): Viewport =>
  zoomAbout(view, scale, { x: box.width / 2, y: box.height / 2 })

/**
 * The whole map, as large as it will go.
 *
 * It fills the viewport in both directions, up as well as down: a three-Step
 * workflow is enlarged rather than left small in the middle of the screen,
 * because a control called "fit" that refuses to fill does not do what its name
 * says. The clamp at 400% is the only thing that stops it.
 */
export function fitView(content: Size, box: Size): Viewport {
  const room = { width: box.width - MARGIN * 2, height: box.height - MARGIN * 2 }
  // A box with no room in it — a canvas measured before it is laid out — would
  // otherwise fit to a negative scale and clamp to 10%, leaving the map a speck
  // nobody asked for.
  if (room.width <= 0 || room.height <= 0 || content.width <= 0 || content.height <= 0)
    return UNMOVED
  const scale = clampScale(Math.min(room.width / content.width, room.height / content.height))
  return {
    x: (box.width - content.width * scale) / 2,
    y: (box.height - content.height * scale) / 2,
    scale,
  }
}

/**
 * Where the canvas opens: 100%, the root node centred, the top of the map in
 * view.
 *
 * Fitted was the alternative and was rejected — a large workflow would open at
 * a scale where nothing is readable, and the first thing anybody does is zoom
 * back in. Centred on the **root** rather than on the content box, because the
 * root is where reading starts, and a Fork whose Branches sprawl to one side
 * would otherwise push it off to the other.
 */
export const openingView = (root: { x: number; width: number }, box: Size): Viewport => ({
  x: box.width / 2 - (root.x + root.width / 2),
  y: MARGIN,
  scale: 1,
})

/**
 * Pan until a thing is on screen, and no further.
 *
 * A scroll container brings a focused child into view on its own; a transform
 * inside a clipped box has nothing to scroll. Without this, tabbing to a card
 * off the edge of the map moves focus to something nobody can see, which is
 * most of a large map unreachable without a mouse.
 *
 * Both rectangles are in client coordinates, so the delta is already in the
 * screen pixels `x`/`y` are measured in and nothing is divided by the scale.
 * The minimum move rather than a recentre: a view that jumps every time focus
 * lands somewhere already visible is a view that will not hold still.
 */
export function panInto(view: Viewport, target: Rect, box: Rect, margin = MARGIN): Viewport {
  return {
    ...view,
    x: view.x + shift(target.left, target.right, box.left, box.right, margin),
    y: view.y + shift(target.top, target.bottom, box.top, box.bottom, margin),
  }
}

interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * How far one axis has to move.
 *
 * The near edge wins when the target is larger than the room: showing its start
 * is the useful half of a card too wide to fit, and preferring the far edge
 * would scroll past everything that names it.
 */
function shift(near: number, far: number, from: number, to: number, margin: number): number {
  const low = from + margin
  const high = to - margin
  if (near < low) return low - near
  if (far > high) return Math.max(high - far, low - near)
  return 0
}

/**
 * A wheel's travel in pixels, whatever unit the browser reported.
 *
 * `deltaMode` is lines on some browsers and pages on a few, and the number
 * alongside it is small there: three lines is one notch of a mouse wheel, and
 * reading it as three pixels pans the map by nothing at all and zooms by
 * nothing at all.
 */
export function wheelTravel(
  event: { deltaX: number; deltaY: number; deltaMode: number },
  box: Size,
): { x: number; y: number } {
  // A page is the viewport, and the viewport is not square: each axis is scaled
  // by its own side, or a sideways page-mode wheel pans by the wrong distance.
  if (event.deltaMode === 2) return { x: event.deltaX * box.width, y: event.deltaY * box.height }
  const unit = event.deltaMode === 1 ? LINE : 1
  return { x: event.deltaX * unit, y: event.deltaY * unit }
}

/** A line of text, near enough, for a wheel that counts in them. */
const LINE = 16

/**
 * The wheel travel that multiplies the scale by `e`.
 *
 * Exponential in the travel rather than linear, so a pinch covers the same
 * proportion of the range wherever it starts — the reason `ZOOM.step`
 * multiplies. Large enough that one notch of a mouse wheel, which is 100px of
 * travel in one event, lands near a press of `+` rather than throwing the
 * canvas to the end of the range.
 */
export const WHEEL_ZOOM = 400

/** What one wheel event does to the scale. */
export const wheelScale = (scale: number, travel: number): number =>
  scale * Math.exp(-travel / WHEEL_ZOOM)
