import type { ContextKey } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import { DOC, MANIFESTS } from './fixtures'
import { scopeFor, upstreamOf, workflowScope } from './scope'
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

describe('workflowScope', () => {
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
    const paths = workflowScope(DOC).map((entry) => entry.path)
    expect(paths).not.toContain('s2')
    expect(paths).toContain('var.digest_to')
    expect(paths).toContain('triggers.nightly')
    expect(paths).toContain('TRIGGER')
  })

  it('offers the Host Run Context as `run.<key>`', () => {
    const paths = workflowScope(DOC, [], CONTEXT).map((entry) => entry.path)
    expect(paths).toContain('run.id')
    expect(paths).toContain('run.tenant')
  })

  it('files Run Context under its own kind, so the tree can group it apart', () => {
    const entry = workflowScope(DOC, [], CONTEXT).find((candidate) => candidate.path === 'run.id')
    expect(entry?.kind).toBe('context')
    expect(entry?.label).toBe('Run id')
    expect(entry?.description).toBe('Identifies this execution.')
  })

  it('nests a key through `of`, the way a manifest output nests', () => {
    const entry = workflowScope(DOC, [], CONTEXT).find(
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
    const found = workflowScope(DOC, [], twice).filter((entry) => entry.path === 'run.tenant')
    expect(found).toHaveLength(1)
    expect(found[0]?.label).toBe('Tenant')
  })

  it('declares nothing when the Host declared nothing', () => {
    expect(workflowScope(DOC).some((entry) => entry.kind === 'context')).toBe(false)
  })

  /*
   * The whole reason it is extracted rather than copied: two readers, one
   * definition of the unpositioned half.
   */
  it('is exactly the part of scopeFor that has no position', () => {
    const unpositioned = workflowScope(DOC, MANIFESTS, CONTEXT)
    const positioned = scopeFor(DOC, 's5', MANIFESTS, CONTEXT)
    expect(positioned.slice(0, unpositioned.length)).toEqual(unpositioned)
    expect(positioned.slice(unpositioned.length).every((entry) => entry.kind === 'step')).toBe(true)
  })
})
