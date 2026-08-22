import { afterEach, describe, expect, it } from 'vitest'
import { place } from './placement'

/**
 * The rule this exists to state once: flip when there is less room below AND
 * more above, never on a threshold alone. A fixed threshold flipped a panel
 * above a button with 460px of space beneath it and ran it off the top.
 */
const screen = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
}

afterEach(() => screen(1024, 768))

describe('place', () => {
  it('hangs below when there is room, and reports what there is', () => {
    screen(1024, 768)
    const at = place({ left: 100, top: 80, bottom: 120 }, 392)
    expect(at.top).toBe(126)
    expect(at.bottom).toBeUndefined()
    expect(at.flipped).toBe(false)
    expect(at.space).toBe(768 - 120 - 12)
  })

  it('flips above when below is tight and above is roomier', () => {
    screen(1024, 400)
    const at = place({ left: 100, top: 300, bottom: 340 }, 392)
    expect(at.flipped).toBe(true)
    expect(at.bottom).toBe(400 - 300 + 6)
    expect(at.top).toBeUndefined()
    expect(at.space).toBe(300 - 12)
  })

  /*
   * The failure the rule is written against: plenty of room below, and a
   * threshold alone would still have turned it over.
   */
  it('stays below when there is more room there, however little that is', () => {
    screen(1024, 500)
    const at = place({ left: 100, top: 40, bottom: 80 }, 392)
    expect(at.flipped).toBe(false)
  })

  it('does not flip into even less room', () => {
    screen(1024, 300)
    // 150 below, 88 above: tight, and turning over makes it worse.
    const at = place({ left: 100, top: 100, bottom: 138 }, 392)
    expect(at.flipped).toBe(false)
  })

  it('clamps to the window rather than hanging off the side', () => {
    screen(500, 768)
    expect(place({ left: 480, top: 10, bottom: 40 }, 392).left).toBe(500 - 392 - 12)
    expect(place({ left: -40, top: 10, bottom: 40 }, 392).left).toBe(12)
  })

  it('never reports negative room', () => {
    screen(1024, 100)
    expect(place({ left: 0, top: 90, bottom: 200 }, 392).space).toBeGreaterThanOrEqual(0)
  })

  /* It renders on a server too (ADR-0003), where there is no window to ask. */
  it('answers where there is no window at all', () => {
    const saved = globalThis.window
    // @ts-expect-error — deleting the global is the whole point of the check.
    globalThis.window = undefined
    try {
      // The assumed window, and the margin still holds it off the edge.
      expect(place({ left: 10, top: 10, bottom: 40 }, 392).left).toBe(12)
      expect(place({ left: 400, top: 10, bottom: 40 }, 392).left).toBe(400)
    } finally {
      globalThis.window = saved
    }
  })
})
