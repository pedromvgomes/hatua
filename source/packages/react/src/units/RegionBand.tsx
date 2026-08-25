import type { Band } from '@hatua/layout'
import { cx } from '../primitives/classNames'
import { boxOf } from './box'
import styles from './RegionBand.module.css'
import css from './RegionBand.module.css?inline'

export interface RegionBandProps {
  band: Band
  /** A Branch's own label, which is free text a user renames. */
  label?: string
  /** A Branch's condition, when it carries one. */
  when?: string
}

/**
 * One child region: a drawn frame around everything in it, with the word that
 * names it over its top edge.
 *
 * **A region is an edge, not a wash.** A hairline over a 22%-opacity fill is
 * invisible against the canvas, and an invisible extent says nothing: nesting
 * reads as one smudge, and a `+` belongs to no list anybody can see. Two of them
 * 64px apart on one spine — the last gap of a loop's body and the next gap of
 * the try holding it — are then two circles with nothing between them, which
 * reads as a rendering fault rather than as two different places to insert.
 * `<StepList>` reached the same defect and fixed it the same way, with an indent
 * guide and trailing padding, because nothing on screen said where a nested list
 * ended.
 *
 * **The word sits above the top edge, flush with its left.** Not straddling it:
 * a legend on a border has to mask the line behind it, and a translucent fill
 * has no one colour to mask with, so the border reads straight through the word.
 * Flush left rather than centred because a Band is inset from whatever holds it,
 * so the words staircase with depth and the alignment itself says how deep a
 * region is — centred, every word on a column of nested regions lands at nearly
 * the same x and encodes nothing.
 *
 * There is exactly one thing saying one word over one region, and this is it.
 * `LAYOUT.regionLabel` is the room reserved above the band for it, so the legend
 * has somewhere to go without overlapping the card above.
 *
 * `keyword` comes from `regionsOf` through `Band`, so the word here and the chip
 * `<StepList>` puts over the same region are one string from one function.
 */
export function RegionBand({ band, label, when }: RegionBandProps) {
  return (
    <>
      <style href="hatua-region-band" precedence="hatua">
        {css}
      </style>
      <div className={cx(styles.band, styles[band.kind])} style={boxOf(band)}>
        <p className={styles.legend}>
          <span className={styles.keyword}>{band.keyword}</span>
          {label ? <span className={styles.text}>{label}</span> : null}
          {when ? <code className={styles.when}>{when}</code> : null}
        </p>
      </div>
    </>
  )
}
