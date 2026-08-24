import {
  type Board,
  type BoardId,
  isContainer,
  type Region,
  type RegionKind,
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
 * One child region's box, and the word that goes over it.
 *
 * `LAYOUT.regionLabel` is reserved at the top of this rect for the label, and
 * the region's cards are laid out below it — so a band is the whole region, not
 * the strip above it. That is what lets the canvas draw a region's frame and
 * its label from one box.
 *
 * Handed over rather than recomputed. `layout` already reserves the strip and
 * already knows which region it belongs to; a canvas that worked the same
 * boxes out from the Placements inside them would be a second implementation of
 * this file's geometry, in the tier whose rule is that it computes none of its
 * own. It would also have nothing to work from where a region is empty, which
 * is exactly where the band is the only thing on screen.
 *
 * `keyword` comes from `regionsOf`, so the word over a band and the word in
 * `<StepList>`'s chip are the same string from the same function.
 */
export interface Band extends Rect {
  readonly kind: RegionKind
  readonly keyword: string
  /** The container Step this region hangs under. */
  readonly owner: StepRef
}

/**
 * Where a Fork's Branches come back together.
 *
 * `LAYOUT.joinMarker`'s worth of room below the columns, spanning them. A Fork's
 * Branches are the one region drawn side by side, so they are the one region
 * whose reader has to be told where the alternatives end — every other region
 * is stacked, and stacking says it already.
 */
export interface Join extends Rect {
  /** The Fork whose Branches converge here. */
  readonly owner: StepRef
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
  /** Every child region on this Board, in the order the walk yields them. */
  readonly bands: readonly Band[]
  /** One per Fork whose Branches are drawn. */
  readonly joins: readonly Join[]
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
    return {
      board: board.id,
      root,
      placements: [],
      bands: [],
      joins: [],
      width,
      height: LAYOUT.nodeHeight,
    }
  }

  const top = LAYOUT.nodeHeight + LAYOUT.verticalGap
  const placed = shift(body, centre(width, body.width), top)
  return {
    board: board.id,
    root,
    placements: placed.placements,
    bands: placed.bands,
    joins: placed.joins,
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
  readonly bands: readonly Band[]
  readonly joins: readonly Join[]
}

/** The empty region: no cards, but a card's width so its label has somewhere to sit. */
const EMPTY: Box = { width: LAYOUT.nodeWidth, height: 0, placements: [], bands: [], joins: [] }

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
  const parts: Box[] = []
  let y = 0

  for (const box of boxes) {
    if (y > 0) y += LAYOUT.verticalGap
    parts.push(shift(box, centre(width, box.width), y))
    y += box.height
  }

  return { width, height: y, ...merge(parts) }
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
 * Both kinds are laid out, not one or the other, and the verb is never consulted
 * about whether a region exists. No verb owns both `branches:` and a `steps:`
 * body, and a `handler:` outside a `core.try` is meaningless — but nothing
 * refuses a document that writes them, because the schema's step keys are all
 * optional and no rule reads them together. Such a region is still walked:
 * `walkSteps` yields the Steps inside it, so the generic rules report against
 * them by name. A card no surface draws is a diagnostic the user cannot act on,
 * so drawing every region in hand is what keeps a hand-edited region reachable
 * enough to delete. `<StepList>` draws them on the same rule. The verb decides
 * the *word* over a region, never whether there is one.
 */
function place(step: Step, board: BoardId, collapsed: ReadonlySet<string>): Box {
  const height = heightOf(step)
  const ref: StepRef = { board, id: step.id }
  const regions = collapsed.has(step.id) ? [] : [...regionsOf(step)]
  const under: Box[] = []

  const branches = regions.filter((region) => region.kind === 'branch')
  if (branches.length > 0) {
    under.push(join(spread(branches.map((one) => labelled(one, ref, board, collapsed))), ref))
  }
  for (const region of regions.filter((one) => one.kind !== 'branch')) {
    under.push(labelled(region, ref, board, collapsed))
  }

  const width = Math.max(LAYOUT.nodeWidth, ...under.map((box) => box.width))
  const parts: Box[] = [
    {
      width: LAYOUT.nodeWidth,
      height,
      placements: [
        {
          ref,
          x: centre(width, LAYOUT.nodeWidth),
          y: 0,
          width: LAYOUT.nodeWidth,
          height,
        },
      ],
      bands: [],
      joins: [],
    },
  ]

  let y = height
  for (const box of under) {
    y += LAYOUT.verticalGap
    parts.push(shift(box, centre(width, box.width), y))
    y += box.height
  }

  return { width, height: y, ...merge(parts) }
}

/**
 * One region laid out under the band that names it.
 *
 * The band's rect is the whole region — the reserved strip plus everything laid
 * out below it — so an empty region is still a box on the map with a word over
 * it, which is what makes it somewhere a Step can be dropped.
 */
function labelled(
  region: Region,
  owner: StepRef,
  board: BoardId,
  collapsed: ReadonlySet<string>,
): Box {
  const inner = shift(stack(region.steps, board, collapsed), 0, LAYOUT.regionLabel)
  const height = LAYOUT.regionLabel + inner.height
  const band: Band = {
    kind: region.kind,
    keyword: region.keyword,
    owner,
    x: 0,
    y: 0,
    width: inner.width,
    height,
  }

  // The band is first, so `bands` comes out in the order the walk yields the
  // regions — a container's own region before anything nested inside it.
  return { width: inner.width, height, bands: [band, ...inner.bands], ...rest(inner) }
}

/** Boxes side by side, left to right, in document order. */
function spread(boxes: readonly Box[]): Box {
  const parts: Box[] = []
  let x = 0

  for (const box of boxes) {
    if (x > 0) x += LAYOUT.branchGap
    parts.push(shift(box, x, 0))
    x += box.width
  }

  return { width: x, height: Math.max(...boxes.map((box) => box.height)), ...merge(parts) }
}

/** Room below a spread for the mark where its columns converge. */
const join = (box: Box, owner: StepRef): Box => ({
  ...box,
  height: box.height + LAYOUT.joinMarker,
  joins: [
    ...box.joins,
    { owner, x: 0, y: box.height, width: box.width, height: LAYOUT.joinMarker },
  ],
})

/** Everything a Box carries except its bands — the half `labelled` replaces. */
const rest = (box: Box) => ({ placements: box.placements, joins: box.joins })

const merge = (boxes: readonly Box[]) => ({
  placements: boxes.flatMap((box) => box.placements),
  bands: boxes.flatMap((box) => box.bands),
  joins: boxes.flatMap((box) => box.joins),
})

/**
 * A fragment moved bodily: every card, band and join in it by the same offset.
 *
 * All three at once, so a band cannot be left behind where its cards went. That
 * is the whole reason a fragment is a `Box` rather than a `Placement[]` — a
 * combinator that shifted one list would place a region's frame over another
 * region's Steps, and the map would still be a valid `FlowMap`.
 */
const shift = (box: Box, dx: number, dy: number): Box => ({
  width: box.width,
  height: box.height,
  placements: box.placements.map((one) => ({ ...one, x: one.x + dx, y: one.y + dy })),
  bands: box.bands.map((one) => ({ ...one, x: one.x + dx, y: one.y + dy })),
  joins: box.joins.map((one) => ({ ...one, x: one.x + dx, y: one.y + dy })),
})

/**
 * Where a `width`-wide box sits inside an `outer`-wide one.
 *
 * Integral, so every coordinate on the map is a whole number of pixels and two
 * layouts of one Board compare byte for byte. Every caller passes an `outer`
 * that is a `Math.max` including this `width`, so the offset is never negative
 * and a centred fragment always lies inside its parent.
 */
const centre = (outer: number, width: number): number => Math.floor((outer - width) / 2)
