import type { Band } from '@hatua/layout'
import { cx } from '../primitives/classNames'
import { boxOf } from './box'
import styles from './RegionBand.module.css'
import css from './RegionBand.module.css?inline'

export interface RegionBandProps {
  band: Band
}

/**
 * The extent of one child region: a frame around everything inside it.
 *
 * **The frame is not what names the region** — that is the chip on the line
 * entering it (`<LinkLabel>`), where a reader is already looking. What the frame
 * carries is depth: how far a container's contents reach, and which cards belong
 * to which of a `core.try`'s two regions when both are stacked on one spine.
 * A line into a region says where it starts; only a box says where it stops.
 *
 * So it is deliberately quiet — no text, no fill of its own beyond a wash, and
 * no pointer. Two things saying the same word over one region would be the
 * duplication this repo refuses everywhere else; the frame says the thing the
 * word cannot.
 *
 * Its box is the whole region, `LAYOUT.regionLabel` and all: the strip at the
 * top is the room the entering chip sits in, so the frame starts above the chip
 * rather than under it.
 */
export function RegionBand({ band }: RegionBandProps) {
  return (
    <>
      <style href="hatua-region-band" precedence="hatua">
        {css}
      </style>
      <div className={cx(styles.band, styles[band.kind])} style={boxOf(band)} aria-hidden="true" />
    </>
  )
}
