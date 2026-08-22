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
 * that lays its own content out. A `<select>` is the one control it can only
 * approximate, because the closed box is drawn by the platform and its
 * `scrollWidth` does not always account for the option inside; a miss there
 * costs a tooltip nobody was offered, never a wrong one.
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
