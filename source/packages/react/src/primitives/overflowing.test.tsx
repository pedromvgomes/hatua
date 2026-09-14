import { act, render, screen } from '@testing-library/react'
import { useLayoutEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useOverflowing, useTextOverflowing } from './useOverflowing'

/**
 * The two overflow questions, asked where the box has a size and the text has a
 * width — neither of which jsdom supplies on its own.
 *
 * So both are stood up here: the element reports the widths a browser would have
 * laid out, and the ruler measures ten pixels per character. What that buys is
 * the half of these hooks that layout decides — the answer flipping when the box
 * gets narrower, and the slack that keeps a box exactly as wide as its content
 * from offering a tooltip over nothing.
 */

/** The widths a browser would have laid out, which jsdom reports as zero. */
const sized = (node: HTMLElement | null, client: number, scroll: number) => {
  if (!node) return
  Object.defineProperty(node, 'clientWidth', { value: client, configurable: true })
  Object.defineProperty(node, 'scrollWidth', { value: scroll, configurable: true })
}

/**
 * The size is written in a layout effect, which runs before the passive effect
 * the hook measures in — so the first measurement already sees a laid-out box.
 */
const Box = ({ client, scroll }: { client: number; scroll: number }) => {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    sized(ref.current, client, scroll)
  }, [client, scroll])
  const overflowing = useOverflowing(ref)
  return (
    <div ref={ref} data-overflowing={String(overflowing)}>
      box
    </div>
  )
}

const Label = ({ text, room }: { text: string; room: number }) => {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    sized(ref.current, room, room)
  }, [room])
  const overflowing = useTextOverflowing(ref, text)
  return (
    <span ref={ref} data-overflowing={String(overflowing)}>
      label
    </span>
  )
}

/** Every observer made while a test runs, so a resize can be delivered. */
const observing: (() => void)[] = []

class TestResizeObserver {
  private readonly callback: () => void

  constructor(callback: () => void) {
    this.callback = callback
    observing.push(callback)
  }

  observe() {}
  unobserve() {}
  disconnect() {
    const at = observing.indexOf(this.callback)
    if (at >= 0) observing.splice(at, 1)
  }
}

/** A box that changed size with its content untouched: only the observer hears. */
const resize = (node: HTMLElement, client: number, scroll: number) => {
  sized(node, client, scroll)
  act(() => {
    for (const callback of [...observing]) callback()
  })
}

const savedObserver = globalThis.ResizeObserver
const savedContext = HTMLCanvasElement.prototype.getContext

beforeEach(() => {
  observing.length = 0
  globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver
  // Ten pixels a character, in place of a real font: what is being checked is
  // that the text is measured at all, not how wide any glyph is.
  HTMLCanvasElement.prototype.getContext = (() => ({
    font: '',
    measureText: (text: string) => ({ width: text.length * 10 }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

afterEach(() => {
  globalThis.ResizeObserver = savedObserver
  HTMLCanvasElement.prototype.getContext = savedContext
})

describe('useOverflowing', () => {
  it('reports a box showing less than it holds', () => {
    render(<Box client={100} scroll={260} />)
    expect(screen.getByText('box').getAttribute('data-overflowing')).toBe('true')
  })

  it('leaves a pixel of slack, so sub-pixel layout does not offer a tooltip over nothing', () => {
    // A box whose content is exactly as wide as itself reports a scrollWidth a
    // fraction larger often enough to matter.
    render(<Box client={100} scroll={101} />)
    expect(screen.getByText('box').getAttribute('data-overflowing')).toBe('false')
  })

  it('answers again when the column is resized and the content is untouched', () => {
    render(<Box client={300} scroll={260} />)
    const node = screen.getByText('box')
    expect(node.getAttribute('data-overflowing')).toBe('false')

    // Nothing re-renders on a resize, so an answer measured once would stand
    // while the text it described was being cut off.
    resize(node, 100, 260)
    expect(node.getAttribute('data-overflowing')).toBe('true')
  })

  it('stops listening when the element goes', () => {
    const view = render(<Box client={100} scroll={260} />)
    expect(observing).toHaveLength(1)

    // An observer left attached measures an element React has taken down, and
    // sets state on a component that is gone.
    view.unmount()
    expect(observing).toHaveLength(0)
  })
})

describe('the same question for a control the platform draws', () => {
  it('measures the text itself, because the control reports no overflow of its own', () => {
    // A `<select>` reports scrollWidth === clientWidth however long the chosen
    // option is: the closed box is chrome, and the text inside it is not laid
    // out as content the element can measure.
    render(<Label text="component.email.fetch" room={100} />)
    expect(screen.getByText('label').getAttribute('data-overflowing')).toBe('true')
  })

  it('says nothing about text that fits the room inside the padding', () => {
    render(<Label text="Send" room={100} />)
    expect(screen.getByText('label').getAttribute('data-overflowing')).toBe('false')
  })

  it('answers again when the chosen option changes, with the box the same size', () => {
    const view = render(<Label text="Send" room={100} />)
    expect(screen.getByText('label').getAttribute('data-overflowing')).toBe('false')

    view.rerender(<Label text="component.email.fetch" room={100} />)
    expect(screen.getByText('label').getAttribute('data-overflowing')).toBe('true')
  })

  it('stops listening when the element goes', () => {
    const view = render(<Label text="Send" room={100} />)
    expect(observing).toHaveLength(1)

    view.unmount()
    expect(observing).toHaveLength(0)
  })
})
