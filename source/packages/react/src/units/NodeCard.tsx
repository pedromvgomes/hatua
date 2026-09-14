import type { Rect } from '@hatua/layout'
import { type Diagnostic, isContainer, nameOf, slotsFor } from '@hatua/model'
import type { Manifest, Step } from '@hatua/schema'
import { cx } from '../primitives/classNames'
import { boxOf } from './box'
import { setDragChip } from './dragChip'
import { IconCoin } from './IconCoin'
import styles from './NodeCard.module.css'
import css from './NodeCard.module.css?inline'

export interface NodeCardProps {
  step: Step
  /** Where this card goes, from `@hatua/layout`. Nothing here works it out. */
  rect: Rect
  /**
   * The Component Manifest for this Step's verb, when the Host serves one.
   *
   * What it decides: the icon, and the chips. A verb no manifest declares draws
   * the neutral coin and no meta row — the same answer `heightOf` gives, so the
   * card's height and its contents cannot come apart.
   */
  manifest?: Manifest
  /** The Host's connection labels, by the id a `conn` field holds. */
  connections?: ReadonlyMap<string, string>
  selected?: boolean
  /**
   * Whether this card's own Step is the one being dragged.
   *
   * The card stays where it is while the drag is in flight, so without this it
   * reads as still being there — and the chip under the pointer reads as a
   * second copy of it. Dashed says what a dashed edge says everywhere else on
   * this map: a placeholder for something not settled yet.
   */
  dragging?: boolean
  /** Whether this container's regions are drawn. Absent on a leaf. */
  expanded?: boolean
  /**
   * The Board this card's `use:` calls into, when it calls one.
   *
   * A call is a doorway into another Board and not a region drawn inline
   * (ADR-0013), so a call site gets a control that goes there rather than a
   * chevron that opens it in place.
   */
  opens?: string
  /** This Step's diagnostics; a Step with none is handed nothing. */
  problems?: readonly Diagnostic[]
  /**
   * Whether the Block this Step calls will not run — a problem on its own Board,
   * or on the Board of something it calls in turn.
   *
   * A boolean and not a `Diagnostic`, because there is no diagnostic to hand
   * over: the problem is reported once, on the Board that holds it, and raising
   * a second one here would report it twice and make a Block called from five
   * places look five times as broken (`troubledBlocks`). What this draws is the
   * same marker for a different reason, because the consequence is the same —
   * a card that looks fine on a workflow that does not run.
   */
  callsBrokenBlock?: boolean
  /**
   * Selected, with whether the gesture asked to *extend* a selection rather
   * than replace it — `shiftKey`, reported and not interpreted.
   *
   * What extending means is the canvas's question: this unit does not know what
   * is already selected, which Steps are siblings, or that a selection is a
   * Segment at all (ADR-0020).
   */
  onSelect?: (extend: boolean) => void
  onToggle?: () => void
  onOpen?: () => void
  onDragStart?: () => void
  onDragEnd?: () => void
}

/**
 * One Step as a card on the flow map.
 *
 * ## The meta row is the Step's filled Slots
 *
 * Not a summary this component writes. A **Slot** is a Template and the type it
 * must produce, and `slotsFor` reads them off the Component Manifest — so the
 * row says what the Component's contract says, in the order the manifest
 * declares it. `core.fork` declares `fields: []` and gets no row; a
 * `core.for_each` declares `list` and gets one. That is one rule for a leaf and
 * a container alike, and it is the same predicate `heightOf` asks, so a card
 * cannot be the short one with a row in it.
 *
 * ## It says what `<StepList>` says
 *
 * `nameOf` is in @hatua/model and both surfaces call it. A card and a row
 * describing one Step two ways is the same defect as a map and a list
 * disagreeing about which regions it has — one Step, looking like two.
 */
