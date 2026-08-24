import type { Point } from '@hatua/layout'
import { useState } from 'react'
import { cx } from '../primitives/classNames'
import styles from './InsertDot.module.css'
import css from './InsertDot.module.css?inline'

export interface InsertDotProps {
  at: Point
  /**
   * What this insert point is called, spelled out rather than numbered.
   *
   * "Insert a Step at position 3" is three different places on a map with two
   * Branches, and a screen reader reading the canvas would hear the same
   * sentence at each of them.
   */
  label: string
  /**
   * A drag this canvas started is in progress, so every gap says it is a target
   * before the pointer reaches it.
   *
   * A drag from another region — a Component card — cannot be known about until
   * it is over this dot, because `dataTransfer` is unreadable until then. That
   * one lights on hover instead, which is the most any drop target can do about
   * a payload it is not allowed to look at yet.
   */
  active?: boolean
  onInsert?: () => void
  /** Handed the transfer, because what a drop means is the caller's question. */
  onDrop?: (data: DataTransfer) => void
}

/**
 * The `+` on a link: where a Step is added, and where one is dropped.
 *
 * A real button rather than a hover affordance. It is the only unambiguous way
 * to say "here and not there" on a map where the gaps are 96px of nothing, and a
 * drop target nobody can reach from the keyboard needs a sibling that can.
 *
 * It sits **on** the line rather than beside it, so the thing being pointed at
 * and the thing being clicked are the same thing. Its centre is a point
 * `@hatua/layout` put there; this only draws it.
 *
 * With no `onInsert` it is a drop target and nothing else — the state
 * `apps/playground/src/host.tsx` mounts, where moving an existing Step needs no
 * catalogue while adding a new one does.
 */
export function InsertDot({ at, label, active = false, onInsert, onDrop }: InsertDotProps) {
  const [over, setOver] = useState(false)
  const droppable = onDrop !== undefined

  return (
    <>
      <style href="hatua-insert-dot" precedence="hatua">
        {css}
      </style>
      {/*
        An <li> beside the cards, the way `<StepList>`'s gaps are <li>s beside
        its rows: a gap is an item in the same list, and the drop handlers sit
        on a semantic element rather than on a positioned <div>.
      */}
      <li
        className={cx(styles.slot, droppable && (active || over) && styles.live)}
        style={{ left: at.x, top: at.y }}
        onDragOver={(event) => {
          if (!droppable) return
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          setOver(false)
          if (!droppable) return
          event.preventDefault()
          onDrop?.(event.dataTransfer)
        }}
      >
        {onInsert ? (
          <button type="button" className={styles.dot} aria-label={label} onClick={onInsert}>
            +
          </button>
        ) : (
          <span className={styles.dot} aria-hidden="true">
            +
          </span>
        )}
      </li>
    </>
  )
}
