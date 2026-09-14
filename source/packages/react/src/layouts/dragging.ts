/**
 * The drag payload between the Components tab and the canvas.
 *
 * A private MIME type rather than `text/plain` alone, for the reason the handoff
 * gives a Reference two types: a drop into a Hatua target wants to know what it
 * is being handed, and a drop into any other editor on the page should still
 * paste something meaningful. A card sets both — this one carries the Component,
 * and `text/plain` carries its verb for everyone else.
 *
 * The type is checked on `dragover` and the payload is read on `drop`, because
 * `dataTransfer.getData` returns nothing during `dragover` in every browser —
 * the target may ask *whether* a type is present and not what it holds. So the
 * type has to mean "a Component, and the rest is inside" all by itself.
 */
export const COMPONENT_MIME = 'application/x-hatua-component'

/** Enough to write the Step a dropped card becomes. */
export interface ComponentDrag {
  use: string
  name?: string
}

export const encodeComponent = (drag: ComponentDrag): string => JSON.stringify(drag)

/**
 * What the drop was handed, or `null`.
 *
 * Sceptical rather than cast: the payload is a string on a platform API that any
 * page on the same document can set, so a malformed one is a thing that happens
 * rather than a thing that cannot. A drop that cannot be read adds no Step,
 * which is the same as a drop that missed.
 */
export function decodeComponent(data: string): ComponentDrag | null {
  if (!data) return null
  try {
    const held: unknown = JSON.parse(data)
    if (typeof held !== 'object' || held === null) return null
    const { use, name } = held as Record<string, unknown>
    if (typeof use !== 'string' || use === '') return null
    return typeof name === 'string' && name !== '' ? { use, name } : { use }
  } catch {
    return null
  }
}
