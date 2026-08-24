import type { Rect } from '@hatua/layout'
import { type Diagnostic, isContainer, nameOf, slotsFor } from '@hatua/model'
import type { Manifest, Step } from '@hatua/schema'
import { cx } from '../primitives/classNames'
import { boxOf } from './box'
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
  onSelect?: () => void
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
  expanded = true,
  opens,
  problems,
  onSelect,
  onToggle,
  onOpen,
  onDragStart,
  onDragEnd,
}: NodeCardProps) {
  const container = isContainer(step)
  const name = nameOf(step)
  const chips = chipsFor(step, manifest, connections)
  const summary = problems?.length
    ? problems.map((problem) => problem.message).join(' ')
    : undefined

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
      <li
        className={cx(styles.card, selected && styles.selected, summary && styles.invalid)}
        style={boxOf(rect)}
        title={summary}
        draggable={onDragStart !== undefined}
        onDragStart={(event) => {
          event.stopPropagation()
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', step.id)
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
            onClick={onSelect}
          >
            <span className={styles.name}>{name}</span>
            <span className={styles.verb}>{step.use}</span>
          </button>

          {problems?.length ? (
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
              onClick={onOpen}
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
              onClick={onToggle}
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
        {problems?.length ? (
          <span className={styles.offscreen} role="status">
            {`${name}: ${problems.length === 1 ? '1 problem' : `${problems.length} problems`}. ${summary}`}
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
