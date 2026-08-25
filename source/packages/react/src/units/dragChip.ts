/**
 * The image a drag carries, for every drag source that lands on the canvas.
 *
 * A drag ghost is the source element by default — a whole 236px card, or a whole
 * catalogue row — centred under the pointer. On this map the thing being aimed
 * at is a 20px `+` on a line, so the ghost covers the target it is being carried
 * to and the only pixels that survive above it are the cursor's own. That is why
 * a Component out of the catalogue looked like the one that worked: `copy` draws
 * a platform badge and `move` draws nothing, so the badge was the whole of the
 * feedback, and only one of the two gestures had it.
 *
 * One chip for both sources, so the two gestures look alike and neither hides
 * where it is going. Small enough that the gap under it stays visible, and
 * offset down and right of the pointer so the pointer itself is never inside it.
 *
 * Its colours are read off the element being dragged rather than written here.
 * The chip is built outside React and lives outside the provider, so it inherits
 * none of the theme's custom properties — reading the source's resolved style is
 * what keeps it the same colour as the thing it stands for under a Host's light
 * theme and its dark one alike.
 */

/** How far down and right of the pointer the chip sits. */
const CHIP_OFFSET = 14

/**
 * Off-screen, because the browser rasterises the element where it stands and a
 * chip parked in the corner of the viewport is a flash every drag begins with.
 */
const PARKED = -2000

export function setDragChip(transfer: DataTransfer, source: HTMLElement, label: string): void {
  // `setDragImage` is absent wherever there is no drag to draw — a server render
  // (ADR-0003), or a transfer a test constructs. Nothing is lost by not drawing
  // an image nobody can see, and the drag still carries its data.
  if (typeof transfer.setDragImage !== 'function') return

  const doc = source.ownerDocument
  const from = doc.defaultView?.getComputedStyle(source)
  const chip = doc.createElement('div')
  chip.textContent = label
  chip.style.cssText = [
    'position: fixed',
    `top: ${PARKED}px`,
    `left: ${PARKED}px`,
    'box-sizing: border-box',
    'max-inline-size: 180px',
    'overflow: hidden',
    'white-space: nowrap',
    'text-overflow: ellipsis',
    'padding: 6px 10px',
    'border-radius: 8px',
    'font-size: 12px',
    'font-weight: 500',
    'line-height: 1.4',
    'pointer-events: none',
    `background: ${from?.backgroundColor || '#fff'}`,
    `color: ${from?.color || '#000'}`,
    `border: 1px solid ${from?.borderTopColor || 'transparent'}`,
    `font-family: ${from?.fontFamily || 'inherit'}`,
    'box-shadow: 0 4px 12px rgb(0 0 0 / 0.18)',
  ].join(';')

  doc.body.appendChild(chip)
  // Negative offsets put the pointer outside the image, up and to its left, so
  // the chip trails the cursor rather than sitting under it.
  transfer.setDragImage(chip, -CHIP_OFFSET, -CHIP_OFFSET)

  // The browser rasterises the image during this event and never reads the
  // element again, so it comes out of the document on the next frame. Left in,
  // every drag would leak one node.
  requestAnimationFrame(() => chip.remove())
}
