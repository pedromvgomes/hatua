import type { Nest } from '@hatua/layout'
import { boxOf } from './box'
import styles from './RegionNest.module.css'
import css from './RegionNest.module.css?inline'

export interface RegionNestProps {
  nest: Nest
}

/**
 * One container Step's regions taken together: the frame everything it owns
 * sits inside.
 *
 * Two extents rather than one, because a `core.try` owns two regions and only
 * one of them is protected — a single frame would claim either the handler,
 * which is not, or only the body, which leaves the handler outside the Step
 * that owns it. Every container gets the same shape at every arity, which is
 * what stops a Fork being a special one: a loop is one `<RegionBand>` in here,
 * a try two, a Fork *n* over the mark where they converge.
 *
 * **Nothing is drawn between the card and this.** The card sits astride its own
 * Nest — the top edge crosses it `LAYOUT.nodeLid` below the card's top — so
 * containment reads as *overlap*, which no other relationship on this map uses.
 * A line would say "then", which is what every other line here says, and a Step
 * does not run after its own body.
 *
 * It names nothing. The words belong to the Bands inside it, one per region;
 * a word here would be a second thing saying what the container is, next to the
 * card that already says it.
 */
export function RegionNest({ nest }: RegionNestProps) {
  return (
    <>
      <style href="hatua-region-nest" precedence="hatua">
        {css}
      </style>
      <div className={styles.nest} style={boxOf(nest)} aria-hidden="true" />
    </>
  )
}
