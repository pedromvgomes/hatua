import type { Rect } from '@hatua/layout'
import { type Diagnostic, isContainer, nameOf, summaryOf } from '@hatua/model'
import type { Step } from '@hatua/schema'
import { cx } from '../primitives/classNames'
import { boxOf } from './box'
import styles from './NodeCard.module.css'
import css from './NodeCard.module.css?inline'

export interface NodeCardProps {
  step: Step
  /** Where this card goes, from `@hatua/layout`. Nothing here works it out. */
  rect: Rect
  selected?: boolean
  /**
   * Whether this container's regions are drawn. Absent on a leaf, which has no
   * chevron because it has nothing to fold.
   */
  expanded?: boolean
  /**
   * The Board this card's `use:` calls into, when it calls one.
   *
   * A call is a doorway into another Board and not a region drawn inline
   * (ADR-0013), so a call site gets a control that goes there rather than a
   * chevron that opens it in place. Resolved by the caller: this unit is handed
   * a Step and has no document to look a `block.<slug>` up in.
   */
  opens?: string
  /** This Step's diagnostics; a Step with none is handed nothing. */
  problems?: readonly Diagnostic[]
  onSelect?: () => void
  onToggle?: () => void
  onOpen?: () => void
}

/**
 * One Step as a card on the flow map.
 *
 * ## Two heights, and one predicate behind both
 *
 * `LAYOUT.nodeHeight` is "a card with a name and nothing else" and
 * `nodeHeightWithMeta` is the one that also carries the summary row, and
 * `heightOf` picks between them on `isContainer`. So this asks `isContainer`
 * too, rather than "is there a summary" — `summaryOf` always returns something,
 * and a leaf that showed it would be a 64px card with 100px of content in it.
 * The height and what fills it are decided by one question in one place.
 *
 * ## It says what `<StepList>` says
 *
 * `nameOf` and `summaryOf` are in @hatua/model and both surfaces call them. A
 * card and a row describing one Step two ways is the same defect as a map and a
 * list disagreeing about which regions it has — one Step, looking like two.
 */
export function NodeCard({
  step,
  rect,
  selected = false,
  expanded = true,
  opens,
  problems,
  onSelect,
  onToggle,
  onOpen,
}: NodeCardProps) {
  const container = isContainer(step)
  const name = nameOf(step)
  const summary = problems?.length
    ? problems.map((problem) => problem.message).join(' ')
    : undefined

  return (
    <>
      <style href="hatua-node-card" precedence="hatua">
        {css}
      </style>
      <div
        className={cx(styles.card, selected && styles.selected, summary && styles.invalid)}
        style={boxOf(rect)}
        title={summary}
      >
        <button
          type="button"
          className={styles.identity}
          aria-current={selected || undefined}
          onClick={onSelect}
        >
          <span className={styles.name}>{name}</span>
          {container ? <span className={styles.meta}>{summaryOf(step)}</span> : null}
        </button>

        {/*
          The reasons in words, for everyone the coloured edge does not reach —
          the same text <StepList> carries on its rows, because a marker that is
          colour alone says nothing to a screen reader. `role="status"` rather
          than `alert`: an unfilled field is the normal state of a Step somebody
          just added, and ADR-0009 has this block Publish and never editing.
        */}
        {problems?.length ? (
          <span className={styles.offscreen} role="status">
            {`${name}: ${problems.length === 1 ? '1 problem' : `${problems.length} problems`}. ${summary}`}
          </span>
        ) : null}

        <div className={styles.controls}>
          {opens !== undefined ? (
            <button
              type="button"
              className={styles.open}
              aria-label={`Open ${name}`}
              onClick={onOpen}
            >
              Open
            </button>
          ) : null}
          {container ? (
            <button
              type="button"
              className={styles.chevron}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`}
              onClick={onToggle}
            >
              {expanded ? '⌄' : '›'}
            </button>
          ) : null}
        </div>
      </div>
    </>
  )
}
