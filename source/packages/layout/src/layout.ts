import {
  type Board,
  type BoardId,
  type InsertPoint,
  type Region,
  type RegionKind,
  regionsOf,
  type StepRef,
  slotsFor,
  stepKey,
} from '@hatua/model'
import type { Manifest, Step } from '@hatua/schema'

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

/** A point on the map, in the same coordinates every Rect uses. */
export interface Point {
  readonly x: number
  readonly y: number
}

/** What a link is between, which is what decides how it is drawn and what sits on it. */
export type LinkKind = 'run' | 'branch' | 'join'

/**
 * One gap on the map: where the flow leaves one thing and arrives at the next,
 * and where a Step goes if one is dropped there.
 *
 * **One per gap in every step list**, which is the same count `<StepList>` draws
 * between its rows — a list of three Steps has four. That is what makes "every
 * insert point the list offers, the map offers too" a property rather than a
 * hope, and it is why the canvas can be the surface a workflow is built on.
 *
 * The endpoints are geometry and belong here; the curve between them is ink and
 * belongs to whatever draws it. A `run` is a straight drop down one spine, a
 * `branch` leaves a Fork for one of its columns, and a `join` brings a column
 * back to the mark where they converge.
 *
 * `at` is absent on a `join` alone: a join arrives at a mark rather than at a
 * position in a list, so there is nothing there to insert into. Every other link
 * carries one, including the stub after the last Step of a list — which is the
 * only way to append to a Board from the map, and the only thing on an empty
 * one.
 */
export interface Link {
  readonly kind: LinkKind
  readonly from: Point
  readonly to: Point
  readonly at?: InsertPoint
  /**
   * The word that sits on this link — a Branch's keyword, `each item` where a
   * loop body begins, `end loop` where it ends.
   *
   * On the link rather than in a box around the region, because that is where a
   * reader is already looking: the line is what carries them from the container
   * into the region, and the word names what they are crossing into.
   */
  readonly label?: string
  /**
   * Where the label goes, when there is one: the centre of the strip
   * `LAYOUT.regionLabel` reserves at the top of the region this link enters.
   *
   * Not a point along the line, which is what it was and which put a Fork's two
   * labels on top of each other: both of its branch links leave the same point,
   * so any fraction along them near the start is the same place twice. The
   * reserved strip cannot collide, because two Branch columns are `branchGap`
   * apart by construction.
   */
  readonly labelAt?: Point
  /** The Branch this link enters, when it is a `branch`. */
  readonly branchIndex?: number
  /** The container whose region this link enters or leaves. Absent at a Board's root. */
  readonly owner?: StepRef
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
  /** One per gap in every step list on this Board, plus the fork and join links. */
  readonly links: readonly Link[]
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
  /**
   * The Component Manifests, by `use`.
   *
   * A card's height depends on whether it has anything to show below its name,
   * and what it has to show is its filled **Slots** — which only a manifest
   * names. `core.fork` declares `fields: []`, so a Fork has no row and is the
   * short card; `core.for_each` declares `list`, so a loop has one.
   *
   * The second input that is not a function of the document, and it is worth
   * saying out loud: the map is a function of the document *and the catalogue*.
   * ADR-0001's promise is that a hand-edited file cannot disagree with the map,
   * and that still holds — the catalogue changes what a card says about itself,
   * never where anything goes relative to anything else. A Board laid out
   * before the manifests land is the same map with shorter cards.
   */
  readonly manifests?: ReadonlyMap<string, Manifest>
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
export const heightOf = (step: Step, manifest?: Manifest): number =>
  hasMeta(step, manifest) ? LAYOUT.nodeHeightWithMeta : LAYOUT.nodeHeight

/**
 * Whether a card has a meta row: the Step's filled **Slots**, as chips.
 *
 * Asked of `slotsFor` rather than of `step.with`, so the row shows what the
 * Component's contract declares rather than whatever the YAML happens to hold.
 * That is the difference between a Fork and a loop on the reference design: both
 * carry a `with:`, and only `core.for_each` declares a field — so only the loop
 * gets a row.
 *
 * A verb no manifest declares gets the short card. The alternative is reserving
 * a row for a Step whose contract nobody can state, which is the taller card
 * with nothing in it.
 */
export const hasMeta = (step: Step, manifest?: Manifest): boolean =>
  manifest !== undefined && slotsFor(step, manifest).some((slot) => slot.template !== '')

/**
 * One Board's Step tree as geometry.
 *
 * A pure function of `(board, collapsed)`: the same Board laid out twice is the
 * same map, which is what ADR-0001's promise rests on. Nothing is written back —
 * the Board and every Step in it are read and never touched.
 */
export function layout(board: Board, options: LayoutOptions = {}): FlowMap {
  const ctx: Ctx = {
    board: board.id,
    collapsed: options.collapsed ?? NOTHING_COLLAPSED,
    manifests: options.manifests ?? NO_MANIFESTS,
  }
  const body = stack(board.steps, ctx)
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
    const empty: FlowMap = {
      board: board.id,
      root,
      placements: [],
      bands: [],
      joins: [],
      links: [],
      width,
      height: LAYOUT.nodeHeight,
    }
    return { ...empty, links: linksOf(empty, board, ctx) }
  }

