import { validate } from '@hatua/expressions'
import {
  MAPPABLE_FIELD_KINDS,
  type Manifest,
  type Step,
  type WorkflowDefinition,
} from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import { DOC, MANIFESTS } from './fixtures'
import { scopeFor } from './scope'
import { FIELD_KIND_TYPES, slotsFor, whenSlot } from './slots'

/**
 * The bridge between a manifest and the expression language. It exists so a
 * runner never restates the field-kind to type mapping, and these check the two
 * places that mapping is easy to get wrong: a `map` field, whose value is a list
 * of separately-typed entries, and `core.map`, whose *outputs* come from that
 * same list rather than from any manifest.
 */

const EMAIL_SEND: Manifest = {
  kind: 'component',
  use: 'component.email.send',
  name: 'Send email',
  fields: [
    { k: 'connection', label: 'Mailbox', kind: 'conn' },
    { k: 'to', label: 'To', kind: 'text' },
    { k: 'body', label: 'Body', kind: 'textarea' },
    { k: 'retries', label: 'Retries', kind: 'number' },
    { k: 'urgent', label: 'Urgent', kind: 'bool' },
  ],
  outputs: [],
}

const MAPPER: Manifest = {
  kind: 'component',
  use: 'core.map',
  name: 'Map values',
  fields: [{ k: 'entries', label: 'Entries', kind: 'map' }],
  outputs: [],
}

describe('slotsFor', () => {
  it('turns each mappable field into a Slot carrying the type the field declares', () => {
    const step: Step = {
      id: 's6',
      use: 'component.email.send',
      with: {
        connection: 'mailbox',
        to: '{{ var.digest_to }}',
        body: 'hi',
        retries: '{{ 1 + 1 }}',
      },
    }

    expect(slotsFor(step, EMAIL_SEND)).toEqual([
      { name: 'to', template: '{{ var.digest_to }}', expectedType: 'text' },
      { name: 'body', template: 'hi', expectedType: 'text' },
      { name: 'retries', template: '{{ 1 + 1 }}', expectedType: 'number' },
    ])
  })

  it('leaves non-mappable fields alone — a connection is not a Template', () => {
    const step: Step = { id: 's6', use: 'component.email.send', with: { connection: 'mailbox' } }
    expect(slotsFor(step, EMAIL_SEND)).toEqual([])
  })

  it('gives a map field one Slot per entry, each with its own declared type', () => {
    const step: Step = {
      id: 's8',
      use: 'core.map',
      with: {
        entries: [
          { key: 'subject', value: '{{ steps.s2.subject }}', type: 'text' },
          { key: 'count', value: '{{ steps.s2.count }}', type: 'number' },
        ],
      },
    }

    expect(slotsFor(step, MAPPER)).toEqual([
      { name: 'entries.subject', template: '{{ steps.s2.subject }}', expectedType: 'text' },
      { name: 'entries.count', template: '{{ steps.s2.count }}', expectedType: 'number' },
    ])
  })

  it('ignores a malformed entry rather than inventing a type for it', () => {
    const step: Step = {
      id: 's8',
      use: 'core.map',
      with: { entries: [{ key: 'subject' }, 'nonsense'] },
    }
    expect(slotsFor(step, MAPPER)).toEqual([])
  })

  it('types exactly the kinds that are mappable — no more, no fewer', () => {
    // The compiler enforces this too, since the record is keyed by the union.
    // It is asserted at run time as well because the table is exported through
    // the SDK: a Host reading it must not find a `bool` entry that `isMappable`
    // would have rejected before anything ever read it.
    expect(Object.keys(FIELD_KIND_TYPES).sort()).toEqual([...MAPPABLE_FIELD_KINDS].sort())
  })
})

describe('whenSlot', () => {
  it('declares a branch condition boolean, which is what makes the legacy spelling refusable', () => {
    const slot = whenSlot('{{steps.s2.count}} > 0')
    expect(slot.expectedType).toBe('boolean')

    const scope = scopeFor(DOC, 's4', MANIFESTS)
    const found = validate(slot.template, slot.expectedType, { scope, functions: new Map() })
    expect(found.map((d) => d.code)).toEqual(['EXPR_TYPE_MISMATCH'])
    expect(found[0]?.severity).toBe('error')
  })

  it('accepts the same condition written the way the language means it', () => {
    const scope = scopeFor(DOC, 's4', MANIFESTS)
    expect(
      validate('{{ steps.s2.count > 0 }}', 'boolean', { scope, functions: new Map() }),
    ).toEqual([])
  })
})

describe('scopeFor with manifests', () => {
  it('gives each step the shape its manifest declares', () => {
    const entry = scopeFor(DOC, 's4', MANIFESTS).find((e) => e.path === 'steps.s2')
    expect(entry?.type).toEqual({ type: 'object', members: { count: { type: 'number' } } })
  })

  it('flattens a nested output shape, since `of:` means members either way', () => {
    const manifests: Manifest[] = [
      {
        kind: 'component',
        use: 'component.email.fetch',
        name: 'Fetch',
        fields: [],
        outputs: [
          {
            k: 'messages',
            label: 'Messages',
            t: 'list',
            of: [{ k: 'subject', label: 'Subject', t: 'text' }],
          },
        ],
      },
    ]
    const entry = scopeFor(DOC, 's4', manifests).find((e) => e.path === 'steps.s2')
    expect(entry?.type).toEqual({
      type: 'object',
      members: { messages: { type: 'list', members: { subject: { type: 'text' } } } },
    })
  })

  it('derives a core.map step’s outputs from its own entries, not from a manifest', () => {
    const doc: WorkflowDefinition = {
      ...DOC,
      steps: [
        {
          id: 's1',
          use: 'core.map',
          with: {
            entries: [
              { key: 'subject', value: '{{ steps.s2.subject }}', type: 'text' },
              { key: 'count', value: '0', type: 'number' },
            ],
          },
        },
        { id: 's2', use: 'component.email.send' },
      ],
    }

    const entry = scopeFor(doc, 's2', [MAPPER]).find((e) => e.path === 'steps.s1')
    expect(entry?.type).toEqual({
      type: 'object',
      members: { subject: { type: 'text' }, count: { type: 'number' } },
    })
  })

  it('and those outputs then type-check downstream like any other step’s', () => {
    const doc: WorkflowDefinition = {
      ...DOC,
      steps: [
        {
          id: 's1',
          use: 'core.map',
          with: { entries: [{ key: 'count', value: '0', type: 'number' }] },
        },
        { id: 's2', use: 'component.email.send' },
      ],
    }
    const scope = scopeFor(doc, 's2', [MAPPER])

    expect(
      validate('{{ steps.s1.count > 0 }}', 'boolean', { scope, functions: new Map() }),
    ).toEqual([])
    expect(
      validate('{{ steps.s1.count }}', 'boolean', { scope, functions: new Map() }).map(
        (d) => d.code,
      ),
    ).toEqual(['EXPR_TYPE_MISMATCH'])
  })
})
