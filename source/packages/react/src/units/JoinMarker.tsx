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
 * The one mark on the map that is not a card or a region frame, and the one
 * region that needs one: a Fork's Branches are drawn side by side, so something
 * has to say where the alternatives stop. Every other region is stacked under
 * the card that owns it, and stacking says it already.
 *
 * Not a connector. There is no edge here to attach anything to and no Step it
 * joins *to* — it marks the end of a set of alternatives, which is a property of
 * the Fork above it rather than a link to whatever is drawn below.
 */
export function JoinMarker({ join, name }: JoinMarkerProps) {
  return (
    <>
      <style href="hatua-join-marker" precedence="hatua">
        {css}
      </style>
      <div className={styles.join} style={boxOf(join)}>
        <span className={styles.rule} />
        <span className={styles.offscreen}>{`The branches of ${name} come back together`}</span>
      </div>
    </>
  )
}
