import { describe, expect, it } from 'vitest'
import {
  clampScale,
  fitView,
  MARGIN,
  openingView,
  panInto,
  usable,
  type Viewport,
  wheelScale,
  wheelTravel,
  ZOOM,
  zoomAbout,
  zoomTo,
} from './viewport'

/**
 * The arithmetic behind the canvas's pan and zoom (ADR-0016).
 *
 * It is a module rather than a handful of expressions inside the component for
 * this suite's sake: jsdom has no layout engine, so a viewport worked out from
 * measurements taken in a render is a number no test can see. Here every input
 * is a plain box.
 */

const box = { width: 800, height: 600 }
const at100: Viewport = { x: 0, y: 0, scale: 1 }

/** Where a point on the surface lands on screen, which is what the transform does. */
const onScreen = (view: Viewport, point: { x: number; y: number }) => ({
  x: view.x + point.x * view.scale,
  y: view.y + point.y * view.scale,
})

describe('clampScale', () => {
  it('holds the range at both ends', () => {
    expect(clampScale(0.001)).toBe(ZOOM.min)
    expect(clampScale(40)).toBe(ZOOM.max)
    expect(clampScale(0.83)).toBe(0.83)
  })
})

describe('zoomAbout', () => {
  it('leaves whatever is under the pointer under the pointer', () => {
    const view = { x: -120, y: -300, scale: 1.5 }
    const pointer = { x: 340, y: 210 }
    // The surface point currently under the pointer, from the transform itself.
    const surface = { x: (pointer.x - view.x) / view.scale, y: (pointer.y - view.y) / view.scale }

    const zoomed = zoomAbout(view, 3, pointer)

    expect(zoomed.scale).toBe(3)
    expect(onScreen(zoomed, surface).x).toBeCloseTo(pointer.x, 6)
    expect(onScreen(zoomed, surface).y).toBeCloseTo(pointer.y, 6)
  })

  it('anchors on the pointer even at the end of the range, where the scale barely moves', () => {
    const view = { x: 0, y: 0, scale: ZOOM.max }
    const zoomed = zoomAbout(view, 10, { x: 400, y: 300 })
    expect(zoomed.scale).toBe(ZOOM.max)
    expect(zoomed).toEqual(view)
  })
})

describe('zoomTo', () => {
  it('snaps to exactly the level asked for, about the middle of the screen', () => {
    const view = { x: -50, y: -80, scale: 0.83 }
    const snapped = zoomTo(view, 1, box)

    // Exactly 1, not 0.83 stepped towards it: the menu is the way back to a
    // known state after free-form zooming.
    expect(snapped.scale).toBe(1)
    const centre = {
      x: (box.width / 2 - view.x) / view.scale,
      y: (box.height / 2 - view.y) / view.scale,
    }
    expect(onScreen(snapped, centre).x).toBeCloseTo(box.width / 2, 6)
  })
})

describe('fitView', () => {
  it('enlarges a small map to fill the viewport rather than leaving it small', () => {
    const fitted = fitView({ width: 200, height: 100 }, box)
    expect(fitted.scale).toBeGreaterThan(1)
    // The tighter axis is the one that decides.
    expect(fitted.scale).toBeCloseTo((box.width - MARGIN * 2) / 200, 6)
  })

  it('shrinks a map larger than the viewport, and centres what it drew', () => {
    const content = { width: 4000, height: 3000 }
    const fitted = fitView(content, box)

    expect(fitted.scale).toBeCloseTo((box.height - MARGIN * 2) / content.height, 6)
    expect(fitted.x + (content.width * fitted.scale) / 2).toBeCloseTo(box.width / 2, 6)
    expect(fitted.y + (content.height * fitted.scale) / 2).toBeCloseTo(box.height / 2, 6)
  })

  it('leaves the view alone when there is no room to fit into', () => {
    // A canvas measured before it is laid out. Fitting to a negative box lands
    // on the bottom of the range, which is the map as a speck nobody asked for.
    expect(fitView({ width: 400, height: 400 }, { width: 0, height: 0 })).toEqual(at100)
  })
})

describe('openingView', () => {
  it('opens at 100% with the root centred and the top of the map in view', () => {
    const root = { x: 900, width: 200 }
    const opened = openingView(root, box)

    expect(opened.scale).toBe(1)
    expect(opened.y).toBe(MARGIN)
    expect(onScreen(opened, { x: root.x + root.width / 2, y: 0 }).x).toBeCloseTo(box.width / 2, 6)
  })
})

