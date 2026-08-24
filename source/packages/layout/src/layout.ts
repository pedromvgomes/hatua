import {
  type Board,
  type BoardId,
  isContainer,
  type Region,
  regionsOf,
  type StepRef,
  stepKey,
} from '@hatua/model'
import type { Step } from '@hatua/schema'

/**
 * Derived layout: one Board's Step tree in, flow-map geometry out.
 *
 * Positions are computed on every render and never stored (ADR-0001) — the map
 * is a reading of the tree, so a hand-edited Workflow Definition cannot
 * disagree with it. Nothing here draws: it answers where each card goes and how
 * big the map is, and the canvas paints that.
 *
 * ## One Board at a time
 *
 * `layout` takes a Board rather than a document, because the canvas draws one
 * Board at a time with a call as a doorway into another (ADR-0013). A function
 * over the whole document would compute four screens to draw one, and would
 * have to invent a second coordinate space to hold them apart.
 *
 * ## The walk is not restated here
 *
 * Which regions a Step nests is `regionsOf`, in @hatua/model. That is the whole
 * reason this package depends on the model rather than on @hatua/schema alone:
 * a container's regions are already enumerated three times over there —
 * `walkSteps`, `stepLists`, `callsOf` — and a fourth copy inside a package with
 * no corpus and no runner to disagree with it is the copy that would silently
 * drop a region and be found by nobody. The edge is safe in the direction it
 * points: the model does not import this package, and must not.
 *
 * ## There is no Go mirror, deliberately
 *
 * Every other cross-cutting rule in this repo is implemented twice and pinned by
 * `conformance/`. This one is implemented once. Hatua does not execute, and a
 * Host runner never lays anything out — geometry is the builder's, and the
 * builder is TypeScript. A `sdk/go/layout.go` would be a second implementation
 * of a question no runner asks, with no corpus to catch it drifting.
 *
 * ## Where the numbers come from
 *
 * `docs/handoff.md` § Flow map geometry. Change one there and here together.
 */

export const LAYOUT = {
  nodeWidth: 236,
  nodeHeight: 64,
  /** Node height when the card shows a meta row. */
  nodeHeightWithMeta: 100,
  verticalGap: 96,
  /** Horizontal gap between branch columns. */
  branchGap: 44,
  /**
   * Height reserved above a child region for the label that names it — `if` over
   * a Branch, `try` and `on failure` over a `core.try`'s two.
   */
  regionLabel: 28,
  /** Height reserved below a Fork's branches for the mark where they converge. */
  joinMarker: 26,
} as const

/** A box on the map, in flow-map coordinates with the origin at the top left. */
export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Where one Step's card goes.
 *
 * Keyed by `StepRef` and never by a bare id: Step ids are Board-local, so two
 * Blocks may each hold a Step called `ret` and a bare `ret` would say the two
 * share a position (ADR-0013). `stepKey` is the flat spelling where one is
 * needed — a React key, a `data-` attribute — and it is minted in one place so
 * two readers cannot pick two separators.
 */
export interface Placement extends Rect {
  readonly ref: StepRef
}

/**
 * One Board's geometry.
 *
 * `root` is the node the canvas draws above the first Step: the Triggers on the
 * root Board, the Block's contract inside one. It is a `Rect` and not a
 * `Placement` because it names no Step — it is derived from `doc.triggers[]` as
 * chrome rather than living in `steps[]`, which is what keeps `removeStep`,
 * `walkSteps` and `unknownComponents` from needing a special case for it. A
 * `Placement` with an optional `ref` would push "sometimes there is no Step
 * here" into every consumer's type instead, to spare exactly one field here.
 */
export interface FlowMap {
  readonly board: BoardId
  readonly root: Rect
  readonly placements: readonly Placement[]
  readonly width: number
  readonly height: number
}

