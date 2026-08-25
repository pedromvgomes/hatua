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
  /** How many Steps the region holds, for the count a folded box carries. */
  count?: number
  /**
   * Whether the edge is dashed.
   *
   * The canvas's decision and not this unit's, because it is a question about
   * the Step's *other* regions — whether this one has a solid sibling to be read
   * against — and a Band can see only itself.
   */
  dashed?: boolean
  /** Folds this column shut, or opens it. */
  onToggle?: () => void
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
 *
 * ## The word is also the control that folds the column
 *
 * Collapse is per region rather than per Step, because a wide Fork has the
 * problem a big `core.try` has (ADR-0015) — and the one thing on screen that
 * already names this column and nothing else is its legend. A separate control
 * would be a second mark over one region, which is the duplication the legend
 * exists to remove.
 *
 * A folded column says how many Steps it is holding back, because a box that
 * says nothing is indistinguishable from an empty one — and the two mean
 * opposite things. An empty one needs no such text: it carries the `+` that is
 * the only way to fill it, which comes from its link.
 */
export function RegionBand({ band, label, when, count = 0, dashed, onToggle }: RegionBandProps) {
  return (
    <>
      <style href="hatua-region-band" precedence="hatua">
        {css}
      </style>
      <div
        className={cx(styles.band, styles[band.kind], dashed ? styles.dashed : undefined)}
        style={boxOf(band)}
      >
        <button
          type="button"
          className={styles.legend}
          aria-expanded={!band.collapsed}
          onClick={onToggle}
        >
          <span className={styles.chevron} aria-hidden="true">
            {band.collapsed ? '▸' : '▾'}
          </span>
          <span className={styles.keyword}>{band.keyword}</span>
          {label ? <span className={styles.text}>{label}</span> : null}
          {when ? <code className={styles.when}>{when}</code> : null}
        </button>
        {band.collapsed ? (
          <p className={styles.folded}>{count === 1 ? '1 step' : `${count} steps`}</p>
        ) : null}
      </div>
    </>
  )
}
