import { LAYOUT, type Point } from '@hatua/layout'
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
   * True for a Component dragged in from the catalogue as well. `dataTransfer`
   * will not hand over the payload before the drop, but it does list the types
   * it carries on every `dragover` — enough for the canvas to recognise one of
   * its own drags the moment it crosses the surface, and to say so at every gap
   * rather than only under the pointer.
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
 *
 * ## Two drag states, because the cursor only carries one of them
 *
 * `live` is "a drag is on, and this is somewhere it can land" — every gap wears
 * it at once, which is what stops a target having to be hunted for. `over` is
 * "the pointer is on THIS one", and it exists because nothing else says so:
 * `dropEffect: 'move'` draws no badge, so a Step dragged across the canvas has
 * the ordinary arrow whether it is over a gap or over dead space. Without the
 * second state a drop is aimed at nine identical circles and missed.
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
        className={cx(
          styles.slot,
          droppable && (active || over) && styles.live,
          droppable && over && styles.over,
        )}
        style={{ left: at.x, top: at.y }}
        onDragOver={(event) => {
          if (!droppable) return
          event.preventDefault()
          // Said rather than left to the browser to guess, and read off what
          // the source declared: a Component dragged out of the catalogue is
          // copied into the flow, a Step dragged across the canvas is moved.
          // It is not what tells the user a drop will land — `move` draws no
          // badge on macOS, so a Step being dragged carries the same arrow it
          // has over dead space. The `over` state below is what says that.
          event.dataTransfer.dropEffect =
            event.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy'
          setOver(true)
        }}
        onDragLeave={(event) => {
          // Leaving is the pointer landing outside this slot and nowhere else.
          // `dragleave` also fires when it crosses onto the `+` inside, and
          // clearing on that flickers the one state saying where the drop
          // lands — the same guard the canvas surface puts on its own drag.
          const to = event.relatedTarget
          if (!(to instanceof Node) || !event.currentTarget.contains(to)) setOver(false)
        }}
        onDrop={(event) => {
          setOver(false)
          if (!droppable) return
          event.preventDefault()
          onDrop?.(event.dataTransfer)
        }}
      >
        {/*
          The bar the Step lands on, drawn out past the chip the pointer is
          carrying. A card's width, from the one table that holds it, because
          that is the footprint of the thing being dropped — so it reaches past
          the chip on both sides and still never crosses out of the narrowest
          column, which is a card plus two insets. Always rendered and shown by
          the `over` state, so arriving at a gap does not mount a node.
        */}
        <span className={styles.bar} style={{ inlineSize: LAYOUT.nodeWidth }} aria-hidden="true" />
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
