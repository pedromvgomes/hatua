import type { ScopeEntry } from '@hatua/model'
import { describe, expect, it } from 'vitest'
import { chipFor, completionsAt, expressionChip, ghostFor, referenceTree } from './candidates'
import {
  caretContext,
  dragPayload,
  dropReference,
  expectedAt,
  expressionEnd,
  fits,
  insertCandidate,
  REFERENCE_MIME,
} from './insertion'
import { templateShape } from './templateSpans'

const SCOPE: ScopeEntry[] = [
  {
    path: 'run.tenant',
    kind: 'context',
    label: 'Tenant',
    description: 'Who this run belongs to.',
    type: { type: 'text' },
  },
  { path: 'var.digest_to', kind: 'var', label: 'digest_to', type: { type: 'text' } },
  {
    path: 'triggers.nightly',
    kind: 'trigger',
    label: 'Nightly',
    type: { type: 'object', members: { triggered_at: { type: 'datetime' } } },
  },
  {
    path: 's2',
    kind: 'step',
    label: 'Fetch emails',
    type: {
      type: 'object',
      members: {
        count: { type: 'number' },
        messages: { type: 'list', members: { subject: { type: 'text' } } },
      },
    },
  },
]

describe('where the holes are', () => {
  /*
   * Derived from the parse and never scanned. ADR-0008 puts `{{` / `}}`
   * segmentation inside the shared grammar precisely so no hand-written scanner
   * sits in front of the parser.
   */
  /** Only the spans; each also carries the hole's parsed expression. */
  const spans = (source: string) =>
    templateShape(source).holes.map(({ start, end }) => ({ start, end }))

  it('finds a whole-value hole', () => {
    expect(spans('{{ s2.count }}')).toEqual([{ start: 0, end: 14 }])
  })

  it('finds every hole in mixed text, and the text between them', () => {
    expect(spans('Hi {{ a }} and {{ b }}!')).toEqual([
      { start: 3, end: 10 },
      { start: 15, end: 22 },
    ])
  })

  it('finds two holes with nothing between them', () => {
    expect(spans('{{a}}{{b}}')).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 10 },
    ])
  })

  /* Carried so a caller can ask whether the hole is a Reference — a question
     about the parsed shape, which is the only thing that answers it. */
  it('carries what each hole parsed to', () => {
    expect(templateShape('{{ s2.count }}').holes[0]?.expr?.kind).toBe('Member')
  })

  /*
   * A hole holding a text literal, not an escape rule — which is exactly why
   * reading the delimiters off the text would eventually disagree with the
   * parser about it.
   */
  it("treats {{ '{{' }} as one hole, because that is what it is", () => {
    expect(spans("a {{ '{{' }} b")).toEqual([{ start: 2, end: 12 }])
  })

  it('reports a `{{` with no `}}` as the unclosed tail, not as a parse failure', () => {
    const shape = templateShape('Hi {{ s2.co')
    expect(shape.unclosed).toEqual({ start: 3, end: 11 })
    expect(shape.holes).toEqual([])
  })

  /*
   * `{{ var. }}` is a trailing dot, which no amount of closing makes into an
   * expression — and it is a state every Template passes through while somebody
   * edits one. Without the fallback the highlight disappears mid-edit and comes
   * back a keystroke later, which reads as the field breaking rather than as
   * the expression being unfinished.
   */
  it('still finds a hole in a Template that does not parse', () => {
    const shape = templateShape('{{ var. }}')
    expect(shape.parses).toBe(false)
    expect(spans('{{ var. }}')).toEqual([{ start: 0, end: 10 }])
    // Nothing downstream may mistake it for a Reference: it has no shape yet.
    expect(shape.holes[0]?.expr).toBeUndefined()
  })

  it('still finds one in mixed text that does not parse', () => {
    expect(spans('Hi {{ var. }} and {{ x. }}')).toEqual([
      { start: 3, end: 13 },
      { start: 18, end: 26 },
    ])
  })

  /*
   * The parser wins wherever it can answer, which is the whole reason the
   * fallback is safe: when the text does not parse there is no meaning to be
   * wrong about, and when it does, this is never reached.
   */
  it("keeps {{ '{{' }} as one hole, which a scan alone would get wrong", () => {
    expect(spans("a {{ '{{' }} b")).toEqual([{ start: 2, end: 12 }])
  })
})

