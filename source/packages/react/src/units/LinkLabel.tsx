import type { Point } from '@hatua/layout'
import styles from './LinkLabel.module.css'
import css from './LinkLabel.module.css?inline'

export interface LinkLabelProps {
  at: Point
  /** The word the region is called — `if`, `else`, `loop`, `try`, `on failure`. */
  keyword: string
  /** A Branch's own label, which is free text a user renames. */
  label?: string
  /** A Branch's condition, when it carries one. */
  when?: string
}

/**
 * The word on the line entering a region.
 *
 * **This is what tells regions apart.** A `core.try`'s body, its handler and a
 * loop's body are all stacked under the card that owns them in the same shape —
 * the geometry does not distinguish them and is not meant to. The word does.
 *
 * On the line rather than in a corner of the region, because the line is what
 * carries a reader from the container into the region, and the word names what
 * they are crossing into. `LAYOUT.regionLabel` is the 28px reserved for exactly
 * this, and the handoff sizes it as "one chip's line box".
 *
 * `keyword` comes from `regionsOf` through `Link.label`, so the chip here and
 * the chip `<StepList>` puts over the same region are one string from one
 * function.
 */
export function LinkLabel({ at, keyword, label, when }: LinkLabelProps) {
  return (
    <>
      <style href="hatua-link-label" precedence="hatua">
        {css}
      </style>
      <p className={styles.label} style={{ left: at.x, top: at.y }}>
        <span className={styles.keyword}>{keyword}</span>
        {label ? <span className={styles.text}>{label}</span> : null}
        {when ? <code className={styles.when}>{when}</code> : null}
      </p>
    </>
  )
}