export function NodeCard({
  step,
  rect,
  manifest,
  connections,
  selected = false,
  dragging = false,
  expanded = true,
  opens,
  problems,
  callsBrokenBlock,
  onSelect,
  onToggle,
  onOpen,
  onDragStart,
  onDragEnd,
}: NodeCardProps) {
  const container = isContainer(step)
  const name = nameOf(step)
  const chips = chipsFor(step, manifest, connections)
  /*
   * Everything wrong with this card, whether it is wrong here or behind the
   * doorway. Both drive the same marker and the same border: the distinction
   * matters to whoever fixes it and not to whoever is reading the Board, and a
   * call that quietly looks fine on a workflow that cannot run is the state
   * this exists to end.
   */
  const reasons = [
    ...(problems ?? []).map((problem) => problem.message),
    ...(callsBrokenBlock ? [CALLS_BROKEN_BLOCK] : []),
  ]
  const summary = reasons.length > 0 ? reasons.join(' ') : undefined

  return (
    <>
      <style href="hatua-node-card" precedence="hatua">
        {css}
      </style>
      {/*
        An <li>, because the cards on a Board ARE a list — a screen reader
        reading the canvas hears "list, 9 items" rather than nine unrelated
        buttons, and the drag handlers below sit on a semantic element rather
        than on a positioned <div>.
      */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the rule exists because a
          click handler on a non-interactive element is unreachable from a
          keyboard. Here it is reachable: the <button> inside carries the same
          command, the name, and the `aria-current`, and this handler only
          widens the POINTER target to the whole card — its icon, its grip, its
          marker, its padding. A keyboard handler here would put every card in
          the tab order twice for one command. */}
      <li
        className={cx(
          styles.card,
          selected && styles.selected,
          summary && styles.invalid,
          dragging && styles.dragging,
        )}
        style={boxOf(rect)}
        title={summary}
        draggable={onDragStart !== undefined}
        onClick={(event) => onSelect?.(event.shiftKey)}
        onDragStart={(event) => {
          event.stopPropagation()
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', step.id)
          // The card is 236px wide and the gap it is being carried to is a 20px
          // `+` on a line, so the default ghost covers the target. One chip for
          // every drag source that lands on this canvas.
          setDragChip(event.dataTransfer, event.currentTarget, nameOf(step))
          onDragStart?.()
        }}
        onDragEnd={(event) => {
          event.stopPropagation()
          onDragEnd?.()
        }}
      >
        <div className={styles.head}>
          {/*
            The drag grip. Decoration, not a control: the whole card is
            draggable, so this says so without being a second thing to tab
            through. Dots rather than a bar — a solid stripe down a card's edge
            reads as status, and this card already carries a real one.
          */}
          <svg
            className={styles.grip}
            viewBox="0 0 4 16"
            width="4"
            height="16"
            focusable="false"
            aria-hidden="true"
          >
            <circle cx="2" cy="4" r="1" />
            <circle cx="2" cy="8" r="1" />
            <circle cx="2" cy="12" r="1" />
          </svg>

          <IconCoin manifest={manifest} />

          <button
            type="button"
            className={styles.identity}
            aria-current={selected || undefined}
            // Stopped here rather than left to bubble into the card's own
            // handler: two paths to one command would call it twice, and
            // Enter on this button dispatches a click that bubbles like any
            // other.
            onClick={(event) => {
              event.stopPropagation()
              onSelect?.(event.shiftKey)
            }}
          >
            <span className={styles.name}>{name}</span>
            <span className={styles.verb}>{step.use}</span>
          </button>

          {reasons.length > 0 ? (
            <svg
              className={styles.marker}
              viewBox="0 0 16 16"
              width="14"
              height="14"
              focusable="false"
              aria-hidden="true"
            >
              <path d="M8 2.2 14.6 13.4H1.4Z" />
              <path className={styles.markerBang} d="M8 6.2v3.2M8 11.2v.1" />
            </svg>
          ) : null}

          {opens !== undefined ? (
            <button
              type="button"
              className={styles.control}
              aria-label={`Open ${name}`}
              // A doorway into another Board is not a selection, so this does
              // not also reach the card's handler.
              onClick={(event) => {
                event.stopPropagation()
                onOpen?.()
              }}
            >
              Open
            </button>
          ) : null}

          {container ? (
            <button
              type="button"
              className={styles.control}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`}
              // Folding a Step is not selecting it.
              onClick={(event) => {
                event.stopPropagation()
                onToggle?.()
              }}
            >
              {expanded ? '⌄' : '›'}
            </button>
          ) : null}
        </div>

        {chips.length > 0 ? (
          <div className={styles.meta}>
            {chips.map((chip) => (
              <span key={chip.key} className={cx(styles.chip, chip.reference && styles.reference)}>
                {chip.text}
              </span>
            ))}
          </div>
        ) : null}

        {/*
          The reasons in words, for everyone the marker does not reach — the same
          text <StepList> carries on its rows. `role="status"` rather than
          `alert`: an unfilled field is the normal state of a Step somebody just
          added, and ADR-0009 has this block Publish and never editing.
        */}
        {reasons.length > 0 ? (
          <span className={styles.offscreen} role="status">
            {`${name}: ${reasons.length === 1 ? '1 problem' : `${reasons.length} problems`}. ${summary}`}
          </span>
        ) : null}
      </li>
    </>
  )
}

interface Chip {
  key: string
  text: string
  /** A Reference names one value somewhere else, and is marked as such. */
  reference: boolean
}

/**
 * What the meta row shows: the connection first, then every filled Slot.
 *
 * The connection leads because it answers "against what" before "with what",
 * and because it is the one value on the row that is not the user's text — it
 * is a thing the Host established.
 *
 * A Slot holding a bare Reference is shown as the path it names rather than as
 * `{{ … }}`: the braces are syntax, and a card is not where anyone edits it.
 * Anything else is shown verbatim, which is what a literal is.
 */
function chipsFor(
  step: Step,
  manifest: Manifest | undefined,
  connections: ReadonlyMap<string, string> | undefined,
): Chip[] {
  if (!manifest) return []
  const chips: Chip[] = []
  const values = (step.with ?? {}) as Record<string, unknown>

  for (const field of manifest.fields ?? []) {
    if (field.kind !== 'conn') continue
    const held = values[field.k]
    if (typeof held !== 'string' || held === '') continue
    chips.push({ key: `conn:${field.k}`, text: connections?.get(held) ?? held, reference: false })
  }

  for (const slot of slotsFor(step, manifest)) {
    if (slot.template === '') continue
    const bare = /^\s*\{\{([^{}]+)\}\}\s*$/.exec(slot.template)
    chips.push({
      key: `slot:${slot.name}`,
      text: bare ? (bare[1] ?? '').trim() : slot.template,
      reference: bare !== null,
    })
  }

  return chips
}

/**
 * What a call card says when the Block behind it will not run.
 *
 * Says "opens" because that is the word on the control beside it, and says
 * nothing about which Step or which Reference: those are on another Board, and
 * a sentence naming them here would describe something the reader cannot see
 * and cannot act on without going there first.
 */
const CALLS_BROKEN_BLOCK = 'The block this opens has problems inside it.'