export interface LayoutOptions {
  /**
   * The ids of containers drawn collapsed, on this Board.
   *
   * The one input that is not a function of the document, and it is a parameter
   * for exactly that reason. Collapse is chrome — `StepList` holds it in React
   * state and the Workflow Definition has no key for it, because a view state
   * in the document is a diff in the Host's repository every time someone folds
   * a loop shut.
   *
   * A collapsed container's children get no Placement at all, rather than a
   * Placement the canvas then hides. Laying them out anyway would make `height`
   * and `width` describe a map nobody is looking at, and every consumer of a
   * total — the scroll extent, fit-to-screen, a minimap — would be reading a
   * number that is wrong whenever anything is folded.
   *
   * Bare ids rather than `StepRef`s: a Board is already the argument, and ids
   * are unique on one.
   */
  readonly collapsed?: ReadonlySet<string>
}

/**
 * How tall one Step's card is.
 *
 * The layout package answers this, rather than taking a height from the caller.
 * A caller-supplied height would leave `FlowMap.width` and `.height` as totals
 * over numbers this package never saw, so it could not compute them honestly —
 * and "how tall is a card" would have as many answers as there are callers.
 *
 * The meta row carries the container summary — how many branches, how many
 * steps, whether there is a handler — so a card is the taller one exactly when
 * the Step owns child regions. That is `isContainer`, asked of `regionsOf`: the
 * same enumeration that decides what this recurses into, so a card cannot be
 * the short one and still open into something.
 */
export const heightOf = (step: Step): number =>
  isContainer(step) ? LAYOUT.nodeHeightWithMeta : LAYOUT.nodeHeight

/**
 * One Board's Step tree as geometry.
 *
 * A pure function of `(board, collapsed)`: the same Board laid out twice is the
 * same map, which is what ADR-0001's promise rests on. Nothing is written back —
 * the Board and every Step in it are read and never touched.
 */
export function layout(board: Board, options: LayoutOptions = {}): FlowMap {
  const collapsed = options.collapsed ?? NOTHING_COLLAPSED
  const body = stack(board.steps, board.id, collapsed)
  const width = Math.max(LAYOUT.nodeWidth, body.width)

  const root: Rect = {
    x: centre(width, LAYOUT.nodeWidth),
    y: 0,
    width: LAYOUT.nodeWidth,
    height: LAYOUT.nodeHeight,
  }

  // An empty Board is the root node and nothing else. Reserving the gap below
  // it would leave the map taller than everything drawn on it.
  if (board.steps.length === 0) {
    return { board: board.id, root, placements: [], width, height: LAYOUT.nodeHeight }
  }

  const top = LAYOUT.nodeHeight + LAYOUT.verticalGap
  return {
    board: board.id,
    root,
    placements: shift(body.placements, centre(width, body.width), top),
    width,
    height: top + body.height,
  }
}

/** One Board's Placement for a Step, or undefined when that Step is collapsed away. */
export const placementOf = (map: FlowMap, ref: StepRef): Placement | undefined =>
  map.placements.find((placement) => stepKey(placement.ref) === stepKey(ref))

const NOTHING_COLLAPSED: ReadonlySet<string> = new Set()

/**
 * A laid-out fragment, positioned relative to its own top-left corner.
 *
 * Every combinator below takes boxes and returns a box, so a fragment is placed
 * once, by whatever encloses it, and never has to know where it ended up.
 */
interface Box {
  readonly width: number
  readonly height: number
  readonly placements: readonly Placement[]
}

/** The empty region: no cards, but a card's width so its label has somewhere to sit. */
const EMPTY: Box = { width: LAYOUT.nodeWidth, height: 0, placements: [] }

/**
 * A step list as a column: each Step under the last, centred on one spine.
 *
 * Time runs down the map, so the reading order of a list is its vertical order
 * and nothing else carries it.
 */
function stack(steps: readonly Step[], board: BoardId, collapsed: ReadonlySet<string>): Box {
  if (steps.length === 0) return EMPTY

  const boxes = steps.map((step) => place(step, board, collapsed))
  const width = Math.max(...boxes.map((box) => box.width))
  const placements: Placement[] = []
  let y = 0

  for (const box of boxes) {
    if (y > 0) y += LAYOUT.verticalGap
    placements.push(...shift(box.placements, centre(width, box.width), y))
    y += box.height
  }

  return { width, height: y, placements }
}

