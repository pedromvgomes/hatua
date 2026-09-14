import { describe, expect, it } from 'vitest'
import { durationOf, momentOf, RUN_STATUS_LABEL, STATUS_LABEL } from './runRecords'

/**
 * How a run is written down, for the list and the pane alike.
 *
 * Both are read off the same functions so that one run does not read two ways on
 * one screen, and both are machine-independent: a locale-dependent string would
 * make every assertion and every story pass only where it was written.
 */
describe('a duration', () => {
  it('reads in milliseconds below a second, which is where most Steps land', () => {
    expect(durationOf(120)).toBe('120ms')
    expect(durationOf(0)).toBe('0ms')
  })

  it('reads in seconds up to a minute, without a trailing run of zeroes', () => {
    expect(durationOf(1470)).toBe('1.47s')
    expect(durationOf(2000)).toBe('2s')
  })

  it('breaks into minutes past a minute, because "184.62s" is arithmetic to do', () => {
    expect(durationOf(60_000)).toBe('1m 0s')
    expect(durationOf(184_620)).toBe('3m 5s')
  })

  it('says nothing about a total nobody reported', () => {
    // `duration_ms` is optional in the schema and a Host can break the type it
    // promised. A row missing its total is still a row worth drawing.
    expect(durationOf(undefined)).toBe('')
    expect(durationOf(Number.NaN)).toBe('')
    expect(durationOf(-1)).toBe('')
  })
})

describe('a moment', () => {
  it('is sliced out of the ISO string rather than parsed, so it reads the same everywhere', () => {
    // Formatted through `Intl` it would carry the measuring machine's timezone
    // and locale into what renders.
    expect(momentOf('2026-08-18T07:00:00.000Z')).toBe('2026-08-18 07:00')
  })

  it('says nothing about a timestamp it cannot read', () => {
    expect(momentOf(undefined)).toBe('')
    expect(momentOf('2026-08-18')).toBe('')
  })
})

describe('what a status is called', () => {
  it('names every status a Step can be in, so no card falls back to a raw key', () => {
    expect(Object.keys(STATUS_LABEL).sort()).toEqual([
      'failed',
      'pending',
      'running',
      'skipped',
      'succeeded',
    ])
  })

  it('offers a whole run only the three it can be in', () => {
    // A run is never `pending` or `skipped`: the Host reports it once it exists,
    // and it exists because it started.
    expect(Object.keys(RUN_STATUS_LABEL).sort()).toEqual(['failed', 'running', 'succeeded'])
  })

  it('says a Step that has not started in words, not as an absence', () => {
    expect(STATUS_LABEL.pending).toBe('Not started')
  })
})
