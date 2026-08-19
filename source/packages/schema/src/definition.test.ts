import { describe, expect, it } from 'vitest'
import { componentSpec } from './component'
import { REFERENCE_PATTERN, referencePattern, workflowDefinition } from './definition'

// The document from the design handoff, abridged — the shape the contract must accept.
const EXAMPLE = {
  name: 'Morning inbox triage',
  id: 'wf_morning_inbox_triage',
  inputs: [{ key: 'run_reason', type: 'text' }],
  vars: { digest_to: 'me@dane.dev', triaged_count: 0 },
  steps: [
    { id: 's1', use: 'core.start', name: 'Start workflow', with: { trigger: 'schedule' } },
    {
      id: 's3',
      use: 'core.fork',
      name: 'Fork on new mail',
      with: { mode: 'condition' },
      branches: [
        {
          label: 'Has new mail',
          when: '{{s2.count}} > 0',
          steps: [
            {
              id: 's4',
              use: 'core.for_each',
              name: 'For each message',
              with: { list: '{{s2.messages}}' },
              steps: [{ id: 's5', use: 'agent.act', name: 'Triage message' }],
            },
          ],
        },
        // The fallback branch carries no `when`.
        { label: 'Otherwise', steps: [] },
      ],
    },
  ],
}

describe('workflowDefinition', () => {
  it('accepts the handoff example, nested branches and loops included', () => {
    expect(workflowDefinition.safeParse(EXAMPLE).success).toBe(true)
  })

  it('keeps References as opaque strings so renaming a step cannot break one', () => {
    const parsed = workflowDefinition.parse(EXAMPLE)
    expect(parsed.steps[1]?.branches?.[0]?.when).toBe('{{s2.count}} > 0')
  })

  it('rejects a step without a stable id, since References point at it', () => {
    const bad = { ...EXAMPLE, steps: [{ use: 'core.start', name: 'x' }] }
    expect(workflowDefinition.safeParse(bad).success).toBe(false)
  })
})

describe('componentSpec', () => {
  it('accepts a manifest with nested list output shapes', () => {
    const spec = {
      key: 'fetch_emails',
      name: 'Fetch emails',
      use: 'email.fetch',
      group: 'Email',
      icon: 'mail',
      blurb: 'Read messages from a mailbox.',
      fields: [{ k: 'filter', label: 'Filter', kind: 'text', req: true }],
      outputs: [
        { k: 'messages', t: 'list', of: [{ k: 'subject', t: 'text' }] },
        { k: 'count', t: 'number' },
      ],
    }
    expect(componentSpec.safeParse(spec).success).toBe(true)
  })

  it('rejects a group the design system has no home for', () => {
    const bad = {
      key: 'x',
      name: 'X',
      use: 'x.y',
      group: 'Cryptocurrency',
      icon: 'x',
      blurb: '',
      fields: [],
      outputs: [],
    }
    expect(componentSpec.safeParse(bad).success).toBe(false)
  })
})

describe('reference patterns', () => {
  // Regression: REFERENCE_PATTERN was exported with /g, so its lastIndex was
  // shared mutable state — repeated .test() calls alternated true/false.
  it('REFERENCE_PATTERN is stateless across repeated tests', () => {
    const value = 'Inbox digest · {{s2.count}} messages'
    expect(REFERENCE_PATTERN.test(value)).toBe(true)
    expect(REFERENCE_PATTERN.test(value)).toBe(true)
    expect(REFERENCE_PATTERN.test(value)).toBe(true)
  })

  it('referencePattern() hands out a fresh matcher each time', () => {
    const value = '{{s4.item.subject}} from {{s4.item.from}}'
    const first = [...value.matchAll(referencePattern())].map((m) => m[1])
    const second = [...value.matchAll(referencePattern())].map((m) => m[1])
    expect(first).toEqual(['s4.item.subject', 's4.item.from'])
    expect(second).toEqual(first)
  })
})
