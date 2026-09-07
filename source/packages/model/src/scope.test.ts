import type { ContextKey, WorkflowDefinition } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import { DOC, MANIFESTS } from './fixtures'
import { boardScope, newScopeMemo, scopeFor, upstreamOf } from './scope'
import { walkSteps } from './tree'

describe('tree traversal', () => {
  it('walks every step depth-first', () => {
    expect([...walkSteps(DOC.steps)].map((s) => s.id)).toEqual(['s2', 's3', 's4', 's5', 's6', 's7'])
  })
})

describe('reference scope', () => {
  it('includes ancestors and earlier siblings of every ancestor', () => {
    expect(upstreamOf(DOC, { board: null, id: 's5' }).map((s) => s.id)).toEqual(['s2', 's3', 's4'])
  })

  it('excludes sibling branches', () => {
    // s7 is in the fallback branch; it must not see s4/s5/s6 in the other one.
    expect(upstreamOf(DOC, { board: null, id: 's7' }).map((s) => s.id)).toEqual(['s2', 's3'])
  })

  it('excludes later siblings', () => {
    expect(upstreamOf(DOC, { board: null, id: 's2' })).toEqual([])
  })
})

describe('scopeFor', () => {
  it('offers every trigger regardless of tree position', () => {
    // A workflow cannot run without a trigger firing, so triggers are never
    // out of scope the way an upstream step can be.
    const paths = scopeFor(DOC, { board: null, id: 's5' }).map((e) => e.path)
    expect(paths).toContain('triggers.nightly')
    expect(paths).toContain('triggers.on_mail')
  })

  it('offers the TRIGGER built-in only when several triggers exist', () => {
    expect(scopeFor(DOC, { board: null, id: 's5' }).map((e) => e.path)).toContain('TRIGGER')

    const single = { ...DOC, triggers: [DOC.triggers![0]!] }
    expect(scopeFor(single, { board: null, id: 's5' }).map((e) => e.path)).not.toContain('TRIGGER')
  })

  it('offers workflow vars, which are scoped to the workflow not the position', () => {
    expect(scopeFor(DOC, { board: null, id: 's2' }).map((e) => e.path)).toContain('var.digest_to')
  })

  it('still constrains steps by tree position', () => {
    const paths = scopeFor(DOC, { board: null, id: 's7' }).map((e) => e.path)
    expect(paths).toContain('steps.s2')
    expect(paths).not.toContain('steps.s5')
  })
})

describe('boardScope', () => {
  const CONTEXT: ContextKey[] = [
    { k: 'id', label: 'Run id', t: 'text', description: 'Identifies this execution.' },
    {
      k: 'tenant',
      label: 'Tenant',
      t: 'object',
      of: [{ k: 'name', label: 'Tenant name', t: 'text' }],
    },
  ]

  /*
   * The reason it exists: a variable's value has no position in the tree, so
   * there is no Step to ask `scopeFor` about — and no Step is guaranteed to
   * have run by the time the value is evaluated either.
   */
  it('offers no step output at all, whatever the document holds', () => {
    const paths = boardScope(DOC).map((entry) => entry.path)
    expect(paths).not.toContain('s2')
    expect(paths).toContain('var.digest_to')
    expect(paths).toContain('triggers.nightly')
    expect(paths).toContain('TRIGGER')
  })

  it('offers the Host Run Context as `run.<key>`', () => {
    const paths = boardScope(DOC, null, [], CONTEXT).map((entry) => entry.path)
    expect(paths).toContain('run.id')
    expect(paths).toContain('run.tenant')
  })

  it('files Run Context under its own kind, so the tree can group it apart', () => {
    const entry = boardScope(DOC, null, [], CONTEXT).find(
      (candidate) => candidate.path === 'run.id',
    )
    expect(entry?.kind).toBe('context')
    expect(entry?.label).toBe('Run id')
    expect(entry?.description).toBe('Identifies this execution.')
  })

  it('nests a key through `of`, the way a manifest output nests', () => {
    const entry = boardScope(DOC, null, [], CONTEXT).find(
      (candidate) => candidate.path === 'run.tenant',
    )
    expect(entry?.type).toEqual({ type: 'object', members: { name: { type: 'text' } } })
  })

  /*
   * Nothing stops a Host assembling its array from several sources, and two
   * `run.tenant` entries are two rows in the completion list and two siblings
   * under one React key in the reference tree.
   */
  it('takes the first of a repeated key, the way every other lookup here does', () => {
    const twice: ContextKey[] = [
      { k: 'tenant', label: 'Tenant', t: 'text' },
      { k: 'tenant', label: 'Tenant again', t: 'number' },
    ]
    const found = boardScope(DOC, null, [], twice).filter((entry) => entry.path === 'run.tenant')
    expect(found).toHaveLength(1)
    expect(found[0]?.label).toBe('Tenant')
  })

  it('declares nothing when the Host declared nothing', () => {
    expect(boardScope(DOC).some((entry) => entry.kind === 'context')).toBe(false)
  })

  /*
   * The whole reason it is extracted rather than copied: two readers, one
   * definition of the unpositioned half.
   */
  it('is exactly the part of scopeFor that has no position', () => {
    const unpositioned = boardScope(DOC, null, MANIFESTS, CONTEXT)
    const positioned = scopeFor(DOC, { board: null, id: 's5' }, MANIFESTS, CONTEXT)
    expect(positioned.slice(0, unpositioned.length)).toEqual(unpositioned)
    expect(positioned.slice(unpositioned.length).every((entry) => entry.kind === 'step')).toBe(true)
  })
})

/**
 * A scope is *positional*, so a pass that checks every Template asks for one per
 * Step — and each answer names every Step upstream of it. That makes the pass
 * quadratic in the size of what it produces, which is inherent and fine.
 *
 * What is not fine is the walk that finds the upstream costing a copy of
 * everything above it *per Step it passes*, whether or not that Step has a
 * region to descend into. That makes one call quadratic on a flat list and the
 * pass cubic, and `validateDefinition` runs on every keystroke.
 *
 * A ratio rather than a millisecond budget, for the reason the layout suite
 * gives: absolute timings differ by an order of magnitude between a laptop and
 * a loaded CI box, and what is protected here is the SHAPE of the growth.
 */
describe('the cost of scoping a whole Board', () => {
  const flat = (n: number): WorkflowDefinition =>
    ({
      id: 'wf',
      name: 'W',
      version: 1,
      status: 'draft',
      steps: Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        use: 'component.email.send',
        with: { to: '{{ steps.s0.id }}' },
      })),
    }) as unknown as WorkflowDefinition

  /**
   * The fastest of several runs. A single sample measures this machine's
   * scheduler as much as this function: every interruption makes a run slower
   * and none makes one faster, so the minimum is the least polluted sample.
   */
  const timed = (n: number): number => {
    const doc = flat(n)
    let best = Number.POSITIVE_INFINITY
    for (let run = 0; run < 5; run++) {
      const memo = newScopeMemo()
      const started = performance.now()
      for (const step of doc.steps) scopeFor(doc, { board: null, id: step.id }, [], [], memo)
      best = Math.min(best, performance.now() - started)
    }
    return best
  }

  it('grows about as fast as the square of the Board, rather than its cube', () => {
    // Warmed before either is measured, so neither pays for a compilation the
    // other gets for free.
    timed(150)

    const small = timed(150)
    const large = timed(600)

    // Four times the Steps. Quadratic predicts about 16x, cubic about 64x; the
    // bound sits between them so noise cannot fail it and the cubic walk cannot
    // pass it.
    expect(large / Math.max(small, 0.1)).toBeLessThan(32)
  })
})
