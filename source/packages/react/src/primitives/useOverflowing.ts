import { type RefObject, useCallback, useEffect, useState } from 'react'

/**
 * Whether an element is showing less than it holds.
 *
 * Watched rather than measured once: the answer changes when the value changes,
 * when the column is resized, and when a font finally loads — and every one of
 * those happens after the render that would have measured it.
 *
 * Two effects, because there are two ways for it to change. Re-rendering is one
 * and needs no dependency to name it — there is no value to list, the content
 * simply is what it is after the render — so that one measures every time and
 * publishes only on a change, which is what keeps it from being a loop. The
 * other is the box itself changing size with the content untouched, which only
 * a `ResizeObserver` hears.
 *
 * `scrollWidth > clientWidth` is the whole test, and it is exact for anything
 * that lays its own content out — which a `<select>` does not. See
 * `useTextOverflowing`, which is what that control needs instead.
 */
export function useOverflowing(ref: RefObject<HTMLElement | null>): boolean {
  const [overflowing, setOverflowing] = useState(false)

  // The one pixel of slack is sub-pixel layout: a box whose content is the same
  // width as itself reports a scrollWidth a fraction larger often enough to
  // offer a tooltip over nothing.
  const measure = useCallback(() => {
    const element = ref.current
    if (element) setOverflowing(element.scrollWidth > element.clientWidth + 1)
  }, [ref])

  useEffect(measure)

  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, measure])

  return overflowing
}

/**
 * The same question for a control whose content the platform draws.
 *
 * A `<select>` reports `scrollWidth === clientWidth` however long the selected
 * option is: the closed box is chrome, and the text inside it is not laid out
 * as content the element can measure. Measured on a real one, an option more
 * than twice the width of its box reported 238 against 238 — so a check that
 * trusted `scrollWidth` there would never fire once, which is worse than not
 * offering the tooltip at all, because the prop says it did.
 *
 * So the text is measured directly, in the element's own font, against the room
 * inside its padding. A canvas rather than a hidden span: no layout, nothing
 * added to the document, and nothing that can inherit a style the real control
 * does not have.
 */
export function useTextOverflowing(ref: RefObject<HTMLElement | null>, text: string): boolean {
  const [overflowing, setOverflowing] = useState(false)

  const measure = useCallback(() => {
    const element = ref.current
    if (!element) return

    const style = getComputedStyle(element)
    const room =
      element.clientWidth -
      Number.parseFloat(style.paddingInlineStart || '0') -
      Number.parseFloat(style.paddingInlineEnd || '0')

    const width = textWidth(text, style)
    // Unmeasurable — no canvas, as in a test environment — offers nothing
    // rather than guessing.
    setOverflowing(width !== null && width > room + 1)
  }, [ref, text])

  useEffect(measure)

  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, measure])

  return overflowing
}

/** One canvas for the life of the page: making one per measurement is a leak. */
let ruler: CanvasRenderingContext2D | null | undefined

function textWidth(text: string, style: CSSStyleDeclaration): number | null {
  if (ruler === undefined) {
    ruler =
      typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  }
  if (!ruler) return null

  ruler.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  return ruler.measureText(text).width
}