describe('panInto', () => {
  const view: Viewport = { x: 10, y: 20, scale: 1 }
  const frame = { left: 0, right: 800, top: 0, bottom: 600 }
  const rect = (left: number, top: number, width = 100, height = 40) => ({
    left,
    right: left + width,
    top,
    bottom: top + height,
  })

  it('does not move for something already on screen', () => {
    expect(panInto(view, rect(300, 300), frame)).toEqual(view)
  })

  it('brings something off the near edge back, to the margin and no further', () => {
    const panned = panInto(view, rect(-60, -30), frame)
    expect(panned.x).toBe(view.x + MARGIN + 60)
    expect(panned.y).toBe(view.y + MARGIN + 30)
    expect(panned.scale).toBe(view.scale)
  })

  it('brings something off the far edge back', () => {
    const panned = panInto(view, rect(780, 590), frame)
    expect(panned.x).toBe(view.x - (880 - (800 - MARGIN)))
    expect(panned.y).toBe(view.y - (630 - (600 - MARGIN)))
  })

  it('shows the start of a thing too large to fit, rather than its end', () => {
    // A card wider than the room has no position that satisfies both edges. Its
    // start is the half that names it.
    const panned = panInto(view, rect(-10, 100, 2000, 40), frame)
    expect(panned.x).toBe(view.x + MARGIN + 10)
  })
})

describe('wheelTravel', () => {
  it('reads a pixel wheel as it stands', () => {
    expect(wheelTravel({ deltaX: 12, deltaY: -40, deltaMode: 0 }, box)).toEqual({ x: 12, y: -40 })
  })

  it('reads a wheel counted in lines and in pages as pixels', () => {
    // Three lines is one notch on the browsers that report them, and taking it
    // for three pixels pans the map by nothing at all.
    expect(wheelTravel({ deltaX: 0, deltaY: 3, deltaMode: 1 }, box).y).toBeGreaterThan(24)
    expect(wheelTravel({ deltaX: 0, deltaY: 1, deltaMode: 2 }, box).y).toBe(box.height)
  })

  it('scales each axis of a page by its own side, because a viewport is not square', () => {
    expect(wheelTravel({ deltaX: 1, deltaY: 1, deltaMode: 2 }, box)).toEqual({
      x: box.width,
      y: box.height,
    })
  })
})

describe('wheelScale', () => {
  it('keeps one notch of a mouse wheel near one press of the button', () => {
    // A notch is 100px of travel in a single event. Exponential in the travel,
    // so the same notch covers the same proportion of the range at either end.
    const notch = wheelScale(1, -100) - 1
    expect(notch).toBeGreaterThan(ZOOM.step - 1 - 0.1)
    expect(notch).toBeLessThan(ZOOM.step - 1 + 0.1)
  })

  it('is symmetric: out then in returns to where it started', () => {
    expect(wheelScale(wheelScale(0.83, 120), -120)).toBeCloseTo(0.83, 9)
  })
})

describe('a viewport a Host supplied', () => {
  it('clamps a scale outside the range rather than discarding the pan', () => {
    expect(usable({ x: 40, y: 10, scale: 99 })).toEqual({ x: 40, y: 10, scale: ZOOM.max })
    expect(usable({ x: 40, y: 10, scale: 0.001 })).toEqual({ x: 40, y: 10, scale: ZOOM.min })
  })

  it('clamps a zero rather than refusing it, because the pan is still a pan', () => {
    // `zoomAbout` divides by the scale it is given, so a 0 makes the next wheel
    // event translate the surface by `Infinitypx` — the canvas is gone, with
    // nothing on screen saying why. A clamped 0 keeps where the Host was
    // looking and loses only a scale that could not be rendered anyway.
    expect(usable({ x: 40, y: 10, scale: 0 })).toEqual({ x: 40, y: 10, scale: ZOOM.min })
  })

  it('refuses one that is not a finite viewport at all', () => {
    // Nothing in it to keep: a clamp cannot rescue a coordinate that is not a
    // number, and every later gesture builds on what this returns.
    expect(usable({ x: 0, y: 0, scale: Number.NaN })).toBeNull()
    expect(usable({ x: Number.POSITIVE_INFINITY, y: 0, scale: 1 })).toBeNull()
    expect(usable(null)).toBeNull()
  })

  it('is what the canvas would otherwise build an Infinity on', () => {
    // The defect stated as the arithmetic that produced it.
    expect(zoomAbout({ x: 0, y: 0, scale: 0 }, 1.2, { x: 100, y: 50 }).x).toBe(
      Number.NEGATIVE_INFINITY,
    )
    const held = usable({ x: 0, y: 0, scale: 0 })
    expect(held).not.toBeNull()
    expect(Number.isFinite(zoomAbout(held as Viewport, 1.2, { x: 100, y: 50 }).x)).toBe(true)
  })
})
