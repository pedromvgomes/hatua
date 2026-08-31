import type { Step } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import { DOC } from './fixtures'
import {
  type Segment,
  segmentBetween,
  segmentHolds,
  segmentOf,
  segmentReturns,
  segmentSteps,
  siblingFrom,
  siblingsOf,
} from './segment'
import { boardOf } from './tree'

const ROOT = boardOf(DOC, null)
if (!ROOT) throw new Error('the root Board is the fixture')

const ids = (steps: readonly { id: string }[]) => steps.map((step) => step.id)

describe('siblingsOf', () => {
  it('finds a Step in the Board’s root sequence', () => {
    expect(siblingsOf(ROOT, 's2')).toMatchObject({ index: 0 })
    expect(ids(siblingsOf(ROOT, 's3')?.steps ?? [])).toEqual(['s2', 's3'])
  })

  it('finds a Step nested inside a Branch', () => {
    expect(ids(siblingsOf(ROOT, 's6')?.steps ?? [])).toEqual(['s4', 's6'])
    expect(siblingsOf(ROOT, 's6')?.index).toBe(1)
  })

  it('finds a Step inside a loop’s body', () => {
    expect(ids(siblingsOf(ROOT, 's5')?.steps ?? [])).toEqual(['s5'])
  })

  it('is undefined for a Step the Board does not hold', () => {
    expect(siblingsOf(ROOT, 'nope')).toBeUndefined()
  })
})

describe('segmentBetween', () => {
  it('reaches from one sibling to another, in document order', () => {
    expect(segmentBetween(ROOT, 's2', 's3')).toEqual({ board: null, steps: ['s2', 's3'] })
  })

  it('says the same thing when the selection was extended upwards', () => {
    expect(segmentBetween(ROOT, 's3', 's2')).toEqual(segmentBetween(ROOT, 's2', 's3'))
  })

  it('reaches between siblings inside a region', () => {
    expect(segmentBetween(ROOT, 's4', 's6')).toEqual({ board: null, steps: ['s4', 's6'] })
  })

  it('is one Step when both ends are the same Step', () => {
    expect(segmentBetween(ROOT, 's3', 's3')).toEqual({ board: null, steps: ['s3'] })
  })

  /*
   * The property ADR-0020 rests on: there is no pair of Steps that produces a
   * selection extraction would have to refuse. Two Steps in different regions
   * do not make a Segment at all, so the canvas has nothing to represent.
   */
  it('refuses two Steps that are not siblings', () => {
    expect(segmentBetween(ROOT, 's2', 's6')).toBeUndefined()
    expect(segmentBetween(ROOT, 's5', 's6')).toBeUndefined()
  })

  it('refuses two Steps in sibling regions of one Fork', () => {
    expect(segmentBetween(ROOT, 's6', 's7')).toBeUndefined()
  })
})

describe('segmentSteps', () => {
  it('resolves a Segment against the document, in document order', () => {
    const held: Segment = { board: null, steps: ['s3', 's2'] }
    expect(ids(segmentSteps(DOC, held))).toEqual(['s2', 's3'])
  })

  it('drops a Step that has been removed and keeps the rest', () => {
    const gone: Segment = { board: null, steps: ['s2', 'removed', 's3'] }
    expect(ids(segmentSteps(DOC, gone))).toEqual(['s2', 's3'])
  })

  /*
   * A Segment survives losing the Step it was anchored on. Resolving against
   * `steps[0]` alone would drop the whole selection the moment its leading Step
   * went, which is exactly what removing part of a Segment does.
   */
  it('resolves when the Segment’s leading Step is the one that went', () => {
    const gone: Segment = { board: null, steps: ['removed', 's3'] }
    expect(ids(segmentSteps(DOC, gone))).toEqual(['s3'])
  })

  it('is empty for a Board the document does not hold', () => {
    expect(segmentSteps(DOC, { board: 'no_such_block', steps: ['s2'] })).toEqual([])
  })

  it('is empty when every Step named has gone', () => {
    expect(segmentSteps(DOC, { board: null, steps: ['gone'] })).toEqual([])
  })
})

describe('segmentHolds', () => {
  it('holds a Step the Segment names on the same Board', () => {
    expect(segmentHolds({ board: null, steps: ['s2'] }, { board: null, id: 's2' })).toBe(true)
  })

  /* Ids are Board-local, so a bare id would highlight a card on every Board. */
  it('does not hold the same id on another Board', () => {
    expect(segmentHolds({ board: null, steps: ['ret'] }, { board: 'blk', id: 'ret' })).toBe(false)
  })

  it('holds nothing when there is no Segment', () => {
    expect(segmentHolds(undefined, { board: null, id: 's2' })).toBe(false)
  })
})

describe('siblingFrom', () => {
  it('steps to the next sibling and back to the previous', () => {
    expect(siblingFrom(ROOT, 's2', 1)).toBe('s3')
    expect(siblingFrom(ROOT, 's3', -1)).toBe('s2')
  })

  it('stops at the ends of the sibling list rather than leaving the region', () => {
    expect(siblingFrom(ROOT, 's2', -1)).toBeUndefined()
    expect(siblingFrom(ROOT, 's3', 1)).toBeUndefined()
    expect(siblingFrom(ROOT, 's4', -1)).toBeUndefined()
    expect(siblingFrom(ROOT, 's6', 1)).toBeUndefined()
  })
})

describe('segmentOf', () => {
  it('is the one-Step Segment a plain click makes', () => {
    expect(segmentOf({ board: 'blk', id: 'ret' })).toEqual({ board: 'blk', steps: ['ret'] })
  })
})

/**
 * What extraction refuses (ADR-0018). A Return moved onto a new Board binds to
 * ITS outputs and ends a Block the author did not mean to end.
 */
describe('segmentReturns', () => {
  const send = (id: string): Step => ({ id, use: 'component.email.send' }) as Step
  const ret = (id: string): Step => ({ id, use: 'core.return' }) as Step

  it('is false for a selection of ordinary Steps', () => {
    expect(segmentReturns([send('a'), send('b')])).toBe(false)
  })

  it('is true when a selected Step is itself a Return', () => {
    expect(segmentReturns([send('a'), ret('r')])).toBe(true)
  })

  /*
   * The case a check of the Segment's own Steps misses. A Return inside a Fork
   * branch inside the selection moves with it and binds exactly the same way,
   * so a rule that looked only at the top level would offer the gesture on the
   * one shape it exists to refuse.
   */
  it('is true for a Return nested inside a selected container', () => {
    const fork = {
      id: 'f',
      use: 'core.fork',
      branches: [
        { label: 'A', steps: [ret('r')] },
        { label: 'B', steps: [send('b')] },
      ],
    } as unknown as Step
    expect(segmentReturns([fork])).toBe(true)
  })

  it('is true for a Return inside a loop body and inside a handler', () => {
    const loop = { id: 'l', use: 'core.for_each', steps: [ret('r')] } as unknown as Step
    const guarded = { id: 't', use: 'core.try', steps: [], handler: [ret('r')] } as unknown as Step
    expect(segmentReturns([loop])).toBe(true)
    expect(segmentReturns([guarded])).toBe(true)
  })
})
