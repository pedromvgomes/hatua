import styles from './SegmentBar.module.css'
import css from './SegmentBar.module.css?inline'

export interface SegmentBarProps {
  /**
   * How many Steps the actions apply to.
   *
   * Handed over rather than counted from a Segment: this unit draws what it is
   * told, and the count that matters is what the Segment resolves to on the
   * Board being drawn, which is the canvas's question and not this one's.
   */
  count: number
  /**
   * Take the selected Steps out of the document.
   *
   * Optional, and absent means the action is not drawn at all. A bar with no
   * action on it is still worth mounting — the count is the only thing that
   * says how many Steps are selected when the selection runs past the edge of
   * the viewport.
   */
  onRemove?: () => void
  /**
   * Turn the selected Steps into a Block (ADR-0018).
   *
   * The reason this unit takes its actions as separate optional props rather
   * than drawing a fixed row: extraction arrives without changing anything
   * here. A control drawn now and disabled would read as broken rather than as
   * absent, which is the distinction `CanvasControls` draws when it greys out
   * the end of the zoom range and keeps it on screen.
   */
  onExtract?: () => void
}

/**
 * The bar of actions over the selected Steps.
 *
 * ## It floats over the canvas
 *
 * Not in the side panel, whose tabs switch and whose content scrolls — the
 * actions for a live selection could be scrolled out of sight while the
 * selection is still drawn. Not near the selection either: the Segment's extent
 * is geometry, this tier computes none, and a bar positioned in map coordinates
 * would scale with the zoom or need projecting out of it on every pan. Floating
 * over the canvas needs no geometry at all and is on screen for as long as the
 * selection is.
 *
 * Placement is this unit's own, the one exception `CanvasControls` also takes:
 * a bar that floats at the lower start of the canvas is what this *is*, so it
 * carries that and needs a positioned ancestor.
 *
 * ## One Step is a selection
 *
 * The bar appears for a Segment of one, because a Segment of one is a Segment
 * (ADR-0018, ADR-0020) — a single container together with its whole body is the
 * flattening case a Block exists for. A bar that waited for two would be
 * denying that, and it would leave the canvas with no way to remove a Step at
 * all.
 */
export function SegmentBar({ count, onRemove, onExtract }: SegmentBarProps) {
  return (
    <>
      <style href="hatua-segment-bar" precedence="hatua">
        {css}
      </style>
      {/*
        No role, which is the call `CanvasControls` makes about the same kind of
        strip. `role="toolbar"` promises that the arrow keys move between the
        items: they do not — Tab does, and the arrows with Shift held extend the
        selection this bar describes, so the role would claim the one contract
        the canvas around it contradicts. `role="group"` buys a name the count
        already says out loud, and every button here carries the count in its
        own name.
      */}
      <div className={styles.bar}>
        <span className={styles.count}>{selectedLabel(count)}</span>
        {onExtract ? (
          <button
            type="button"
            className={styles.action}
            aria-label={`Make a block from ${countLabel(count)}`}
            onClick={onExtract}
          >
            Make a block
          </button>
        ) : null}
        {onRemove ? (
          <button
            type="button"
            className={`${styles.action} ${styles.remove}`}
            // The count is in the name because "Remove" alone does not say how
            // much is about to go, and this is the one control on the canvas
            // that takes more than one Step at a time. The visible word starts
            // it, so the name still contains the label.
            aria-label={`Remove ${countLabel(count)}`}
            onClick={onRemove}
          >
            Remove
          </button>
        ) : null}
      </div>
    </>
  )
}

/**
 * "1 step selected" / "3 steps selected".
 *
 * Says "selected" rather than the count alone: a bare "1 step" beside a Remove
 * button reads as ambiguous about whether it is a count or the name of what the
 * button does. It is the only thing that says how many when a selection reaches
 * past the edge of the viewport.
 */
const selectedLabel = (count: number): string => `${countLabel(count)} selected`

/** "1 step" / "3 steps", so a name reading it need not repeat the arithmetic. */
const countLabel = (count: number): string => `${count} ${count === 1 ? 'step' : 'steps'}`
