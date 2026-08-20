import type { WorkflowExecution } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import { MANIFESTS } from './fixtures'
import { descriptorsByUse, pivot, totals } from './metadata'

// A loop that ran four times across two models, so both the total and the
// per-model breakdown have something to say.
const RUN: WorkflowExecution = {
  run_id: 'run_8f215',
  status: 'succeeded',
  workflow: { id: 'wf_morning_inbox_triage', version: 7 },
  started_at: '2026-08-18T07:00:00.000Z',
  steps: [
    {
      id: 's4',
      status: 'succeeded',
      iterations: [
        {
          index: 0,
          status: 'succeeded',
          steps: [{ id: 's5', status: 'succeeded', metadata: { tokens: 1000, model: 'haiku' } }],
        },
        {
          index: 1,
          status: 'succeeded',
          steps: [{ id: 's5', status: 'succeeded', metadata: { tokens: 500, model: 'haiku' } }],
        },
        {
          index: 2,
          status: 'succeeded',
          steps: [{ id: 's5', status: 'succeeded', metadata: { tokens: 4000, model: 'sonnet' } }],
        },
        {
          index: 3,
          status: 'failed',
          steps: [{ id: 's5', status: 'failed', error: { message: 'timed out' } }],
        },
      ],
    },
  ],
}

const descriptors = descriptorsByUse(MANIFESTS)
const useOf = (stepId: string) => (stepId === 's5' ? 'agent.act' : 'core.for_each')

describe('totals', () => {
  it('sums a measure across every loop iteration', () => {
    expect(totals(RUN, descriptors, useOf)).toEqual([
      { key: 'tokens', label: 'Tokens used', unit: 'tokens', total: 5500 },
    ])
  })

  it('ignores a failed iteration that reported nothing', () => {
    // The fourth iteration has no metadata; it must not contribute a NaN.
    expect(totals(RUN, descriptors, useOf)[0]?.total).not.toBeNaN()
  })

  it('never sums a dimension', () => {
    expect(totals(RUN, descriptors, useOf).map((t) => t.key)).not.toContain('model')
  })
})

describe('pivot', () => {
  it('derives tokens per model with no runner-supplied schema', () => {
    expect(pivot(RUN, descriptors, useOf, 'tokens', 'model')?.rows).toEqual([
      { value: 'sonnet', total: 4000 },
      { value: 'haiku', total: 1500 },
    ])
  })

  it('carries the labels and unit for rendering', () => {
    const result = pivot(RUN, descriptors, useOf, 'tokens', 'model')
    expect(result?.measureLabel).toBe('Tokens used')
    expect(result?.dimensionLabel).toBe('Model')
    expect(result?.unit).toBe('tokens')
  })

  it('returns null when the keys are not a measure and a dimension', () => {
    expect(pivot(RUN, descriptors, useOf, 'model', 'tokens')).toBeNull()
  })
})

describe('pivot correctness', () => {
  // Summing any key literally named `tokens`, rather than the ones a
  // descriptor declares, makes the rows fail to add up to the total beside
  // them.
  it('ignores an undeclared key of the same name', () => {
    const withStray: WorkflowExecution = {
      ...RUN,
      steps: [
        ...RUN.steps,
        // email.send declares no metadata at all, so this must not count.
        { id: 's6', status: 'succeeded', metadata: { tokens: 999, model: 'ghost' } },
      ],
    }
    const useFor = (id: string) =>
      id === 's5' ? 'agent.act' : id === 's6' ? 'email.send' : 'core.for_each'

    expect(totals(withStray, descriptors, useFor)[0]?.total).toBe(5500)
    const rows = pivot(withStray, descriptors, useFor, 'tokens', 'model')?.rows ?? []
    // The rows must sum to the headline total, not exceed it.
    expect(rows.reduce((sum, r) => sum + r.total, 0)).toBe(5500)
    expect(rows.map((r) => r.value)).not.toContain('ghost')
  })

  it('returns null when measure and dimension come from different components', () => {
    const split = new Map([
      ['a.one', [{ k: 'tokens', label: 'Tokens', t: 'number', role: 'measure' as const }]],
      ['b.two', [{ k: 'model', label: 'Model', t: 'text', role: 'dimension' as const }]],
    ])
    // They can never co-occur on one sample, so a Pivot here would be a
    // fully-labelled object with empty rows — worse than null.
    expect(pivot(RUN, split, useOf, 'tokens', 'model')).toBeNull()
  })
})
