import type { Band } from '@hatua/layout'
import { cx } from '../primitives/classNames'
import { boxOf } from './box'
import styles from './RegionBand.module.css'
import css from './RegionBand.module.css?inline'

export interface RegionBandProps {
  band: Band
  /**
   * The name of the Step this region hangs under, for the sentence a screen
   * reader hears.
   *
   * A keyword alone does not name a region. Two `core.try` Steps on one Board
   * give a screen reader two buttons both called "on failure", with nothing
   * saying which Step each one folds — and `<JoinMarker>` and the `+` on every
   * gap both name their owner already.
   */
  owner: string
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
 *
 * **An empty column offers no control at all**, because there is nothing behind
 * it to fold. Left as a button it produces a third box that is neither of the
 * two the count exists to separate: one reading "0 steps", with the `+` gone
 * and nothing at all to be done with the region. `@hatua/layout` refuses the
 * same fold from the other side, so a `collapsedRegions` that names an empty
 * region — a Host's, or one whose last Step was deleted after it was folded —
 * cannot produce it either.
 */
export function RegionBand({
  band,
  owner,
  label,
  when,
  count = 0,
  dashed,
  onToggle,
}: RegionBandProps) {
  const foldable = count > 0
  const word = (
    <>
      {/*
        The chevron's box is reserved whether or not there is anything to fold,
        so a word is the same distance from its frame's left edge either way.
        Dropped outright, an empty column's word sits where a foldable sibling's
        chevron is — and a Band's legend is flush left precisely so the
        alignment says how deep the region is and nothing else.
      */}
      <span
        className={cx(styles.chevron, band.collapsed && styles.shut, !foldable && styles.blank)}
        aria-hidden="true"
      >
        {/*
          Drawn rather than typed. A Host chooses the face this renders in, and
          a triangle is not in every one of them — the theme's own draws `▾` at
          four pixels wide, which is a mark nobody can see. It turns to point at
          a folded column instead of swapping for a second character, so the two
          states are one shape at two angles.
        */}
        <svg viewBox="0 0 8 8" width="8" height="8" focusable="false" aria-hidden="true">
          <path
            d="M1.5 3 4 5.5 6.5 3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className={styles.keyword}>{band.keyword}</span>
      {label ? <span className={styles.text}>{label}</span> : null}
      {when ? <code className={styles.when}>{when}</code> : null}
    </>
  )

  /*
   * The visible words plus the Step they belong to.
   *
   * Spelled out rather than left to the browser to assemble from the spans:
   * whether a space appears between two adjacent inline elements in an
   * accessible name is the engine's decision, so a legend read as "on failurein
   * Publish the digest" on one and correctly on another is not a difference to
   * leave to chance. Every visible word is in it and in the order it is drawn,
   * which is what a control's name owes anyone driving it by voice.
   *
   * The owner is not drawn: the card the region hangs under says it on screen
   * already, and repeating it over every column would be the duplication the
   * legend exists to remove.
   */
  const named = [band.keyword, label, when, `in ${owner}`].filter(Boolean).join(' ')

  return (
    <>
      <style href="hatua-region-band" precedence="hatua">
        {css}
      </style>
      <div
        className={cx(styles.band, styles[band.kind], dashed ? styles.dashed : undefined)}
        style={boxOf(band)}
      >
        {foldable ? (
          <button
            type="button"
            className={styles.legend}
            aria-label={named}
            aria-expanded={!band.collapsed}
            onClick={onToggle}
          >
            {word}
          </button>
        ) : (
          <p className={cx(styles.legend, styles.still)}>{word}</p>
        )}
        {band.collapsed ? (
          <p className={styles.folded}>{count === 1 ? '1 step' : `${count} steps`}</p>
        ) : null}
      </div>
    </>
  )
}
