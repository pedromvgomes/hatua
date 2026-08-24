import { type Board, boards, regionsOf, stepKey, walkSteps } from '@hatua/model'
import type { Step, WorkflowDefinition } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import {
  ALL_REGIONS,
  DEEP,
  EMPTY_BOARD,
  EMPTY_REGIONS,
  MANIFESTS,
  MIXED_REGIONS,
  SHAPES,
  TWO_RETS,
} from './fixtures'
import { type Band, LAYOUT, layout, type Placement, placementOf, type Rect } from './layout'

const boardsOf = (doc: WorkflowDefinition): Board[] => [...boards(doc)]

const at = (map: ReturnType<typeof layout>, id: string): Placement => {
  const found = placementOf(map, { board: map.board, id })
  if (!found) throw new Error(`No Placement for "${id}"`)
  return found
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

describe('layout', () => {
  // A glob or a list that quietly matched nothing makes every property below
  // pass while checking none of them.
  it('has shapes to lay out', () => {
    expect(SHAPES.length).toBeGreaterThan(0)
    expect(SHAPES.flatMap(({ doc }) => boardsOf(doc)).length).toBeGreaterThan(SHAPES.length)
  })

  describe('every Step is placed exactly once', () => {
    for (const { name, doc } of SHAPES) {
      it(name, () => {
        for (const board of boardsOf(doc)) {
          const map = layout(board)
          const walked = [...walkSteps(board.steps)].map((step) =>
            stepKey({ board: board.id, id: step.id }),
          )
          const placed = map.placements.map((placement) => stepKey(placement.ref))

          // Sorted sets first: when a region is forgotten, that is the readable
          // failure. Then the counts, which is what catches a Step placed twice.
          expect([...placed].sort()).toEqual([...walked].sort())
          expect(placed.length).toBe(walked.length)
        }
      })
    }
  })

  it('covers all four regions in the fixture that cross-checks the walk', () => {
    const ids = [...walkSteps(ALL_REGIONS.steps)].map((step) => step.id)
    // A Step from each region: a Branch's, the other Branch's, a loop body's, a
    // try's body and a try's handler.
    expect(ids).toEqual(expect.arrayContaining(['each', 'quiet', 'guarded', 'triage', 'shelve']))
  })

  it('gives two Blocks that each hold a `ret` two addressable Placements', () => {
    const [, alpha, beta] = boardsOf(TWO_RETS)
    if (!alpha || !beta) throw new Error('fixture lost a Block')

    const one = at(layout(alpha), 'ret')
    const other = at(layout(beta), 'ret')

    expect(stepKey(one.ref)).toBe('alpha/ret')
    expect(stepKey(other.ref)).toBe('beta/ret')
    expect(stepKey(one.ref)).not.toBe(stepKey(other.ref))
  })

  describe('the same Board laid out twice is the same map', () => {
    for (const { name, doc } of SHAPES) {
      it(name, () => {
        for (const board of boardsOf(doc)) {
          // Serialised rather than field-checked: ADR-0001's promise is that the
          // map is a function of the document, and spot-checking a few numbers
          // is not that promise.
          expect(JSON.stringify(layout(board))).toBe(JSON.stringify(layout(board)))
        }
      })
    }
  })

  describe('no two cards overlap', () => {
    for (const { name, doc } of SHAPES) {
      it(name, () => {
        for (const board of boardsOf(doc)) {
          const map = layout(board)
          for (const [i, a] of map.placements.entries()) {
            expect(overlaps(a, map.root)).toBe(false)
            for (const b of map.placements.slice(i + 1)) {
              expect({ a: stepKey(a.ref), b: stepKey(b.ref), hit: overlaps(a, b) }).toEqual({
                a: stepKey(a.ref),
                b: stepKey(b.ref),
                hit: false,
              })
            }
          }
        }
      })
    }
  })

  describe('the totals describe the map that was drawn', () => {
    for (const { name, doc } of SHAPES) {
      it(name, () => {
        for (const board of boardsOf(doc)) {
          const map = layout(board)
          for (const box of [map.root, ...map.placements]) {
            expect(box.x).toBeGreaterThanOrEqual(0)
            expect(box.y).toBeGreaterThanOrEqual(0)
            expect(box.x + box.width).toBeLessThanOrEqual(map.width)
            expect(box.y + box.height).toBeLessThanOrEqual(map.height)
          }
        }
      })
    }
  })

  it('draws the Board root above every Step on it', () => {
    const [board] = boardsOf(ALL_REGIONS)
    if (!board) throw new Error('fixture lost its root Board')
    const map = layout(board)

    expect(map.root.y).toBe(0)
    for (const placement of map.placements) {
      expect(placement.y).toBeGreaterThanOrEqual(map.root.y + map.root.height)
    }
  })

  it('is the root node and nothing else on an empty Board', () => {
    const [board] = boardsOf(EMPTY_BOARD)
    if (!board) throw new Error('fixture lost its root Board')
    const map = layout(board)

    expect(map.placements).toEqual([])
    expect(map.height).toBe(LAYOUT.nodeHeight)
    expect(map.width).toBe(LAYOUT.nodeWidth)
  })
})

describe('regions', () => {
  const rootOf = (doc: WorkflowDefinition) => {
    const [board] = boardsOf(doc)
    if (!board) throw new Error('fixture lost its root Board')
    return layout(board)
  }

  it('lays a Fork out as columns', () => {
    const map = rootOf(ALL_REGIONS)
    const left = at(map, 'each')
    const right = at(map, 'quiet')

    expect(left.x).not.toBe(right.x)
    // Side by side means neither column's cards reach into the other's band.
    expect(Math.abs(left.x - right.x)).toBeGreaterThanOrEqual(LAYOUT.branchGap)
  })

  it('stacks a `core.try`’s body above its handler on one spine', () => {
    const map = rootOf(ALL_REGIONS)
    const body = at(map, 'triage')
    const handler = at(map, 'shelve')

    expect(handler.y).toBeGreaterThan(body.y + body.height)
    expect(handler.x).toBe(body.x)
  })

  it('leaves each region room for the label that names it', () => {
    const map = rootOf(ALL_REGIONS)
    const container = at(map, 'guarded')
    const body = at(map, 'triage')

    expect(body.y - (container.y + container.height)).toBe(LAYOUT.verticalGap + LAYOUT.regionLabel)
  })

  it('lays out every region a Step carries, not the ones its verb implies', () => {
    const map = rootOf(MIXED_REGIONS)
    const columns = [at(map, 'in_branch'), at(map, 'in_other')]
    const stacked = [at(map, 'in_body'), at(map, 'in_handler')]

    expect(columns[0]?.x).not.toBe(columns[1]?.x)
    // The stacked regions sit below the columns rather than in place of them.
    for (const column of columns) {
      for (const below of stacked) expect(below.y).toBeGreaterThan(column.y)
    }
    expect(stacked[1]?.y).toBeGreaterThan(stacked[0]?.y ?? 0)
  })

  it('keeps a container with two empty regions a container, and reserves both bands', () => {
    const map = rootOf(EMPTY_REGIONS)
    const container = at(map, 'try_nothing')
    const below = at(map, 'wide')

    // `steps: []` and `handler: []` are regions with nothing in them, not absent
    // regions: each band still takes its room, so an empty `handler:` is
    // somewhere a Step can be dropped.
    const bands = 2 * (LAYOUT.verticalGap + LAYOUT.regionLabel)
    expect(below.y - (container.y + container.height)).toBe(bands + LAYOUT.verticalGap)
  })
})

/**
 * A card is the taller one when it has something to say below its name, and what
 * it has to say is its filled Slots — which only a Component Manifest names.
 *
 * `isContainer` was the rule and it is not: `core.fork` declares `fields: []`, so
 * a Fork has nothing to show and is the short card, while a `core.for_each`
 * declares `list` and is the tall one. Both are containers.
 */
describe('the two heights', () => {
  const laid = (doc: WorkflowDefinition) => {
    const [board] = boardsOf(doc)
    if (!board) throw new Error('fixture lost its root Board')
    return layout(board, { manifests: MANIFESTS })
  }
  const bare = (doc: WorkflowDefinition) => {
    const [board] = boardsOf(doc)
    if (!board) throw new Error('fixture lost its root Board')
    return layout(board)
  }
  const heightOfId = (map: ReturnType<typeof layout>, id: string) =>
    map.placements.find((one) => one.ref.id === id)?.height

  it('gives a Step with a filled Slot the taller card', () => {
    // `core.for_each` declares `list`, and this one fills it.
    expect(heightOfId(laid(ALL_REGIONS), 'each')).toBe(LAYOUT.nodeHeightWithMeta)
  })

  it('gives a container with no fields the shorter card, the same as a leaf', () => {
    const map = laid(ALL_REGIONS)
    // A Fork is a container and has nothing to show; `core.end` is a leaf with
    // nothing to show. One rule, and it is not about nesting.
    expect(heightOfId(map, 'sort')).toBe(LAYOUT.nodeHeight)
    expect(heightOfId(map, 'quiet')).toBe(LAYOUT.nodeHeight)
  })

  it('gives a Step whose declared Slot is empty the shorter card', () => {
    // `component.agent.act` declares `prompt` and this Step fills nothing, so
    // there is no chip to reserve a row for.
    expect(heightOfId(laid(ALL_REGIONS), 'triage')).toBe(LAYOUT.nodeHeight)
  })

  it('gives every card the shorter one before a catalogue arrives', () => {
    // A verb no manifest declares has no contract to state, so reserving a row
    // for it would be the taller card with nothing in it.
    for (const placement of bare(ALL_REGIONS).placements) {
      expect(placement.height).toBe(LAYOUT.nodeHeight)
    }
  })
})

describe('bands', () => {
  const rootOf = (doc: WorkflowDefinition) => {
    const [board] = boardsOf(doc)
    if (!board) throw new Error('fixture lost its root Board')
    return layout(board)
  }

  const bandFor = (map: ReturnType<typeof layout>, id: string, keyword: string): Band => {
    const found = map.bands.find((band) => band.owner.id === id && band.keyword === keyword)
    if (!found) throw new Error(`No "${keyword}" band under "${id}"`)
    return found
  }

  /**
   * The bands are the same enumeration the cards are.
   *
   * A canvas draws a region because a band says there is one, so a band the
   * layout forgets is a region the map has no frame and no word for — the same
   * failure as a Step nothing places, one level up.
   */
  describe('one band per region the walk yields', () => {
    for (const { name, doc } of SHAPES) {
      it(name, () => {
        for (const board of boardsOf(doc)) {
          const map = layout(board)
          const expected = [...walkSteps(board.steps)].flatMap((step) =>
            [...regionsOf(step)].map((region) => `${step.id}:${region.kind}:${region.keyword}`),
          )
          const drawn = map.bands.map((band) => `${band.owner.id}:${band.kind}:${band.keyword}`)

          expect([...drawn].sort()).toEqual([...expected].sort())
          expect(drawn.length).toBe(expected.length)
        }
      })
    }
  })

  it('has bands to check', () => {
    expect(rootOf(ALL_REGIONS).bands.length).toBeGreaterThan(0)
  })

  it('says the word `regionsOf` says, and never works one out for itself', () => {
    const map = rootOf(ALL_REGIONS)
    expect(bandFor(map, 'guarded', 'try').kind).toBe('body')
    expect(bandFor(map, 'guarded', 'on failure').kind).toBe('handler')
    expect(bandFor(map, 'each', 'loop').kind).toBe('body')
    expect(
      map.bands.filter((band) => band.owner.id === 'sort').map((band) => band.keyword),
    ).toEqual(['if', 'else'])
  })

  it('covers the region it names — the label strip and every card under it', () => {
    const map = rootOf(ALL_REGIONS)
    const band = bandFor(map, 'guarded', 'try')
    const card = at(map, 'triage')

    // The strip is at the band's top and the cards start below it, so the band
    // is the whole region rather than the label over one.
    expect(card.y).toBe(band.y + LAYOUT.regionLabel)
    expect(card.y + card.height).toBeLessThanOrEqual(band.y + band.height)
    expect(card.x).toBeGreaterThanOrEqual(band.x)
    expect(card.x + card.width).toBeLessThanOrEqual(band.x + band.width)
  })

  it('is a card wide and a label tall where the region is empty', () => {
    // The one place the band is the only thing on screen. A canvas recomputing
    // this from the Placements inside it would have nothing to work from.
    const map = rootOf(EMPTY_REGIONS)
    const band = bandFor(map, 'try_nothing', 'on failure')

    expect(band.height).toBe(LAYOUT.regionLabel)
    expect(band.width).toBe(LAYOUT.nodeWidth)
  })

  it('sits inside the map it belongs to', () => {
    for (const { doc } of SHAPES) {
      for (const board of boardsOf(doc)) {
        const map = layout(board)
        for (const band of [...map.bands, ...map.joins]) {
          expect(band.x).toBeGreaterThanOrEqual(0)
          expect(band.y).toBeGreaterThanOrEqual(0)
          expect(band.x + band.width).toBeLessThanOrEqual(map.width)
          expect(band.y + band.height).toBeLessThanOrEqual(map.height)
        }
      }
    }
  })

  it('drops a collapsed container’s bands with its cards', () => {
    const [board] = boardsOf(ALL_REGIONS)
    if (!board) throw new Error('fixture lost its root Board')
    const map = layout(board, { collapsed: new Set(['sort']) })

    expect(map.bands.filter((band) => band.owner.id === 'sort')).toEqual([])
    expect(map.joins.filter((join) => join.owner.id === 'sort')).toEqual([])
    // And the regions nested inside those Branches go with them.
    expect(map.bands.filter((band) => band.owner.id === 'guarded')).toEqual([])
  })

  describe('joins', () => {
    it('marks a Fork’s Branches and nothing else', () => {
      const map = rootOf(ALL_REGIONS)
      expect(map.joins.map((join) => join.owner.id)).toEqual(['sort'])
    })

    it('spans the columns, below the last of them', () => {
      const map = rootOf(ALL_REGIONS)
      const [mark] = map.joins
      if (!mark) throw new Error('the Fork lost its join')

      expect(mark.height).toBe(LAYOUT.joinMarker)
      for (const keyword of ['if', 'else']) {
        const column = bandFor(map, 'sort', keyword)
        expect(mark.y).toBeGreaterThanOrEqual(column.y + column.height)
        expect(mark.x).toBeLessThanOrEqual(column.x)
        expect(mark.x + mark.width).toBeGreaterThanOrEqual(column.x + column.width)
      }
    })
  })
})

/**
 * The gaps. This is what makes the canvas the surface a workflow is built on
 * rather than a picture of one: a Step goes in where a link says it goes.
 */
describe('links', () => {
  const rootOf = (doc: WorkflowDefinition) => {
    const [board] = boardsOf(doc)
    if (!board) throw new Error('fixture lost its root Board')
    return layout(board)
  }

  /** Every step list on one Board, as the insert-point prefix that names it. */
  const listsOn = (board: Board): number[] => {
    const lengths: number[] = []
    const walk = (steps: readonly Step[]) => {
      lengths.push(steps.length)
      for (const step of steps) for (const region of regionsOf(step)) walk(region.steps)
    }
    walk(board.steps)
    return lengths
  }

  /**
   * One link per gap, and a list of three Steps has four — the same count
   * `<StepList>` draws between its rows. A map offering fewer insert points than
   * the list is a canvas a workflow cannot be built on.
   */
  describe('one per gap in every step list', () => {
    for (const { name, doc } of SHAPES) {
      it(name, () => {
        for (const board of boardsOf(doc)) {
          const map = layout(board)
          const expected = listsOn(board).reduce((total, length) => total + length + 1, 0)
          const insertable = map.links.filter((link) => link.at !== undefined)

          expect(insertable).toHaveLength(expected)
          // Every one names a distinct position: two links onto one gap would be
          // two `+` buttons doing the same thing.
          expect(new Set(insertable.map((link) => JSON.stringify(link.at))).size).toBe(expected)
        }
      })
    }
  })

  it('puts a `+` under the root node of an empty Board, and nothing else', () => {
    const map = rootOf(EMPTY_BOARD)
    expect(map.links).toHaveLength(1)
    expect(map.links[0]?.at).toEqual({ board: null, index: 0 })
    // It leaves from the root node, which is the only thing drawn.
    expect(map.links[0]?.from.y).toBe(map.root.y + map.root.height)
  })

  it('names the Board every insert point is on', () => {
    for (const board of boardsOf(TWO_RETS)) {
      for (const link of layout(board).links) {
        if (link.at) expect(link.at.board).toBe(board.id)
      }
    }
  })

  it('leaves a container below everything it nests, not out of the middle of it', () => {
    // The line out of a loop starts under its body. Taken from the card's own
    // bottom it would cross every region the container owns.
    const map = rootOf(ALL_REGIONS)
    const loop = at(map, 'each')
    const inside = at(map, 'triage')
    const after = map.links.find(
      (link) => link.at?.parentId === undefined && link.at?.index === 2 && link.at.board === null,
    )

    expect(after).toBeDefined()
    expect(loop.y).toBeLessThan(inside.y)
    const leaving = map.links.find((link) => link.at?.parentId === 'each' && link.at.index === 1)
    expect(leaving?.from.y).toBeGreaterThan(inside.y + inside.height)
  })

  it('enters each Branch with the word that names it, and comes back to the join', () => {
    const map = rootOf(ALL_REGIONS)
    const branches = map.links.filter((link) => link.kind === 'branch')
    expect(branches.map((link) => link.label)).toEqual(['if', 'else'])
    for (const link of branches) expect(link.owner?.id).toBe('sort')

    const joins = map.links.filter((link) => link.kind === 'join')
    expect(joins).toHaveLength(2)
    // The join IS the last gap of its Branch. A stub beside it would leave two
    // lines out of one card — one to the mark and one to nothing.
    for (const link of joins) expect(link.at?.parentId).toBe('sort')
    const [mark] = map.joins
    for (const link of joins) expect(link.to.y).toBe((mark?.y ?? 0) + (mark?.height ?? 0) / 2)
  })

  it('puts a Branch’s label in its own column, where two cannot collide', () => {
    // Both of a Fork's branch links leave the same point, so a fraction along
    // the line is the same place twice. The strip `regionLabel` reserves at the
    // top of each column cannot collide: the columns are `branchGap` apart.
    const map = rootOf(ALL_REGIONS)
    const labelled = map.links.filter(
      (link) => link.label !== undefined && link.branchIndex !== undefined,
    )
    expect(labelled).toHaveLength(2)

    const [first, second] = labelled
    expect(first?.labelAt?.x).not.toBe(second?.labelAt?.x)
    for (const link of labelled) {
      const band = map.bands.find(
        (one) => one.owner.id === 'sort' && one.x + one.width / 2 === link.labelAt?.x,
      )
      expect(band).toBeDefined()
      expect(link.labelAt?.y).toBe((band?.y ?? 0) + LAYOUT.regionLabel / 2)
    }
  })

  it('carries the region keyword onto the link that enters it', () => {
    const map = rootOf(ALL_REGIONS)
    const entering = (parentId: string, region?: 'handler') =>
      map.links.find(
        (link) =>
          link.at?.parentId === parentId && link.at.index === 0 && link.at.region === region,
      )

    expect(entering('guarded')?.label).toBe('try')
    expect(entering('guarded', 'handler')?.label).toBe('on failure')
    expect(entering('each')?.label).toBe('loop')
  })

  /**
   * The line into an empty region has to arrive *in* that region.
   *
   * With nothing inside it there is no card to aim at, so the anchor is the
   * region's own band. Without it the link runs from the container straight to
   * wherever the list ends — down the spine, past the column its own label is
   * sitting over, which is a line that says the Branch is somewhere it is not.
   */
  it('lands a link inside an empty region rather than past it', () => {
    const map = rootOf(EMPTY_REGIONS)

    // Every region with nothing in it: the Fork's middle Branch, and a
    // `core.try` whose body and handler are both empty.
    const empties = map.links.filter((link) => {
      const band = map.bands.find(
        (one) =>
          one.owner.id === link.at?.parentId &&
          one.x + one.width / 2 === link.to.x &&
          one.y + LAYOUT.regionLabel === link.to.y,
      )
      return link.at?.index === 0 && band !== undefined
    })
    expect(empties.length).toBeGreaterThanOrEqual(3)

    for (const region of ['try_nothing', 'wide']) {
      const bands = map.bands.filter((one) => one.owner.id === region)
      for (const band of bands) {
        if (band.height !== LAYOUT.regionLabel) continue
        // An empty region is exactly its label strip tall. The link into it
        // ends under that strip, on that column.
        const into = map.links.find(
          (link) =>
            link.to.x === band.x + band.width / 2 && link.to.y === band.y + LAYOUT.regionLabel,
        )
        expect(into, `nothing lands in the empty ${band.keyword} under ${region}`).toBeDefined()
        expect(into?.at?.index).toBe(0)
      }
    }
  })

  it('offers the gap inside an empty region, which is the only way to fill it', () => {
    const map = rootOf(EMPTY_REGIONS)
    const into = map.links.filter((link) => link.at?.parentId === 'try_nothing')
    expect(into.map((link) => link.at?.region)).toEqual([undefined, 'handler'])
    for (const link of into) expect(link.at?.index).toBe(0)
  })

  it('drops a collapsed container’s gaps with its cards', () => {
    const [board] = boardsOf(ALL_REGIONS)
    if (!board) throw new Error('fixture lost its root Board')
    const map = layout(board, { collapsed: new Set(['sort']) })

    expect(map.links.filter((link) => link.at?.parentId === 'sort')).toEqual([])
    expect(map.links.filter((link) => link.kind === 'join')).toEqual([])
  })

  it('stays inside the map it belongs to', () => {
    for (const { doc } of SHAPES) {
      for (const board of boardsOf(doc)) {
        const map = layout(board)
        for (const link of map.links) {
          for (const point of [link.from, link.to]) {
            expect(point.x).toBeGreaterThanOrEqual(0)
            expect(point.y).toBeGreaterThanOrEqual(0)
            expect(point.x).toBeLessThanOrEqual(map.width)
          }
        }
      }
    }
  })
})

describe('collapse', () => {
  const boardOf = (doc: WorkflowDefinition): Board => {
    const [board] = boardsOf(doc)
    if (!board) throw new Error('fixture lost its root Board')
    return board
  }

  it('places nothing for a collapsed container’s children', () => {
    const board = boardOf(ALL_REGIONS)
    const map = layout(board, { collapsed: new Set(['guarded']) })
    const placed = map.placements.map((placement) => stepKey(placement.ref))

    expect(placed).toContain('guarded')
    expect(placed).not.toContain('triage')
    expect(placed).not.toContain('shelve')
  })

  it('collapses every region of a container, not the first one', () => {
    const board = boardOf(DEEP)
    const open = layout(board)
    const shut = layout(board, { collapsed: new Set(['attempt']) })

    for (const id of ['call', 'sweep', 'note']) {
      expect(open.placements.some((one) => one.ref.id === id)).toBe(true)
      expect(shut.placements.some((one) => one.ref.id === id)).toBe(false)
    }
  })

  it('shrinks the map rather than hiding cards inside it', () => {
    const board = boardOf(ALL_REGIONS)
    const open = layout(board)
    const shut = layout(board, { collapsed: new Set(['sort']) })

    expect(shut.height).toBeLessThan(open.height)
    expect(shut.width).toBeLessThanOrEqual(open.width)
  })

  it('is a function of the collapsed set, and of nothing else', () => {
    const board = boardOf(ALL_REGIONS)
    const collapsed = new Set(['guarded'])

    expect(JSON.stringify(layout(board, { collapsed }))).toBe(
      JSON.stringify(layout(board, { collapsed: new Set(['guarded']) })),
    )
  })
})

describe('nothing is persisted', () => {
  for (const { name, doc } of SHAPES) {
    it(name, () => {
      const before = structuredClone(doc)
      for (const board of boards(doc)) layout(board, { collapsed: new Set(['guarded', 'sort']) })
      // No position reaches the document, and no Step gains a key it did not
      // have: the map is a reading of the tree (ADR-0001), so a layout call the
      // document could notice is the whole promise gone.
      expect(doc).toEqual(before)
      expect(JSON.stringify(doc)).toBe(JSON.stringify(before))
    })
  }
})