  const top = LAYOUT.nodeHeight + LAYOUT.verticalGap
  const placed = shift(body, centre(width, body.width), top)
  const map: FlowMap = {
    board: board.id,
    root,
    placements: placed.placements,
    bands: placed.bands,
    joins: placed.joins,
    links: [],
    width,
    height: top + body.height,
  }
  return { ...map, links: linksOf(map, board, ctx) }
}

/**
 * Every gap on the map, derived from the finished geometry.
 *
 * A second pass rather than a fourth list threaded through the combinators. A
 * link's two ends belong to two different fragments — one card's subtree and the
 * next card's top — and a combinator only ever sees one of them at a time, so
 * emitting links inside the walk would mean every fragment carrying anchors up
 * to whatever encloses it. Reading them off the placements once, at the end,
 * costs one more walk of a tree that is already in hand and keeps the box
 * arithmetic exactly as it was.
 *
 * The count is the invariant worth knowing: **one link per gap in every step
 * list**, which is one more than the list is long, and the same number of insert
 * points `<StepList>` draws between its rows. A Fork contributes its branch and
 * join links on top of that.
 */
function linksOf(map: FlowMap, board: Board, ctx: Ctx): Link[] {
  const rects = new Map<string, Rect>()
  for (const placement of map.placements) rects.set(placement.ref.id, placement)

  const links: Link[] = []

  const bottomOf = (step: Step): Point => {
    const rect = rects.get(step.id)
    if (!rect) return { x: 0, y: 0 }
    return { x: rect.x + rect.width / 2, y: extentOf(map, step, ctx) }
  }
  const topOf = (step: Step): Point => {
    const rect = rects.get(step.id)
    if (!rect) return { x: 0, y: 0 }
    return { x: rect.x + rect.width / 2, y: rect.y }
  }

  /**
   * One list of siblings: a link into the first, one between each pair, and one
   * out of the last. `from` is the top of the list — the card that owns it, or
   * the Board's root node — and every other link starts where the previous
   * Step's whole subtree ends, so a line leaving a loop leaves below its body
   * rather than out of the middle of it.
   */
  const walkList = (
    steps: readonly Step[],
    from: Point,
    at: Omit<InsertPoint, 'index'>,
    kind: LinkKind,
    label: string | undefined,
    labelAt: Point | undefined,
    branchIndex: number | undefined,
    owner: StepRef | undefined,
    /** Where this list rejoins the spine, for a Branch. Absent everywhere else. */
    mark: Point | undefined,
    /**
     * Where this region's content starts: under its label strip, on its own
     * column.
     *
     * For a list with Steps in it the walk finds this anyway — it is the first
     * card's top. For an empty one it is the only anchor there is, and without
     * it the line into an empty Branch runs straight down the spine, past the
     * column its own label is sitting over.
     */
    entry: Point | undefined,
  ) => {
    const naming = (index: number) =>
      index === 0
        ? {
            ...(label !== undefined ? { label } : {}),
            ...(labelAt ? { labelAt } : {}),
            ...(branchIndex !== undefined ? { branchIndex } : {}),
            ...(owner ? { owner } : {}),
          }
        : {}

    let head = from
    for (const [index, step] of steps.entries()) {
      links.push({
        kind: index === 0 ? kind : 'run',
        from: head,
        to: topOf(step),
        at: { ...at, index },
        ...naming(index),
      })
      head = bottomOf(step)
      walkStep(step)
    }

    /*
     * The last gap in the list.
     *
     * In a Branch it IS the join: the line out of the last card goes to the mark
     * where the columns converge, and the `+` rides on it. A separate stub would
     * leave two lines out of one card — one to the mark and one to nothing — and
     * that dangling line is the first thing a reader tries to follow.
     *
     * Everywhere else it is a stub of `verticalGap`, which is the only way to
     * append to a list from the map and the only thing on an empty Board.
     */
    // An empty region: one link into where its first card would go, so the line
    // arrives in the column its label is over rather than running past it.
    if (steps.length === 0 && entry) {
      links.push({ kind, from: head, to: entry, at: { ...at, index: 0 }, ...naming(0) })
      if (mark) {
        links.push({
          kind: 'join',
          from: entry,
          to: mark,
          ...(branchIndex !== undefined ? { branchIndex } : {}),
          ...(owner ? { owner } : {}),
        })
      }
      return
    }

    if (mark) {
      links.push({
        kind: steps.length === 0 ? kind : 'join',
        from: head,
        to: mark,
        at: { ...at, index: steps.length },
        ...naming(steps.length === 0 ? 0 : -1),
        ...(branchIndex !== undefined ? { branchIndex } : {}),
        ...(owner ? { owner } : {}),
      })
      return
    }

    links.push({
      kind: steps.length === 0 ? kind : 'run',
      from: head,
      to: { x: head.x, y: head.y + LAYOUT.verticalGap },
      at: { ...at, index: steps.length },
      ...naming(steps.length === 0 ? 0 : -1),
    })
  }

  const walkStep = (step: Step) => {
    if (ctx.collapsed.has(step.id)) return
    const rect = rects.get(step.id)
    if (!rect) return

    const owner: StepRef = { board: ctx.board, id: step.id }
    const under: Point = { x: rect.x + rect.width / 2, y: rect.y + rect.height }
    const bandsHere = map.bands.filter((band) => band.owner.id === step.id)
    const mark = map.joins.find((one) => one.owner.id === step.id)
    const meeting = mark ? { x: mark.x + mark.width / 2, y: mark.y + mark.height / 2 } : undefined

    let branchIndex = 0
    let bandIndex = 0

    for (const region of regionsOf(step)) {
      // The strip `regionLabel` reserves at the top of this region's own band,
      // which is where its word goes. Read off the band rather than recomputed,
      // so the reserved room and the thing sitting in it cannot drift apart.
      const band = bandsHere[bandIndex++]
      const labelAt = band
        ? { x: band.x + band.width / 2, y: band.y + LAYOUT.regionLabel / 2 }
        : undefined
      const entry = band
        ? { x: band.x + band.width / 2, y: band.y + LAYOUT.regionLabel }
        : undefined

      if (region.kind === 'branch') {
        const index = branchIndex++
        walkList(
          region.steps,
          under,
          { board: ctx.board, parentId: step.id, branchIndex: index },
          'branch',
          region.keyword,
          labelAt,
          index,
          owner,
          meeting,
          entry,
        )
        continue
      }
      walkList(
        region.steps,
        under,
        {
          board: ctx.board,
          parentId: step.id,
          ...(region.kind === 'handler' ? { region: 'handler' as const } : {}),
        },
        'run',
        region.keyword,
        labelAt,
        undefined,
        owner,
        undefined,
        entry,
      )
    }
  }

  walkList(
    board.steps,
    { x: map.root.x + map.root.width / 2, y: map.root.y + map.root.height },
    { board: ctx.board },
    'run',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  )

  return links
}

