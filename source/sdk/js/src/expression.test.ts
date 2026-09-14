import { describe, expect, it } from 'vitest'
import {
  coreFunctions,
  type EvaluationContext,
  ExpressionError,
  resolve,
  resolveAll,
  scopeFor,
  slotsFor,
  sourceReference,
  validate,
  whenSlot,
} from './index'
import { loadDefinition, loadManifests } from './load'

/**
 * The seam this SDK exists for, exercised end to end.
 *
 * The language's own behaviour is pinned by conformance/expression/, which runs
 * against Go as well — duplicating it here would only mean two places to update
 * and one of them going stale. What these check is the part the corpus cannot:
 * that a runner can get from a Workflow Definition and a set of manifests to
 * resolved values without restating anything the builder knows.
 */

const MANIFESTS = loadManifests(`
components:
  - kind: component
    use: component.email.fetch
    name: Fetch emails
    fields:
      - { k: connection, label: Mailbox, kind: conn }
    outputs:
      - { k: count, label: Count, t: number }
      - k: messages
        label: Messages
        t: list
        of:
          - { k: subject, label: Subject, t: text }
  - kind: component
    use: component.email.send
    name: Send email
    fields:
      - { k: to, label: To, kind: text }
      - { k: subject, label: Subject, kind: text }
      - { k: retries, label: Retries, kind: number }
    outputs: []
`)

const DOC = loadDefinition(`
id: wf_digest
name: Inbox digest
version: 1
status: draft
triggers:
  - { id: nightly, use: core.schedule, name: Nightly }
vars:
  - { key: digest_to, t: text, value: me@dane.dev }
steps:
  - { id: s2, use: component.email.fetch, name: Fetch, with: { connection: mailbox } }
  - id: s6
    use: component.email.send
    name: Send digest
    with:
      to: "{{ var.digest_to }}"
      subject: "Inbox digest · {{ steps.s2.count }} messages"
      retries: "{{ 1 + 1 }}"
`)

const CONTEXT: EvaluationContext = {
  steps: { s2: { count: 24, messages: [{ subject: 'Invoice' }, { subject: 'Receipt' }] } },
  triggers: { nightly: { triggered_at: '2026-08-18T07:00:00Z' } },
  var: { digest_to: 'me@dane.dev' },
  TRIGGER: 'nightly',
  functions: coreFunctions(),
}

const manifestFor = (use: string) => {
  const manifest = MANIFESTS.find((candidate) => candidate.use === use)
  if (!manifest) throw new Error(`no manifest for ${use}`)
  return manifest
}

describe('a runner resolving a step', () => {
  it('resolves a whole `with:` map from the step and its manifest', () => {
    const step = DOC.steps[1]!
    expect(resolveAll(CONTEXT, slotsFor(step, manifestFor('component.email.send')))).toEqual({
      to: 'me@dane.dev',
      subject: 'Inbox digest · 24 messages',
      retries: 2,
    })
  })

  it('keeps a number a number, so a downstream comparison still works', () => {
    expect(
      resolve(CONTEXT, { name: 'n', template: '{{ steps.s2.count }}', expectedType: 'number' }),
    ).toBe(24)
  })

  it('reports every failing field at once rather than stopping at the first', () => {
    let thrown: unknown
    try {
      resolveAll(CONTEXT, [
        { name: 'a', template: '{{ steps.s9.missing }}', expectedType: 'text' },
        { name: 'b', template: '{{ steps.s8.missing }}', expectedType: 'text' },
      ])
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ExpressionError)
    const diagnostics = (thrown as ExpressionError).diagnostics
    expect(diagnostics).toHaveLength(2)
    // The Host disposes: it is told which field failed and why, and decides for
    // itself whether the step fails or the run aborts.
    expect(diagnostics.map((d) => d.slot)).toEqual(['a', 'b'])
  })
})

describe('a builder checking a step', () => {
  it('accepts what the manifests say is well typed', () => {
    const scope = scopeFor(DOC, { board: null, id: 's6' }, MANIFESTS)
    const context = { scope, functions: coreFunctions() }

    for (const slot of slotsFor(DOC.steps[1]!, manifestFor('component.email.send'))) {
      expect(validate(slot.template, slot.expectedType, context), slot.name).toEqual([])
    }
  })

  it('refuses the legacy condition, which is a text template in a boolean slot', () => {
    const scope = scopeFor(DOC, { board: null, id: 's6' }, MANIFESTS)
    const slot = whenSlot('{{steps.s2.count}} > 0')
    const found = validate(slot.template, slot.expectedType, { scope, functions: coreFunctions() })

    expect(found.map((d) => `${d.code}:${d.severity}`)).toEqual(['EXPR_TYPE_MISMATCH:error'])
  })

  it('resolves a projection through the manifest’s declared element shape', () => {
    const scope = scopeFor(DOC, { board: null, id: 's6' }, MANIFESTS)
    expect(
      validate('{{ steps.s2.messages[].subject }}', 'list', { scope, functions: coreFunctions() }),
    ).toEqual([])
  })
})

describe('references', () => {
  it('recognises a Template that is exactly one path', () => {
    expect(sourceReference('{{ steps.s2.count }}')).toBe('steps.s2.count')
  })

  it('and refuses to call anything computed one', () => {
    expect(sourceReference('{{ steps.s2.count + 1 }}')).toBeNull()
    expect(sourceReference('Hi {{ steps.s2.count }}')).toBeNull()
  })
})
