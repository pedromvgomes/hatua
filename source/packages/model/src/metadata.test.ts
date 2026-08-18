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
