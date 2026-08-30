import { describe, expect, it } from 'vitest'
import { renamePath } from './reference.js'

/**
 * Rewriting the References an edit invalidates (ADR-0021).
 *
 * The two properties that matter are that it repairs a computed hole as readily
 * as a bare path, and that it declines rather than guesses — a rename that
 * guessed would corrupt a file Hatua does not own.
 */
describe('renamePath', () => {
  it('rewrites a Reference that is the whole hole', () => {
    expect(renamePath('{{ var.old }}', 'var.old', 'var.new')).toBe('{{ var.new }}')
  })

  /*
   * The case a rewrite keyed on `templateReference` would miss. `{{ var.old + 1 }}`
   * is not a Reference and names the variable exactly as much as `{{ var.old }}`
   * does, so keying on "is this Template a Reference" repairs the simple holes
   * and silently skips every interesting one.
   */
  it('rewrites a Reference inside a computed hole', () => {
    expect(renamePath('{{ var.old + 1 }}', 'var.old', 'var.new')).toBe('{{ var.new + 1 }}')
    expect(renamePath('{{ text.upper(var.old) }}', 'var.old', 'var.new')).toBe(
      '{{ text.upper(var.new) }}',
    )
  })

  it('rewrites in a hole surrounded by literal text, leaving the text alone', () => {
    expect(renamePath('Hi {{ var.old }}, bye', 'var.old', 'var.new')).toBe('Hi {{ var.new }}, bye')
  })

  it('rewrites every occurrence, not only the first', () => {
    expect(renamePath('{{ var.old }} and {{ var.old }}', 'var.old', 'var.n')).toBe(
      '{{ var.n }} and {{ var.n }}',
    )
  })

  it('keeps what sits below the renamed prefix', () => {
    expect(renamePath('{{ steps.s7.url.host }}', 'steps.s7.url', 'steps.s7.link')).toBe(
      '{{ steps.s7.link.host }}',
    )
  })

  it('keeps a projection below the renamed prefix', () => {
    expect(renamePath('{{ steps.s2.rows[].k }}', 'steps.s2.rows', 'steps.s2.list')).toBe(
      '{{ steps.s2.list[].k }}',
    )
  })

  /*
   * A prefix ends at a segment boundary. Matching on `startsWith` alone makes
   * renaming `var.to` rewrite `var.total`, which is a different variable — a
   * silent corruption rather than the stale Reference the rule tolerates.
   */
  it('leaves a longer name that merely begins the same way', () => {
    expect(renamePath('{{ var.total }}', 'var.to', 'var.x')).toBe('{{ var.total }}')
    expect(renamePath('{{ var.to_do }}', 'var.to', 'var.x')).toBe('{{ var.to_do }}')
  })

  it('leaves a path under a different root', () => {
    expect(renamePath('{{ params.old }}', 'var.old', 'var.new')).toBe('{{ params.old }}')
  })

  /*
   * `pathText` renders a literal index as `[…]` rather than the characters that
   * produced it, so a whole-path comparison against the source can never match
   * an indexed Reference. Verifying only the prefix that is being replaced is
   * what keeps this shape — the one CONTEXT.md leads with — from being silently
   * skipped by the very check meant to make the rewrite safe.
   */
  it('rewrites an indexed Reference, leaving the index untouched', () => {
    expect(renamePath('{{ steps.s2.old[0].subject }}', 'steps.s2.old', 'steps.s2.mail')).toBe(
      '{{ steps.s2.mail[0].subject }}',
    )
    expect(renamePath('{{ var.old["a b"] }}', 'var.old', 'var.new')).toBe('{{ var.new["a b"] }}')
  })

  /*
   * A hole the grammar rejects takes its whole Template with it: `tryParseTemplate`
   * answers for the source as a whole, so there is no tree to walk and nothing
   * is touched. Whitespace inside a path is the reachable way to write one.
   */
  it('leaves a Template alone when any hole in it does not parse', () => {
    expect(renamePath('{{ var . old }}', 'var.old', 'var.new')).toBe('{{ var . old }}')
    expect(renamePath('{{ var.old }} {{ var . old }}', 'var.old', 'var.new')).toBe(
      '{{ var.old }} {{ var . old }}',
    )
  })

  /* A command runs against documents that do not project, and half-written text
     is one of them. */
  it('returns text that does not parse unchanged', () => {
    expect(renamePath('{{ var.old', 'var.old', 'var.new')).toBe('{{ var.old')
  })

  it('leaves a Template with no holes alone', () => {
    expect(renamePath('just words', 'var.old', 'var.new')).toBe('just words')
  })

  it('is a no-op when the name did not change', () => {
    expect(renamePath('{{ var.old }}', 'var.old', 'var.old')).toBe('{{ var.old }}')
  })
})
