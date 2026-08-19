import type { WorkflowDefinition } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import { upstreamOf, walkSteps } from './index'

// Mirrors workflow.example.yaml from the design handoff.
const DOC: WorkflowDefinition = {
  name: 'Morning inbox triage',
  id: 'wf_morning_inbox_triage',
  steps: [
    { id: 's1', use: 'core.start', name: 'Start workflow' },
    { id: 's2', use: 'email.fetch', name: 'Fetch emails' },
    {
      id: 's3',
      use: 'core.fork',
      name: 'Fork on new mail',
      branches: [
        {
          label: 'Has new mail',
          when: '{{s2.count}} > 0',
          steps: [
            {
              id: 's4',
              use: 'core.for_each',
              name: 'For each message',
              steps: [{ id: 's5', use: 'agent.act', name: 'Triage message' }],
            },
            { id: 's6', use: 'email.send', name: 'Send digest' },
          ],
        },
        { label: 'Otherwise', steps: [{ id: 's7', use: 'core.end', name: 'End workflow' }] },
      ],
    },
  ],
}

describe('tree traversal', () => {
  it('walks every step depth-first', () => {
    expect([...walkSteps(DOC.steps)].map((s) => s.id)).toEqual([
      's1',
      's2',
      's3',
      's4',
      's5',
      's6',
      's7',
    ])
  })
})

describe('reference scope', () => {
  it('includes ancestors and earlier siblings of every ancestor', () => {
    expect(upstreamOf(DOC, 's5').map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4'])
  })

  it('excludes sibling branches', () => {
    // s7 is in the fallback branch; it must not see s4/s5/s6 in the other branch.
    expect(upstreamOf(DOC, 's7').map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  })

  it('excludes later siblings', () => {
    expect(upstreamOf(DOC, 's2').map((s) => s.id)).toEqual(['s1'])
  })

  it('returns nothing for the first step', () => {
    expect(upstreamOf(DOC, 's1')).toEqual([])
  })
})
