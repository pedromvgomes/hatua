import type { Join } from '@hatua/layout'
import { boxOf } from './box'
import styles from './JoinMarker.module.css'
import css from './JoinMarker.module.css?inline'

export interface JoinMarkerProps {
  join: Join
  /** What converges here, for the sentence a screen reader hears. */
  name: string
}

/**
 * Where a Fork's Branches come back together.
 *
 * The one mark on the map that is neither a card nor a region frame, and the one
 * region that needs one: a Fork's Branches are drawn side by side, so something
 * has to say where the alternatives stop. Every other region is stacked under
 * the card that owns it, and stacking says it already.
 *
 * A pill rather than a rule across the columns. A horizontal line at that width
 * reads as a divider between two parts of the map — which is the opposite of
 * what it means — while a mark the branch lines *arrive at* reads as one place
 * they meet.
 *
 * Not a connector, and nothing to attach to: it marks the end of a set of
 * alternatives, which is a property of the Fork above it rather than a link to
 * whatever is drawn below.
 */
export function JoinMarker({ join, name }: JoinMarkerProps) {
  return (
    <>
      <style href="hatua-join-marker" precedence="hatua">
        {css}
      </style>
      <div className={styles.join} style={boxOf(join)}>
        <span className={styles.pill}>continue</span>
        <span className={styles.offscreen}>{`The branches of ${name} come back together`}</span>
      </div>
    </>
  )
}
