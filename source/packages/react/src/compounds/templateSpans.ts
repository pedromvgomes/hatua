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
  if (!attempt) return { holes: [], unclosed: null, parses: false }

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
