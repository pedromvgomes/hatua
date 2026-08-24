import type { Rect } from '@hatua/layout'
import type { CSSProperties } from 'react'

/**
 * A `Rect` from `@hatua/layout` as the style that puts a box where it says.
 *
 * `left` and `top` rather than `inset-inline-start` and `inset-block-start`,
 * which is the opposite of what this repo's stylesheets do everywhere else. The
 * coordinates are physical by definition — "flow-map coordinates with the origin
 * at the top left" — and a logical property would mirror the whole map under an
 * RTL Host while the numbers behind it stayed the same, so a Fork's first Branch
 * would be drawn last and the reading order the layout encodes would be
 * reversed. Mirroring a map is a decision about the map, not about the box.
 *
 * Minted here rather than at each unit so the four things drawn on the canvas
 * cannot pick two conventions and sit a pixel apart.
 */
export const boxOf = (rect: Rect): CSSProperties => ({
  position: 'absolute',
  left: rect.x,
  top: rect.y,
  width: rect.width,
  height: rect.height,
})
