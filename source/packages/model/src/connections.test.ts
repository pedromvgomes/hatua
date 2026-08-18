import { describe, expect, it } from 'vitest'
import { indexManifests, mismatchedConnections, unresolvedConnections } from './connections'
import { CONNECTION_TYPES, DOC, MANIFESTS } from './fixtures'

const typeOf = (ref: string) => CONNECTION_TYPES[ref]
const index = indexManifests(MANIFESTS)

describe('unresolvedConnections', () => {
  it('flags a connection that was never established', () => {
    const found = unresolvedConnections(DOC)
    expect(found.map((d) => d.connectionId)).toEqual(['notifier'])
  })

  it('blocks publish but not editing', () => {
    // You must be able to lay out a workflow before wiring up its connections.
    expect(unresolvedConnections(DOC)[0]?.blocks).toBe('publish')
  })
})

describe('mismatchedConnections', () => {
  it('accepts the fixture, where every connection matches its field', () => {
    expect(mismatchedConnections(DOC, index, typeOf)).toEqual([])
  })

  it('rejects an llm connection in a field wanting email', () => {
    const bad = structuredClone(DOC)
    bad.steps[1]!.branches![0]!.steps![1]!.with = { connection: 'brain' }

    const [issue] = mismatchedConnections(bad, index, typeOf)
    expect(issue?.code).toBe('CONNECTION_TYPE_MISMATCH')
    expect(issue?.blocks).toBe('edit')
    expect(issue?.message).toContain('email')
  })

  it('rejects a reference to a connection the workflow never declared', () => {
    const bad = structuredClone(DOC)
    bad.steps[0]!.with = { connection: 'ghost' }
    expect(mismatchedConnections(bad, index, typeOf)[0]?.code).toBe('CONNECTION_UNKNOWN')
  })

  it('stays quiet about an unestablished connection — that is a publish concern', () => {
    const bad = structuredClone(DOC)
    bad.steps[0]!.with = { connection: 'notifier' }
    expect(mismatchedConnections(bad, index, typeOf)).toEqual([])
  })

  it('checks triggers too, not just steps', () => {
    const bad = structuredClone(DOC)
    bad.triggers![1]!.with = { connection: 'brain' }
    expect(mismatchedConnections(bad, index, typeOf).map((d) => d.code)).toContain(
      'CONNECTION_TYPE_MISMATCH',
    )
  })
})