/**
 * One Step's card and everything it nests.
 *
 * A Fork's Branches become columns side by side and converge on a join marker,
 * because they are alternatives chosen between, and *which one* is the reader's
 * question.
 *
 * Every other region is stacked below the card, in document order — so a
 * `core.try`'s body and handler sit one above the other rather than beside each
 * other. They are not alternatives chosen between: the handler runs *because*
 * the body failed, and part of the body has already run by then. Drawing them
 * as columns would make left-to-right mean "later" in the one place on the map
 * where it means nothing else, and would put a third thing on screen that reads
 * as a Fork.
 *
 * What tells the two regions apart, and tells either of them from a loop body,
 * is the label band above each one — `try` and `on failure`, `loop` — which is
 * the same answer `StepList` gives with the chip over each region. Every child
 * region gets one, including a Branch's, so a second region costs no shape the
 * first did not already have.
 *
 * Both kinds are laid out, not one or the other. No verb owns both `branches:`
 * and a `steps:` body, but nothing refuses a document that writes both — the
 * schema's step keys are all optional and no rule reads them together — so a
 * Step that carries both is laid out with all of its regions rather than half of
 * them. Branching on "is this a Fork" instead of on the regions in hand is how a
 * reader silently drops one.
 */
function place(step: Step, board: BoardId, collapsed: ReadonlySet<string>): Box {
  const height = heightOf(step)
  const regions = collapsed.has(step.id) ? [] : [...regionsOf(step)]
  const bands: Box[] = []

  const branches = regions.filter((region) => region.kind === 'branch')
  if (branches.length > 0) bands.push(join(spread(labelledAll(branches, board, collapsed))))
  for (const region of regions.filter((one) => one.kind !== 'branch')) {
    bands.push(labelled(stack(region.steps, board, collapsed)))
  }

  const width = Math.max(LAYOUT.nodeWidth, ...bands.map((band) => band.width))
  const placements: Placement[] = [
    {
      ref: { board, id: step.id },
      x: centre(width, LAYOUT.nodeWidth),
      y: 0,
      width: LAYOUT.nodeWidth,
      height,
    },
  ]

  let y = height
  for (const band of bands) {
    y += LAYOUT.verticalGap
    placements.push(...shift(band.placements, centre(width, band.width), y))
    y += band.height
  }

  return { width, height: y, placements }
}

const labelledAll = (
  regions: readonly Region[],
  board: BoardId,
  collapsed: ReadonlySet<string>,
): Box[] => regions.map((region) => labelled(stack(region.steps, board, collapsed)))

/** A region under the band that names it. */
const labelled = (box: Box): Box => ({
  width: box.width,
  height: LAYOUT.regionLabel + box.height,
  placements: shift(box.placements, 0, LAYOUT.regionLabel),
})

/** Boxes side by side, left to right, in document order. */
function spread(boxes: readonly Box[]): Box {
  const placements: Placement[] = []
  let x = 0

  for (const box of boxes) {
    if (x > 0) x += LAYOUT.branchGap
    placements.push(...shift(box.placements, x, 0))
    x += box.width
  }

  return { width: x, height: Math.max(...boxes.map((box) => box.height)), placements }
}

/** Room below a spread for the mark where its columns converge. */
const join = (box: Box): Box => ({ ...box, height: box.height + LAYOUT.joinMarker })

const shift = (placements: readonly Placement[], dx: number, dy: number): Placement[] =>
  placements.map((placement) => ({ ...placement, x: placement.x + dx, y: placement.y + dy }))

/**
 * Where a `width`-wide box sits inside an `outer`-wide one.
 *
 * Floored rather than rounded, so a centred fragment can never round its way
 * past its parent's right edge and into the gap beside a sibling column. Every
 * coordinate on the map is therefore a whole number of pixels, which is also
 * what makes two layouts of one Board compare byte for byte.
 */
const centre = (outer: number, width: number): number => Math.floor((outer - width) / 2)
