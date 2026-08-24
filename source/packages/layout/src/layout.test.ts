import { type Board, boards, stepKey, walkSteps } from '@hatua/model'
import type { WorkflowDefinition } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import { ALL_REGIONS, DEEP, EMPTY_BOARD, MIXED_REGIONS, SHAPES, TWO_RETS } from './fixtures'
import { LAYOUT, layout, type Placement, placementOf, type Rect } from './layout'

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

  it('gives a container the taller card and a leaf the shorter one', () => {
    const map = rootOf(ALL_REGIONS)

    expect(at(map, 'guarded').height).toBe(LAYOUT.nodeHeightWithMeta)
    expect(at(map, 'triage').height).toBe(LAYOUT.nodeHeight)
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
