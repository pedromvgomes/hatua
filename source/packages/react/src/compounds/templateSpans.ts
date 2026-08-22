import {
  type Expression,
  type Segment,
  type TemplateNode,
  tryParseTemplate,
} from '@hatua/expressions'

/**
 * Where each `{{ … }}` sits in the text, so the input can paint it in place.
 *
 * **Derived from the parse, never scanned.** ADR-0008 puts `{{` / `}}`
 * segmentation inside the shared grammar precisely so no hand-written scanner
 * sits in front of the parser in either language, and a highlighter that found
 * its own delimiters would be exactly that scanner — right up until it
 * disagreed with the parser about `{{ '{{' }}`, which is a hole holding a text
 * literal and not an escape.
 *
 * The AST carries an offset on every hole and none on the text between them, so
 * the spans are recovered from two facts and nothing else. A hole's `at` is the
 * offset of its *expression*, not of its `{{` — the delimiter and any
 * whitespace after it sit in front — so its opening brace is the last `{{` at
 * or before that offset, which cannot be anything else: `at` is the first
 * character of the expression, so no `{{` between them exists to be found. And
 * every segment ends where the next one starts, with the last ending at the end
 * of the text, which a backward walk settles because a text segment's own
 * length is its whole contribution.
 *
 * Both facts come from the parse. Neither is a rule about where a hole begins,
 * which is the grammar's to state and is stated there once for both languages.
 */
export interface HoleSpan {
  start: number
  /** Exclusive, and past the closing `}}` — except on the unclosed tail. */
  end: number
  /**
   * What the hole holds, when it parsed.
   *
   * Carried so a caller can ask `@hatua/expressions` whether the hole is a
   * Reference — a question about the parsed *shape*, which is the only thing
   * that answers it. A Reference is what may be drawn as a chip; an expression
   * that computes something names no target to put on one.
   */
  expr?: Expression
}

export interface TemplateShape {
  /** Every closed hole, in source order. */
  holes: HoleSpan[]
  /**
   * A trailing `{{` with nothing closing it, if that is the only thing wrong.
   *
   * Detected by parsing the source again with the closers appended: an unclosed
   * hole is one that parses once it is closed. That keeps the definition of
   * "hole" in the grammar rather than growing a second one here, and it is the
   * state every Template passes through while somebody types one.
   *
   * Unmatched `(` counts as unclosed too, because `{{ dt.add(` is what a call
   * looks like for as long as it takes to type its arguments — and that is
   * precisely when the highlight and the signature strip are worth having.
   */
  unclosed: HoleSpan | null
  /** False when the text is broken in some way appending `}}` does not fix. */
  parses: boolean
}

const EMPTY: TemplateShape = { holes: [], unclosed: null, parses: true }

export function templateShape(source: string): TemplateShape {
  if (source === '') return EMPTY

  const parsed = tryParseTemplate(source)
  if (parsed.ok)
    return { holes: spansOf(parsed.template.segments, source), unclosed: null, parses: true }

  const attempt = repair(source)
  if (!attempt) return scan(source)

  const spans = spansOf(attempt.template.segments, attempt.closed)
  const tail = spans.pop()
  return {
    holes: spans,
    // Clamped to the real end of the text, since the closing braces are ours.
    // No `expr`: what the repair parsed is not what is written, so nothing
    // about the tail's shape is settled until it is closed for real.
    unclosed: tail ? { start: tail.start, end: source.length } : null,
    parses: false,
  }
}

/**
 * The source with just enough appended to close it, parsed.
 *
 * No space before the braces: one would shift every offset the repair produced
 * by one, and the spans are read straight back against the ORIGINAL text.
 *
 * Bounded rather than open-ended, because the job is to recognise a Template
 * mid-typing and not to recover from arbitrary breakage. Beyond a few unclosed
 * calls the honest answer is that the text does not parse, which is a state the
 * field renders as its error border and a diagnostic underneath.
 */
function repair(source: string): { template: TemplateNode; closed: string } | null {
  for (let parens = 0; parens <= 4; parens++) {
    const closed = `${source}${')'.repeat(parens)}}}`
    const parsed = tryParseTemplate(closed)
    if (parsed.ok) return { template: parsed.template, closed }
  }
  return null
}

/**
 * The delimiters, read straight off the text, for a Template that does not
 * parse at all.
 *
 * The last resort, and only ever that: `{{ var. }}` is a trailing dot, which no
 * amount of closing makes into an expression, and it is a state every Template
 * passes through while somebody edits one. Without this the highlight
 * disappears the moment a hole is mid-edit and comes back a keystroke later,
 * which reads as the field breaking rather than as the expression being
 * unfinished.
 *
 * It is safe *here* for the reason it is not safe anywhere the parse can answer:
 * when the text does not parse there is no meaning to be wrong about. The
 * parser still wins whenever it can, which is what keeps `{{ '{{' }}` drawn as
 * the one hole it is rather than as two.
 *
 * Where the holes are is all this decides. What each one *holds* is still the
 * parser's to say, hole by hole — so one unfinished `{{ s2. + }}` costs its own
 * chip and not every chip in the field.
 */
function scan(source: string): TemplateShape {
  const holes: HoleSpan[] = []
  let at = 0

  while (at < source.length) {
    const open = source.indexOf('{{', at)
    if (open === -1) break
    const close = source.indexOf('}}', open + 2)
    if (close === -1) {
      return { holes, unclosed: { start: open, end: source.length }, parses: false }
    }
    holes.push({ start: open, end: close + 2, ...parsed(source, open, close + 2) })
    at = close + 2
  }

  return { holes, unclosed: null, parses: false }
}

/**
 * What one hole holds, asked of the parser where the hole actually sits.
 *
 * Padded with the whitespace it is standing on rather than sliced out of the
 * source, because every offset in the tree is measured from the start of what
 * was parsed. Sliced, a hole at offset 8 came back with its References claiming
 * to start at 3 — and `expressionChip`, which reads them against the whole
 * value, then found the wrong characters there and quietly named nothing.
 *
 * Whitespace, so what precedes the hole is one Text segment and cannot be
 * anything else. Absent when it does not parse, which is what keeps a
 * half-written hole from being mistaken for a Reference.
 */
function parsed(source: string, from: number, to: number): { expr?: Expression } {
  const attempt = tryParseTemplate(' '.repeat(from) + source.slice(from, to))
  if (!attempt.ok) return {}
  const hole = attempt.template.segments.find((segment) => segment.kind === 'Hole')
  return hole && attempt.template.segments.length <= 2 ? { expr: hole.expr } : {}
}

function spansOf(segments: readonly Segment[], text: string): HoleSpan[] {
  const holes: HoleSpan[] = []
  let end = text.length

  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i] as Segment
    const start =
      segment.kind === 'Text' ? end - segment.value.length : text.lastIndexOf('{{', segment.at)
    if (segment.kind === 'Hole') holes.unshift({ start, end, expr: segment.expr })
    end = start
  }

  return holes
}
