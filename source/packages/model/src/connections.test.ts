import { describe, expect, it } from 'vitest'
import { indexManifests, mismatchedConnections, unresolvedConnections } from './connections'
import { CONNECTION_TYPES, DOC, MANIFESTS } from './fixtures'
import { validateDefinition } from './validity'

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

  it('names the connection in the message the schema declares', () => {
    expect(unresolvedConnections(DOC)[0]?.message).toBe(
      '"notifier" is not connected yet. Connect it before publishing.',
    )
  })
})

describe('mismatchedConnections', () => {
  it('accepts the fixture, where every connection matches its field', () => {
    expect(mismatchedConnections(DOC, index, CONNECTION_TYPES)).toEqual([])
  })

  /*
   * A `conn` field inside a Block is a `conn` field. Both codes here block
   * editing, so a Board this rule skipped would lock a document over a Step
   * nothing reported — which is why nothing may walk `doc.steps` alone.
   */
  it('checks a Step on a Block’s Board, and says which Board it is on', () => {
    const withBlock = structuredClone(DOC)
    withBlock.blocks = [
      {
        id: 'archive',
        steps: [{ id: 'send', use: 'component.email.send', with: { connection: 'brain' } }],
      },
    ]

    const [issue] = mismatchedConnections(withBlock, index, CONNECTION_TYPES)
    expect(issue?.code).toBe('CONNECTION_TYPE_MISMATCH')
    expect(issue?.stepId).toBe('send')
    expect(issue?.blockId).toBe('archive')
  })

  it('leaves a root Step without a blockId, so the two are told apart', () => {
    const bad = structuredClone(DOC)
    bad.steps[1]!.branches![0]!.steps![1]!.with = { connection: 'brain' }

    const [issue] = mismatchedConnections(bad, index, CONNECTION_TYPES)
    expect(issue?.blockId).toBeUndefined()
  })

  it('rejects an llm connection in a field wanting email', () => {
    const bad = structuredClone(DOC)
    bad.steps[1]!.branches![0]!.steps![1]!.with = { connection: 'brain' }

    const [issue] = mismatchedConnections(bad, index, CONNECTION_TYPES)
    expect(issue?.code).toBe('CONNECTION_TYPE_MISMATCH')
    expect(issue?.blocks).toBe('edit')
    // The declared template, filled: the field's label, the type it wants, and
    // the type it was handed.
    expect(issue?.message).toBe('Mailbox needs a email connection, but "brain" is llm.')
  })

  it('rejects a reference to a connection the workflow never declared', () => {
    const bad = structuredClone(DOC)
    bad.steps[0]!.with = { connection: 'ghost' }
    const [issue] = mismatchedConnections(bad, index, CONNECTION_TYPES)
    expect(issue?.code).toBe('CONNECTION_UNKNOWN')
    // Carried so the Connection the field names is what `troubledConnections`
    // finds, even though nothing declares it.
    expect(issue?.connectionId).toBe('ghost')
  })

  it('stays quiet about an unestablished connection — that is a publish concern', () => {
    const bad = structuredClone(DOC)
    bad.steps[0]!.with = { connection: 'notifier' }
    expect(mismatchedConnections(bad, index, CONNECTION_TYPES)).toEqual([])
  })

  it('checks triggers too, not just steps', () => {
    const bad = structuredClone(DOC)
    bad.triggers![1]!.with = { connection: 'brain' }
    expect(mismatchedConnections(bad, index, CONNECTION_TYPES).map((d) => d.code)).toContain(
      'CONNECTION_TYPE_MISMATCH',
    )
  })
})

describe('unresolvable connections', () => {
  // Silence for a ref the Host cannot recognise would be indistinguishable
  // from a matching type.
  it('flags a ref the Host lists nothing for', () => {
    const [issue] = mismatchedConnections(DOC, index, new Map())
    expect(issue?.code).toBe('CONNECTION_UNRESOLVABLE')
    // Blocks publish, not editing — the workflow is still editable.
    expect(issue?.blocks).toBe('publish')
  })

  it('is an answer, not an absence: an empty map says the Host has established none', () => {
    expect(mismatchedConnections(DOC, index, new Map()).length).toBeGreaterThan(0)
  })
})

/*
 * The case that locks a document if it is got wrong. A checker with no type
 * source answers every `types.get(ref)` with undefined, and undefined means
 * CONNECTION_UNRESOLVABLE — so a workflow whose Connections are perfectly fine
 * would report every one of them revoked before the Host had answered, and
 * CONNECTION_TYPE_MISMATCH blocks editing.
 */
describe('with nobody able to describe a connection', () => {
  it('says nothing about a type it cannot know', () => {
    expect(mismatchedConnections(DOC, index)).toEqual([])
  })

  it('still reports a name that resolves to nothing, which the document answers', () => {
    const bad = structuredClone(DOC)
    bad.steps[0]!.with = { connection: 'ghost' }
    expect(mismatchedConnections(bad, index).map((d) => d.code)).toEqual(['CONNECTION_UNKNOWN'])
  })

  it('still reports a connection that was never established', () => {
    expect(unresolvedConnections(DOC).map((d) => d.code)).toEqual(['CONNECTION_NOT_ESTABLISHED'])
  })

  it('leaves every other rule family running', () => {
    // The whole point of narrowing rather than deferring: a Host that wires no
    // ConnectionSource is correctly configured, and must still be told about a
    // required field it left empty.
    const bad = structuredClone(DOC)
    bad.steps[0]!.use = 'component.nothing.here'
    expect(validateDefinition(bad, index).all.map((d) => d.code)).toContain('COMPONENT_UNKNOWN')
  })
})

describe('validateDefinition files a connection diagnostic where it can be drawn', () => {
  it('puts a connection nothing established in byConnection, under its own id', () => {
    const { byConnection, byStep } = validateDefinition(DOC, index, [], CONNECTION_TYPES)
    expect([...byConnection.keys()]).toEqual(['notifier'])
    expect(byConnection.get('notifier')?.[0]?.code).toBe('CONNECTION_NOT_ESTABLISHED')
    // It names no Step, so no Step's bucket may hold it.
    expect([...byStep.values()].flat().map((d) => d.code)).not.toContain(
      'CONNECTION_NOT_ESTABLISHED',
    )
  })

  it('files a field’s mismatch under the Step whose field it is, not the Connection', () => {
    const bad = structuredClone(DOC)
    bad.steps[1]!.branches![0]!.steps![1]!.with = { connection: 'brain' }

    const { byStep, byConnection } = validateDefinition(bad, index, [], CONNECTION_TYPES)
    const filed = [...byStep.values()].flat().map((d) => d.code)
    expect(filed).toContain('CONNECTION_TYPE_MISMATCH')
    expect(byConnection.has('brain')).toBe(false)
  })

  it('reports nothing about connection types when it was handed none', () => {
    const codes = validateDefinition(DOC, index).all.map((d) => d.code)
    expect(codes).toContain('CONNECTION_NOT_ESTABLISHED')
    expect(codes).not.toContain('CONNECTION_UNRESOLVABLE')
  })
})
