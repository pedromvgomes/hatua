import { describe, expect, it } from 'vitest'
import { lexYaml, type Span } from './lex'

/**
 * The property everything else rests on: the spans reassemble the source.
 *
 * A highlighter that drops or duplicates a character does not merely mis-colour
 * — it renders text the user did not type, under a caret that is now in the
 * wrong place. So every test below checks the reassembly as well as whatever it
 * is really about.
 */

const rebuilt = (source: string, spans: Span[]) =>
  spans.map((span) => source.slice(span.from, span.to)).join('')

/** Assert the property, then hand back the spans for the test to inspect. */
const lex = (source: string): Span[] => {
  const spans = lexYaml(source)
  expect(rebuilt(source, spans)).toBe(source)
  // Every character exactly once, in order.
  let at = 0
  for (const span of spans) {
    expect(span.from).toBe(at)
    at = span.to
  }
  expect(at).toBe(source.length)
  return spans
}

/** The kinds of the spans that are not whitespace, which is what a reader sees. */
const kinds = (source: string) =>
  lex(source)
    .filter((span) => span.kind !== 'space')
    .map((span) => `${span.kind}:${source.slice(span.from, span.to)}`)

describe('splitting a document', () => {
  it('tells a key from the value beside it', () => {
    expect(kinds('id: wf_morning\n')).toEqual(['key:id', 'punctuation::', 'scalar:wf_morning'])
  })

  it('carries a comment whole, to the end of its line', () => {
    expect(kinds('folder: INBOX      # not Archive\n')).toEqual([
      'key:folder',
      'punctuation::',
      'scalar:INBOX',
      'comment:# not Archive',
    ])
  })

  it('reads a quoted scalar as a string, quotes included', () => {
    expect(kinds('name: "Morning inbox triage"\n')).toEqual([
      'key:name',
      'punctuation::',
      'string:"Morning inbox triage"',
    ])
  })

  it('tells numbers and booleans apart from ordinary words', () => {
    expect(kinds('version: 4\nready: true\nnothing: null\nverb: core.fork\n')).toEqual([
      'key:version',
      'punctuation::',
      'number:4',
      'key:ready',
      'punctuation::',
      'boolean:true',
      'key:nothing',
      'punctuation::',
      'null:null',
      'key:verb',
      'punctuation::',
      'scalar:core.fork',
    ])
  })

  it('does not call a list item a key', () => {
    // `- a` and `a:` are the same token stream until the `:` arrives, which is
    // why the decision is retyped rather than guessed at when the scalar lands.
    expect(kinds('steps:\n  - id: s1\n')).toEqual([
      'key:steps',
      'punctuation::',
      'punctuation:-',
      'key:id',
      'punctuation::',
      'scalar:s1',
    ])
  })
})

describe('text that is not a workflow yet', () => {
  /*
   * The state this exists for. `parseWorkflow` refuses these and is right to;
   * colour that flickered off between two valid states would be worse than none,
   * so the lexer answers where the parser will not.
   */
  it('splits a half-typed line', () => {
    expect(kinds('id: wf\nsteps:\n  - use: ')).toEqual([
      'key:id',
      'punctuation::',
      'scalar:wf',
      'key:steps',
      'punctuation::',
      'punctuation:-',
      'key:use',
      'punctuation::',
    ])
  })

  it('splits a source that is not a mapping at all', () => {
    expect(kinds('steps: the ones from before\n')).toEqual([
      'key:steps',
      'punctuation::',
      'scalar:the ones from before',
    ])
  })

  it('covers a source holding two documents, which the parser refuses', () => {
    // Nothing may edit this, and it still has to be readable — that is the whole
    // of the escape Text Mode offers.
    const spans = lex('id: a\n---\nid: b\n')
    expect(spans.length).toBeGreaterThan(0)
  })

  it('covers the empty source and one made only of space', () => {
    expect(lex('')).toEqual([])
    expect(lex('\n\n  \n').every((span) => span.kind === 'space')).toBe(true)
  })

  it('covers a source that is nothing but a comment', () => {
    expect(kinds('# nothing else here\n')).toEqual(['comment:# nothing else here'])
  })
})
