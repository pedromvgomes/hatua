import { describe, expect, it } from 'vitest'
import { DOC } from './fixtures'
import { scopeFor, upstreamOf } from './scope'
import { walkSteps } from './tree'

describe('tree traversal', () => {
  it('walks every step depth-first', () => {
    expect([...walkSteps(DOC.steps)].map((s) => s.id)).toEqual(['s2', 's3', 's4', 's5', 's6', 's7'])
  })
})

describe('reference scope', () => {
  it('includes ancestors and earlier siblings of every ancestor', () => {
    expect(upstreamOf(DOC, 's5').map((s) => s.id)).toEqual(['s2', 's3', 's4'])
  })

  it('excludes sibling branches', () => {
    // s7 is in the fallback branch; it must not see s4/s5/s6 in the other one.
    expect(upstreamOf(DOC, 's7').map((s) => s.id)).toEqual(['s2', 's3'])
  })

  it('excludes later siblings', () => {
    expect(upstreamOf(DOC, 's2')).toEqual([])
  })
})

describe('scopeFor', () => {
  it('offers every trigger regardless of tree position', () => {
    // A workflow cannot run without a trigger firing, so triggers are never
    // out of scope the way an upstream step can be.
    const paths = scopeFor(DOC, 's5').map((e) => e.path)
    expect(paths).toContain('triggers.nightly')
    expect(paths).toContain('triggers.on_mail')
  })

  it('offers the TRIGGER built-in only when several triggers exist', () => {
    expect(scopeFor(DOC, 's5').map((e) => e.path)).toContain('TRIGGER')

    const single = { ...DOC, triggers: [DOC.triggers![0]!] }
    expect(scopeFor(single, 's5').map((e) => e.path)).not.toContain('TRIGGER')
  })

  it('offers workflow vars, which are scoped to the workflow not the position', () => {
    expect(scopeFor(DOC, 's2').map((e) => e.path)).toContain('var.digest_to')
  })

  it('still constrains steps by tree position', () => {
    const paths = scopeFor(DOC, 's7').map((e) => e.path)
    expect(paths).toContain('s2')
    expect(paths).not.toContain('s5')
  })
})
