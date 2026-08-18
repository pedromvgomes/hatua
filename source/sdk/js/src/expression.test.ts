import { describe, expect, it } from 'vitest'
import { type EvaluationContext, evaluate } from './expression'

const CTX: EvaluationContext = {
  TRIGGER: 'nightly',
  triggers: { nightly: { triggered_at: '2026-08-18T07:00:00Z' } },
  var: { digest_to: 'me@dane.dev' },
  steps: {
    s2: { count: 24, messages: [{ subject: 'Invoice' }, { subject: 'Receipt' }] },
    s4: { item: { subject: 'Invoice', from: 'billing@x.com' } },
  },
}

describe('evaluate', () => {
  it('preserves type when a value is exactly one reference', () => {
    // {{s2.count}} must yield the number 24, not the string "24" — a runner
    // that stringifies here would break every numeric comparison downstream.
    expect(evaluate('{{s2.count}}', CTX)).toBe(24)
  })

  it('interpolates when a reference is embedded in text', () => {
    expect(evaluate('Inbox digest · {{s2.count}} messages', CTX)).toBe('Inbox digest · 24 messages')
  })

  it('resolves several references in one string', () => {
    expect(evaluate('{{s4.item.subject}} from {{s4.item.from}}', CTX)).toBe(
      'Invoice from billing@x.com',
    )
  })

  it('addresses triggers by name', () => {
    expect(evaluate('{{triggers.nightly.triggered_at}}', CTX)).toBe('2026-08-18T07:00:00Z')
  })

  it('exposes which trigger fired', () => {
    expect(evaluate('{{TRIGGER}}', CTX)).toBe('nightly')
  })

  it('resolves workflow variables', () => {
    expect(evaluate('{{var.digest_to}}', CTX)).toBe('me@dane.dev')
  })

  it('maps a field across every element for a [] path', () => {
    expect(evaluate('{{s2.messages[].subject}}', CTX)).toEqual(['Invoice', 'Receipt'])
  })

  it('yields undefined for an unresolvable reference rather than throwing', () => {
    // A half-built workflow references things that do not exist yet; the
    // builder must be able to render it without crashing.
    expect(evaluate('{{s9.nope}}', CTX)).toBeUndefined()
  })

  it('renders an unresolvable reference as empty when interpolating', () => {
    expect(evaluate('value: {{s9.nope}}', CTX)).toBe('value: ')
  })

  it('leaves a string with no references untouched', () => {
    expect(evaluate('plain text', CTX)).toBe('plain text')
  })
})
