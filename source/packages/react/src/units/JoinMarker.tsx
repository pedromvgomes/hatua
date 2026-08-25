import type { Join } from '@hatua/layout'
import { boxOf } from './box'
import styles from './JoinMarker.module.css'
import css from './JoinMarker.module.css?inline'

export interface JoinMarkerProps {
  join: Join
  /** The Step whose columns converge here, for the sentence a screen reader hears. */
  name: string
}

/**
 * Where a Step's sibling columns come back together.
 *
 * The one mark on the map that is neither a card nor a region frame. A Step's
 * and not a Fork's: columns are drawn side by side, so something has to say
 * where they stop, which is a fact about columns and not about forking — and
 * flow resumes below a `core.try` whether its body finished or its handler ran
 * (ADR-0015). A lone column gets none, because its Band's bottom edge already
 * says where it ends.
 *
 * A pill rather than a rule across the columns. A horizontal line at that width
 * reads as a divider between two parts of the map — which is the opposite of
 * what it means — while a mark the lines *arrive at* reads as one place they
 * meet.
 *
 * Not a connector, and nothing to attach to: it marks where a set of
 * alternatives ends, which is a property of the Step above it rather than a
 * link to whatever is drawn below.
 */
export function JoinMarker({ join, name }: JoinMarkerProps) {
  return (
    <>
      <style href="hatua-join-marker" precedence="hatua">
        {css}
      </style>
      <div className={styles.join} style={boxOf(join)}>
        <span className={styles.pill}>continue</span>
        <span className={styles.offscreen}>{`The regions of ${name} come back together`}</span>
      </div>
    </>
  )
}