/**
 * The bottom of everything one Step nests, so a line leaves a container below
 * its regions rather than out of the middle of them.
 *
 * Read off the geometry rather than recomputed: every box the Step owns is
 * already placed, and the deepest edge among them is where its subtree ends.
 */
function extentOf(map: FlowMap, step: Step, ctx: Ctx): number {
  const own = map.placements.find((placement) => placement.ref.id === step.id)
  let bottom = own ? own.y + own.height : 0
  if (ctx.collapsed.has(step.id)) return bottom

  const ids = new Set<string>()
  const collect = (steps: readonly Step[]) => {
    for (const one of steps) {
      ids.add(one.id)
      for (const region of regionsOf(one)) collect(region.steps)
    }
  }
  for (const region of regionsOf(step)) collect(region.steps)

  for (const placement of map.placements) {
    if (ids.has(placement.ref.id)) bottom = Math.max(bottom, placement.y + placement.height)
  }
  for (const band of map.bands) {
    if (band.owner.id === step.id || ids.has(band.owner.id)) {
      bottom = Math.max(bottom, band.y + band.height)
    }
  }
  for (const mark of map.joins) {
    if (mark.owner.id === step.id || ids.has(mark.owner.id)) {
      bottom = Math.max(bottom, mark.y + mark.height)
    }
  }
  return bottom
}

/** One Board's Placement for a Step, or undefined when that Step is collapsed away. */
export const placementOf = (map: FlowMap, ref: StepRef): Placement | undefined =>
  map.placements.find((placement) => stepKey(placement.ref) === stepKey(ref))

const NOTHING_COLLAPSED: ReadonlySet<string> = new Set()
const NO_MANIFESTS: ReadonlyMap<string, Manifest> = new Map()

/**
 * What every combinator below needs and none of them changes.
 *
 * One object rather than three parameters threaded through six functions: the
 * arguments that describe *this* layout are all here, so a seventh cannot be
 * added by widening five signatures and forgetting the sixth.
 */
interface Ctx {
  readonly board: BoardId
  readonly collapsed: ReadonlySet<string>
  readonly manifests: ReadonlyMap<string, Manifest>
}

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
function stack(steps: readonly Step[], ctx: Ctx): Box {
  if (steps.length === 0) return EMPTY

  const boxes = steps.map((step) => place(step, ctx))
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
function place(step: Step, ctx: Ctx): Box {
  const height = heightOf(step, ctx.manifests.get(step.use))
  const ref: StepRef = { board: ctx.board, id: step.id }
  const regions = ctx.collapsed.has(step.id) ? [] : [...regionsOf(step)]
  const under: Box[] = []

  const branches = regions.filter((region) => region.kind === 'branch')
  if (branches.length > 0) {
    under.push(join(spread(branches.map((one) => labelled(one, ref, ctx))), ref))
  }
  for (const region of regions.filter((one) => one.kind !== 'branch')) {
    under.push(labelled(region, ref, ctx))
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
function labelled(region: Region, owner: StepRef, ctx: Ctx): Box {
  const inner = shift(stack(region.steps, ctx), 0, LAYOUT.regionLabel)
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