describe('what the caret is inside', () => {
  it('reads the prefix from the `{{`, not from the token under the caret', () => {
    const value = '{{ s2.messages[].su }}'
    expect(caretContext(value, 19).prefix).toBe('s2.messages[].su')
  })

  it('is outside every hole when the caret sits in the surrounding text', () => {
    expect(caretContext('Hi {{ a }} there', 14).hole).toBeNull()
  })
})

describe('what a row is judged against', () => {
  /*
   * The open question this PR closes. A hole that is the whole value resolves
   * to the field's value and keeps the expression's own type; a hole inside
   * mixed text is concatenated into a sentence, which ADR-0009 keeps soft — and
   * `checkTemplate` already says nothing about an individual hole's type in
   * that case.
   */
  it('judges a whole-value hole against the field', () => {
    expect(expectedAt('', 0, 0, 'number')).toBe('number')
    expect(expectedAt('{{ x }}', 0, 7, 'number')).toBe('number')
  })

  it('judges a hole inside mixed text against text', () => {
    expect(expectedAt('Order {{ x }}', 6, 13, 'number')).toBe('text')
  })

  it('counts whitespace as text, exactly as the checker does', () => {
    expect(expectedAt(' {{ x }}', 1, 8, 'number')).toBe('text')
  })

  it('judges nothing where nothing declares a type', () => {
    expect(expectedAt('', 0, 0, undefined)).toBeUndefined()
  })

  it('marks any scalar as fitting mixed text, and no container', () => {
    expect(fits('number', 'text')).toBe(true)
    expect(fits('datetime', 'text')).toBe(true)
    expect(fits('list', 'text')).toBe(false)
  })

  /* Nothing is ever marked wrong: neutral covers both. */
  it('never marks an unjudgeable row', () => {
    expect(fits('unknown', 'number')).toBe(false)
    expect(fits('number', undefined)).toBe(false)
  })
})

describe('what is on offer', () => {
  it('offers the scope roots and then the namespaces, as a second block', () => {
    const labels = completionsAt('', SCOPE).map((candidate) => candidate.label)
    expect(labels.slice(0, 4)).toEqual(['run', 'var', 'triggers', 's2'])
    expect(labels.slice(4)).toEqual(['dt', 'json', 'list', 'num', 'text'])
  })

  it("offers a namespace's functions after its dot, and no scope at all", () => {
    const labels = completionsAt('dt.', SCOPE).map((candidate) => candidate.label)
    expect(labels.every((label) => label.startsWith('dt.'))).toBe(true)
    expect(labels).toContain('dt.now')
  })

  it('puts the caret between the parens of an accepted function', () => {
    const [now] = completionsAt('dt.no', SCOPE)
    expect(now?.insert).toBe('dt.now(')
  })

  it("offers a node's members after a scope dot, and no functions", () => {
    const labels = completionsAt('s2.', SCOPE).map((candidate) => candidate.label)
    expect(labels).toEqual(['s2.count', 's2.messages'])
  })

  /* A list has no members — its elements do, which is what `of:` describes. */
  it('offers the whole list and `[]`, and navigates through the projection', () => {
    expect(completionsAt('s2.messages.', SCOPE).map((c) => c.label)).toEqual(['s2.messages[]'])
    expect(completionsAt('s2.messages[].', SCOPE).map((c) => c.label)).toEqual([
      's2.messages[].subject',
    ])
  })

  it('types everything read through a projection as a list', () => {
    const [subject] = completionsAt('s2.messages[].', SCOPE)
    expect(subject?.type).toBe('list')
  })

  it('narrows on what has been typed', () => {
    expect(completionsAt('s2.co', SCOPE).map((c) => c.label)).toEqual(['s2.count'])
  })

  it('carries the sentence a Run Context key declares', () => {
    const [tenant] = completionsAt('run.', SCOPE)
    expect(tenant?.summary).toBe('Who this run belongs to.')
  })

  /* `triggers` alone is a prefix rather than a value — which is what walkName
     reports, and what lets several triggers coexist. */
  it('leaves the list open on a grouping prefix rather than inserting it', () => {
    const [triggers] = completionsAt('trig', SCOPE)
    expect(triggers?.insert).toBe('triggers.')
  })
})

describe('the ghost', () => {
  it('completes what every remaining candidate agrees on', () => {
    expect(ghostFor('s2.c', completionsAt('s2.c', SCOPE))).toBe('ount')
  })

  it('is empty at a dot with no common prefix, and the list alone answers', () => {
    expect(ghostFor('s2.', completionsAt('s2.', SCOPE))).toBe('')
  })
})

