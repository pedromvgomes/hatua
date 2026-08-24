import { type Band, LAYOUT } from '@hatua/layout'
import { cx } from '../primitives/classNames'
import { boxOf } from './box'
import styles from './RegionBand.module.css'
import css from './RegionBand.module.css?inline'

export interface RegionBandProps {
  band: Band
  /**
   * The Branch's own label, when this band is one. Free text a user renames,
   * beside the keyword the fork's shape decides — the same pair `<StepList>`
   * puts in a Branch header.
   */
  label?: string
  /** The Branch's condition, when it carries one. */
  when?: string
}

/**
 * A container's child region: the word over it, and the frame around it.
 *
 * **The band is what tells regions apart**, which is why every child region gets
 * one and none of them is told apart by its geometry. A `core.try`'s body and
 * its handler are stacked one above the other in the same shape, and so is a
 * loop's body; `try`, `on failure` and `loop` are the difference. Every one of
 * those words comes from `regionsOf` through `Band.keyword`, so the chip here
 * and the chip in `<StepList>` are the same string.
 *
 * The frame is the region's own box rather than a rule between two cards. There
 * is no connector on this map and there is nothing to attach one to: a Step runs
 * because of where it nests (ADR-0013), so what a reader needs to see is the
 * boundary of each region, which is exactly this.
 */
export function RegionBand({ band, label, when }: RegionBandProps) {
  return (
    <>
      <style href="hatua-region-band" precedence="hatua">
        {css}
      </style>
      <div className={cx(styles.band, styles[band.kind])} style={boxOf(band)}>
        {/*
          The strip's height is `LAYOUT.regionLabel` itself, not a number in the
          stylesheet that matches it today. The layout reserves exactly this much
          at the top of the band and lays the region's cards out below it, so a
          second copy of the number is two things that drift the day one moves.
        */}
        <p className={styles.header} style={{ blockSize: LAYOUT.regionLabel }}>
          <span className={styles.keyword}>{band.keyword}</span>
          {label ? <span className={styles.label}>{label}</span> : null}
          {when ? <code className={styles.when}>{when}</code> : null}
        </p>
      </div>
    </>
  )
}
