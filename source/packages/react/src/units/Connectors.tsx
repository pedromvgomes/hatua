import type { Link, Point } from '@hatua/layout'
import styles from './Connectors.module.css'
import css from './Connectors.module.css?inline'

export interface ConnectorsProps {
  links: readonly Link[]
  width: number
  height: number
}

/**
 * The lines between the cards: every `Link` on one Board, in one SVG behind
 * everything else.
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
        {links.map((link, index) => (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: a link has no identity of its own — it is a gap between two things, and the layout emits them in a fixed order. The index IS the identity here.
            key={index}
            className={link.kind === 'branch' ? styles.branch : styles.run}
            d={pathOf(link)}
          />
        ))}
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

/**
 * A point along that same cubic.
 *
 * Exported because the `+` and the label sit *on* the line and this is the only
 * place its shape is known. Computed rather than interpolated along the chord: a
 * Fork's branch link bows well away from its chord, and a `+` placed on the
 * chord would float beside the line it is meant to be on.
 */
export function pointOn({ from, to }: Link, t: number): Point {
  const bow = Math.max(Math.abs(to.y - from.y) / 2, 12)
  const p1 = { x: from.x, y: from.y + bow }
  const p2 = { x: to.x, y: to.y - bow }
  const u = 1 - t
  const at = (a: number, b: number, c: number, d: number) =>
    u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
  return { x: at(from.x, p1.x, p2.x, to.x), y: at(from.y, p1.y, p2.y, to.y) }
}
