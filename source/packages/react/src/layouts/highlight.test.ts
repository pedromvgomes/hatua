import { describe, expect, it } from 'vitest'
import type { CodeToken } from '../units/Code'
import { valueTokens, yamlTokens } from './highlight'

/**
 * The two producers behind `<Code>`.
 *
 * The property both are held to is that the tokens reassemble what they
 * describe. For **Text Mode** it is load-bearing beyond looking right: the
 * coloured layer sits under a textarea, so a highlighter that drops or doubles a
 * character puts the caret between the wrong glyphs.
 */

const text = (tokens: readonly CodeToken[]) => tokens.map((token) => token.text).join('')

const of = (tokens: readonly CodeToken[], kind: CodeToken['kind']) =>
  tokens.filter((token) => token.kind === kind).map((token) => token.text)

describe('YAML', () => {
  const SOURCE = `# The overnight triage.
id: wf_morning
version: 4
steps:
  - id: s1
    use: component.email.send
    with:
      to: "{{ var.digest_to }}"
      subject: "Re: {{ steps.s1.subject }} — {{ run.id }}"
`

  it('reassembles the source exactly', () => {
    expect(text(yamlTokens(SOURCE))).toBe(SOURCE)
  })

  it('reassembles a source that is not a workflow yet', () => {
    // The state Text Mode exists for, and the state a reader spends most of
    // their keystrokes in.
    const half = 'id: wf\nsteps:\n  - use: '
    expect(text(yamlTokens(half))).toBe(half)
    expect(text(yamlTokens(''))).toBe('')
    expect(text(yamlTokens('id: a\n---\nid: b\n'))).toBe('id: a\n---\nid: b\n')
  })

  it('colours keys, comments, strings and numbers apart', () => {
    const tokens = yamlTokens(SOURCE)
    expect(of(tokens, 'key')).toContain('id')
    expect(of(tokens, 'key')).toContain('version')
    expect(of(tokens, 'comment')).toEqual(['# The overnight triage.'])
    expect(of(tokens, 'number')).toContain('4')
  })

  it('marks a Template inside a string as a Reference', () => {
    const tokens = yamlTokens('to: "{{ var.digest_to }}"\n')

    // The one span no YAML grammar knows about, and the reason this is not an
    // off-the-shelf highlighter.
    expect(of(tokens, 'reference')).toEqual(['{{ var.digest_to }}'])
    // The quotes around it are still string, so the hole reads as sitting
    // inside the value rather than replacing it.
    expect(of(tokens, 'string')).toEqual(['"', '"'])
  })

  it('marks each hole of a string holding several', () => {
    const tokens = yamlTokens('subject: "Re: {{ a.b }} — {{ c.d }}"\n')
    expect(of(tokens, 'reference')).toEqual(['{{ a.b }}', '{{ c.d }}'])
    expect(text(tokens)).toBe('subject: "Re: {{ a.b }} — {{ c.d }}"\n')
  })

  it('leaves a Template in a comment alone', () => {
    // A comment is not evaluated, and colouring it as live would say it was.
    const tokens = yamlTokens('# see {{ var.x }}\n')
    expect(of(tokens, 'reference')).toEqual([])
    expect(of(tokens, 'comment')).toEqual(['# see {{ var.x }}'])
  })

  it('finds the hole through the parser rather than by scanning for braces', () => {
    // `{{ '{{' }}` is a hole holding a text literal, not an escape. A scanner
    // looking for delimiters would close on the inner pair (ADR-0008).
    const source = `to: "{{ '{{' }}"\n`
    const tokens = yamlTokens(source)
    expect(text(tokens)).toBe(source)
    expect(of(tokens, 'reference')).toEqual([`{{ '{{' }}`])
  })
})

describe('a payload', () => {
  it('reads back as the JSON it stands for', () => {
    const value = { folder: 'INBOX', count: 24, ok: true, nothing: null, tags: ['a', 'b'] }
    expect(JSON.parse(text(valueTokens(value)))).toEqual(value)
  })

  it('colours a key apart from a string value', () => {
    const tokens = valueTokens({ folder: 'INBOX' })
    // The distinction a tokeniser reading the serialised text has to guess at
    // from quotes it has just written; walking the value knows.
    expect(of(tokens, 'key')).toEqual(['"folder"'])
    expect(of(tokens, 'string')).toEqual(['"INBOX"'])
  })

  it('writes an empty object and an empty list on one line', () => {
    expect(text(valueTokens({ a: {}, b: [] }))).toBe('{\n  "a": {},\n  "b": []\n}')
  })

  it('indents nesting', () => {
    expect(text(valueTokens({ a: { b: 1 } }))).toBe('{\n  "a": {\n    "b": 1\n  }\n}')
  })

  it('says what it holds for the shapes JSON cannot spell', () => {
    // `output` is `{}` in the schema — anything at all — and a payload with a
    // key silently missing is worse than one saying what is there.
    const tokens = valueTokens({ big: 10n, nan: Number.NaN, fn: () => {}, gone: undefined })
    const written = text(tokens)
    expect(written).toContain('10n')
    expect(written).toContain('NaN')
    expect(written).toContain('<function>')
    expect(written).toContain('undefined')
  })

  it('marks a cycle rather than following it', () => {
    // Nothing validated the Host's payload, and the alternative to noticing is a
    // stack overflow that takes the tree down while rendering history.
    const value: Record<string, unknown> = { name: 'loop' }
    value.self = value
    expect(text(valueTokens(value))).toContain('<circular>')
  })

  it('draws one object twice when it is shared rather than circular', () => {
    // A value referenced from two keys is not a cycle, and calling it one would
    // hide half the payload.
    const shared = { id: 1 }
    expect(text(valueTokens({ a: shared, b: shared }))).toBe(
      '{\n  "a": {\n    "id": 1\n  },\n  "b": {\n    "id": 1\n  }\n}',
    )
  })

  it('handles a bare value, not only an object', () => {
    expect(text(valueTokens('hello'))).toBe('"hello"')
    expect(text(valueTokens(null))).toBe('null')
    expect(text(valueTokens(3))).toBe('3')
  })
})