describe('writing it in', () => {
  it('wraps a candidate chosen outside a hole', () => {
    const edit = insertCandidate('', caretContext('', 0), 0, 's2.count')
    expect(edit.value).toBe('{{ s2.count }}')
  })

  it('replaces the typed prefix inside a hole rather than appending to it', () => {
    const value = '{{ s2.co }}'
    const edit = insertCandidate(value, caretContext(value, 8), 8, 's2.count')
    expect(edit.value).toBe('{{ s2.count }}')
  })

  it('leaves the caret inside the braces when the insertion is mid-expression', () => {
    const edit = insertCandidate('', caretContext('', 0), 0, 'dt.now(')
    expect(edit.value.slice(0, edit.caret)).toBe('{{ dt.now(')
  })
})

describe('dropping a reference', () => {
  it('carries the bare path and the wrapped Template, for two different readers', () => {
    expect(dragPayload('s2.count')).toEqual([
      [REFERENCE_MIME, 's2.count'],
      ['text/plain', '{{ s2.count }}'],
    ])
  })

  /* A leading-space rule alone welds the token to the following word. */
  it('spaces the token on both sides when a neighbour is not already whitespace', () => {
    expect(dropReference('Hithere', 2, 2, 'x').value).toBe('Hi {{ x }} there')
  })

  it('adds no space where there is already whitespace, or nothing at all', () => {
    expect(dropReference('Hi ', 3, 3, 'x').value).toBe('Hi {{ x }}')
    expect(dropReference('', 0, 0, 'x').value).toBe('{{ x }}')
  })

  it('replaces the whole value in a field that holds exactly one Reference', () => {
    expect(dropReference('{{ old }}', 4, 4, 'x', { replace: true }).value).toBe('{{ x }}')
  })
})

describe('the reference tree', () => {
  it('recovers a root from dotted paths, and leaves it unaddressable', () => {
    const tree = referenceTree(SCOPE)
    const triggers = tree.find((node) => node.path === 'triggers')
    expect(triggers?.type).toBe('unknown')
    expect(triggers?.children?.map((child) => child.path)).toEqual(['triggers.nightly'])
  })

  it('names a grouping prefix in the user’s words, not the document’s', () => {
    expect(referenceTree(SCOPE).find((node) => node.path === 'run')?.label).toBe('Run context')
  })
})

describe('completing inside a call', () => {
  /*
   * An Expression is a whole language, and a path is only ever the innermost
   * part of one. Measured from the `{{`, this asks for the members of something
   * called `dt.diff(dt`, which is nothing — so the list came up empty exactly
   * where a nested call is being written.
   */
  it('completes the argument being typed, not the whole hole', () => {
    const value = '{{ dt.diff(dt. }}'
    const context = caretContext(value, 14)
    expect(context.prefix).toBe('dt.')
    expect(completionsAt(context.prefix, SCOPE).map((c) => c.label)).toContain('dt.now')
  })

  it('replaces only that argument when a row is accepted', () => {
    const value = '{{ dt.diff(dt. }}'
    const edit = insertCandidate(value, caretContext(value, 14), 14, 'dt.now(')
    expect(edit.value).toBe('{{ dt.diff(dt.now( }}')
  })

  it('starts again after a comma, and after an operator', () => {
    expect(caretContext('{{ dt.diff(a, s2.co }}', 19).prefix).toBe('s2.co')
    expect(caretContext('{{ s2.count + s2.co }}', 19).prefix).toBe('s2.co')
  })

  /* `.`, `[` and `]` continue a path; a projection is one prefix, not four. */
  it('keeps a projection whole', () => {
    expect(caretContext('{{ s2.messages[].su }}', 19).prefix).toBe('s2.messages[].su')
  })
})

