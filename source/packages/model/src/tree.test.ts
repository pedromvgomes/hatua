import type { Step } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import { isContainer, nameOf, regionsOf, summaryOf } from './tree'

/**
 * The region vocabulary: which regions a Step nests, what each one is called,
 * and what a card or a row says about the Step itself.
 *
 * All of it is here rather than at each surface. `<StepList>`, `@hatua/layout`
 * and `<FlowMap>` are three readers of one question, and a word each of them
 * worked out for itself is a word two of them can disagree about.
 */

const fork = (branches: { label: string; when?: string }[]): Step => ({
  id: 'sort',
  use: 'core.fork',
  with: { mode: 'condition' },
  branches: branches.map((branch) => ({ ...branch, steps: [] })),
})

const keywords = (step: Step) => [...regionsOf(step)].map((region) => region.keyword)

describe('the word over a region', () => {
  it('reads a condition fork off its Branches, because the schema has no mode field', () => {
    expect(
      keywords(fork([{ label: 'A', when: 'x' }, { label: 'B', when: 'y' }, { label: 'C' }])),
    ).toEqual(['if', 'else if', 'else'])
  })

  it('calls every Branch of a parallel fork `and`', () => {
    expect(keywords(fork([{ label: 'A' }, { label: 'B' }]))).toEqual(['and', 'and'])
  })

  it('says `try` over a try’s body and `loop` over everything else’s', () => {
    // `steps:` is one key holding two ideas. Reading "loop" over the Steps a
    // try is protecting would name the wrong control flow.
    expect(keywords({ id: 't', use: 'core.try', steps: [] })).toEqual(['try'])
    expect(keywords({ id: 'e', use: 'core.for_each', steps: [] })).toEqual(['loop'])
    expect(keywords({ id: 'r', use: 'core.repeat', steps: [] })).toEqual(['loop'])
  })

  it('says `on failure` over a handler, on any verb', () => {
    // A `handler:` on a fork is meaningless and no runner reads it, but
    // `walkSteps` yields the Steps inside it — so a surface that refused to
    // name the region would make them unreachable rather than absent.
    expect(keywords({ id: 'f', use: 'core.fork', handler: [] })).toEqual(['on failure'])
  })

  it('names every region a Step carries, in document order', () => {
    const confused: Step = {
      id: 'c',
      use: 'core.fork',
      branches: [{ label: 'One', when: 'x', steps: [] }],
      steps: [],
      handler: [],
    }
    expect([...regionsOf(confused)].map((region) => region.kind)).toEqual([
      'branch',
      'body',
      'handler',
    ])
    expect(keywords(confused)).toEqual(['if', 'loop', 'on failure'])
  })
})

describe('nameOf', () => {
  it('falls back to the id, which is what a Step always has', () => {
    expect(nameOf({ id: 's1', use: 'core.end', name: 'Stop' })).toBe('Stop')
    expect(nameOf({ id: 's1', use: 'core.end' })).toBe('s1')
    expect(nameOf({ id: 's1', use: 'core.end', name: '' })).toBe('s1')
  })
})

describe('summaryOf', () => {
  it('is the verb alone on a leaf', () => {
    expect(summaryOf({ id: 's1', use: 'component.email.fetch' })).toBe('component.email.fetch')
  })

  it('counts a fork’s Branches', () => {
    expect(summaryOf(fork([{ label: 'A' }, { label: 'B' }]))).toBe('core.fork · 2 branches')
    expect(summaryOf(fork([{ label: 'A' }]))).toBe('core.fork · 1 branch')
  })

  /*
   * Enumerated off `regionsOf` rather than off `steps:`. Read off the body
   * alone, a `core.try` carrying only a handler says `core.try` and nothing
   * more — a card with a chevron and an `on failure` region under it,
   * describing itself as a leaf.
   */
  it('says a try has a handler even when it has no body', () => {
    const step: Step = { id: 't', use: 'core.try', handler: [{ id: 'h', use: 'core.end' }] }
    expect(isContainer(step)).toBe(true)
    expect(summaryOf(step)).toBe('core.try · handler')
  })

  it('says both regions of a try that has both', () => {
    expect(
      summaryOf({
        id: 't',
        use: 'core.try',
        steps: [{ id: 'a', use: 'core.end' }],
        handler: [{ id: 'h', use: 'core.end' }],
      }),
    ).toBe('core.try · 1 step · handler')
  })

  it('reports a region that is present and empty, which is not an absent one', () => {
    expect(summaryOf({ id: 'e', use: 'core.for_each', steps: [] })).toBe('core.for_each · 0 steps')
  })

  it('gains a region by construction, rather than by remembering to ask', () => {
    // Every region the walk yields is in the summary, on a Step carrying all
    // three keys at once — the shape no verb owns and nothing refuses.
    const confused: Step = {
      id: 'c',
      use: 'core.fork',
      branches: [{ label: 'One', steps: [] }],
      steps: [{ id: 'b', use: 'core.end' }],
      handler: [],
    }
    expect(summaryOf(confused)).toBe('core.fork · 1 branch · 1 step · handler')
  })
})
