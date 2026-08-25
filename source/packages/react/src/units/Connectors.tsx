import type { Link } from '@hatua/layout'
import styles from './Connectors.module.css'
import css from './Connectors.module.css?inline'

export interface ConnectorsProps {
  links: readonly Link[]
  width: number
  height: number
}

/**
 * The lines between the cards: every `Link` that is one, in one SVG behind
 * everything else.
 *
 * Not every gap is a line. A `run` is between two Steps and means "then"; the
 * gaps at a region's two ends are `enter` and `leave`, and drawing those would
 * put a line between a Step and its own body — one idiom with two meanings on a
 * map where containment is already said by overlap. A `join` is drawn, because
 * where a Fork's Branches converge is not adjacency and nothing else says it.
 *
 * ## Why there are lines at all
 *
 * ADR-0013 refuses an edge a user can attach anything to — no connect
 * affordance, no exit handles — and CONTEXT.md refuses a **Connection** as a
 * thing in the model. Neither of those refuses a *drawn* line, and a map without
 * one is cards floating in a void: `LAYOUT.verticalGap` is 96px, so two cards
 * that follow each other read as two unrelated things. The line is what says
 * "then". It is chrome, it carries no data, and there is nothing on either end
 * for a pointer to grab.
 *
 * ## What is geometry and what is ink
 *
 * `@hatua/layout` says where each link starts and ends. The curve between those
 * two points is this component's — a symmetric cubic whose control points sit
 * half the vertical distance from each end, which is what turns a Fork's
 * divergence into an S rather than a dog-leg. Endpoints are where things are;
 * a curve is how a line looks getting there.
 *
 * One SVG rather than one per link: a Fork's columns overlap in x, so N absolute
 * boxes would each need to be the size of their own bounding box and would stack
 * in a paint order nothing controls. `pointer-events: none` throughout, because
 * the `+` buttons and the labels are real DOM on top of this.
 */
export function Connectors({ links, width, height }: ConnectorsProps) {
  return (
    <>
      <style href="hatua-connectors" precedence="hatua">
        {css}
      </style>
      <svg
        className={styles.connectors}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        focusable="false"
        aria-hidden="true"
      >
        <title>Flow</title>
        {links.map((link, index) =>
          link.kind === 'run' || link.kind === 'join' ? (
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: a link has no identity of its own — it is a gap between two things, and the layout emits them in a fixed order. The index IS the identity here.
              key={index}
              className={link.kind === 'join' ? styles.join : styles.run}
              d={pathOf(link)}
            />
          ) : null,
        )}
      </svg>
    </>
  )
}

/**
 * The cubic between a link's two ends.
 *
 * Control points half the vertical distance out from each end, so the line
 * leaves downward and arrives downward whatever the horizontal offset. A
 * straight drop down one spine degenerates to a straight line, which is what a
 * run of Steps should look like; a Fork's divergence becomes an S.
 *
 * Where the two ends are level — the stub after the last Step of a list is not,
 * but a join from a short column can be — the fallback keeps a minimum bow so
 * two links arriving at one mark do not collapse onto each other.
 */
function pathOf({ from, to }: Link): string {
  const bow = Math.max(Math.abs(to.y - from.y) / 2, 12)
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + bow}, ${to.x} ${to.y - bow}, ${to.x} ${to.y}`
}