describe('what a Reference is called at rest', () => {
  it('reads as the Step, then the way down to the value', () => {
    expect(chipFor('s2.count', SCOPE)).toEqual({
      of: 'reference',
      kind: 'step',
      source: 'Fetch emails',
      leaf: 'count',
    })
  })

  /*
   * The source is the half a label alone loses. `var.digest_to` reduced to
   * "digest_to", and two chips reading "digest_to" and "count" say nothing
   * about where either value is from.
   */
  it('supplies the kind as the source where the path names no entity', () => {
    expect(chipFor('var.digest_to', SCOPE)).toEqual({
      of: 'reference',
      kind: 'var',
      source: 'Variable',
      leaf: 'digest_to',
    })
    expect(chipFor('run.tenant', SCOPE)).toEqual({
      of: 'reference',
      kind: 'context',
      source: 'Run context',
      leaf: 'Tenant',
    })
  })

  /* `run`, `var` and `triggers` are how a Template spells a root, never what
     anyone calls it. */
  it('never shows the grouping prefix itself', () => {
    expect(chipFor('triggers.nightly.triggered_at', SCOPE)).toEqual({
      of: 'reference',
      kind: 'trigger',
      source: 'Nightly',
      leaf: 'triggered_at',
    })
  })

  it('names a projection as each of its elements', () => {
    const chip = chipFor('s2.messages[].subject', SCOPE)
    expect(chip?.of === 'reference' && chip.leaf).toBe('messages each subject')
  })

  /*
   * A stale Reference keeps showing its path: the path is what the checker
   * names and what has to be edited, and a friendly label over a Step that no
   * longer exists hides the one fact worth seeing.
   */
  it('refuses to name a path that is no longer in scope', () => {
    expect(chipFor('s9.gone', SCOPE)).toBeNull()
  })
})

describe('clicking a chip', () => {
  /*
   * A chip is narrower than the characters it stands for, so the offset the
   * browser derives from the pointer lands somewhere arbitrary inside the path
   * — the one place a click has an obviously right answer and would get a
   * nearly random one.
   */
  it('puts the caret at the end of the expression, inside the braces', () => {
    const value = '{{ var.digest_to }}'
    const hole = templateShape(value).holes[0]
    expect(expressionEnd(value, hole as never)).toBe(16)
    expect(value.slice(0, 16)).toBe('{{ var.digest_to')
  })

  it('works for a hole written with no spaces at all', () => {
    const value = '{{s2.count}}'
    expect(expressionEnd(value, templateShape(value).holes[0] as never)).toBe(10)
  })

  it('never lands before the opening braces, whatever is between them', () => {
    const value = '{{   }}'
    expect(expressionEnd(value, templateShape(value).holes[0] as never)).toBe(2)
  })
})

describe('positions a caret can be in that are not inside a hole', () => {
  /*
   * Between the two braces the `{{` is not complete before the caret, so there
   * is no hole yet. Treated as one, the prefix began one character AFTER the
   * caret and accepting a row spliced a reversed range — `a{{b}}` came back as
   * `a{{s2{b}}`.
   */
  it('is outside when the caret is between the braces', () => {
    const context = caretContext('a{{b}}', 2)
    expect(context.hole).toBeNull()
    expect(context.prefixStart).toBe(2)
  })

  it('never reports a prefix that starts after the caret', () => {
    const value = 'a{{b}}'
    for (let caret = 0; caret <= value.length; caret++) {
      expect(caretContext(value, caret).prefixStart).toBeLessThanOrEqual(caret)
    }
  })

  it('wraps a candidate rather than splicing backwards there', () => {
    // Split at the caret and nothing re-emitted: `a{` + the new hole + `{b}}`.
    const value = 'a{{b}}'
    expect(insertCandidate(value, caretContext(value, 2), 2, 's2').value).toBe('a{{{ s2 }}{b}}')
  })
})

describe('a hole the scanner found', () => {
  /*
   * Every offset in a tree is measured from the start of what was parsed, so a
   * hole parsed out of context came back with its References claiming to start
   * where they sit inside the hole. `expressionChip` reads them against the
   * whole value, found the wrong characters, and quietly named nothing — in
   * precisely the state the fallback exists to serve.
   */
  it('reports offsets into the whole value, not into itself', () => {
    const value = '{{ a. }}{{ s2.count + 1 }}'
    const shape = templateShape(value)
    expect(shape.parses).toBe(false)

    const second = shape.holes[1]
    expect(second?.start).toBe(8)
    // `s2.count` begins at 11 in the value, not at 3 inside its own hole.
    expect((second?.expr as { at: number } | undefined)?.at).toBe(11)
  })

  it('still names what it can when an earlier hole is unfinished', () => {
    const value = '{{ a. }}{{ s2.count + 1 }}'
    const hole = templateShape(value).holes[1]
    const parts = expressionChip(value, hole?.expr as never, 11, 23, SCOPE)
    expect(parts.map((part) => (part.of === 'reference' ? part.leaf : part.text))).toEqual([
      'count',
      ' + 1',
    ])
  })
})
