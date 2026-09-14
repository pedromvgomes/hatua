import { Lexer } from 'yaml'

/**
 * The source text, split into the pieces a reader tells apart by eye.
 *
 * Here rather than in the renderer because this package owns the YAML seam:
 * `yaml` is its dependency and its whole reason for existing is that nothing
 * else has to know how a YAML document is taken apart. A second package
 * importing the lexer would be a second answer to "what is this text made of".
 *
 * ## Why the lexer and not the parser
 *
 * `parseWorkflow` refuses a source it cannot compose, and refusing is right —
 * there is nothing to edit through. But a reader typing in **Text Mode** spends
 * most of their keystrokes on text that does not parse, and colour that flickered
 * off between two valid states would be worse than no colour at all. A lexer has
 * no such state: it splits what is there and says nothing about whether it means
 * anything.
 *
 * ## Offsets rather than substrings
 *
 * The lexer yields the source in order, so the spans below reassemble it exactly.
 * Handing back offsets keeps that checkable — `spans.map(text.slice)` IS the
 * source — and lets a caller cut a span finer without re-lexing, which is what
 * a **Template** inside a scalar needs.
 */

export type SpanKind =
  /** A `#` comment, to the end of its line. */
  | 'comment'
  /** The scalar on the left of a `:`. */
  | 'key'
  /** A quoted scalar, or a block scalar's body. */
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  /** An unquoted scalar that is none of the above. */
  | 'scalar'
  /** `:`, `-`, `,`, brackets, braces, and the document markers. */
  | 'punctuation'
  /** `&anchor`, `*alias`, `!!tag`, `%DIRECTIVE`. */
  | 'annotation'
  /** Whitespace and newlines, carried so the spans reassemble the source. */
  | 'space'

export interface Span {
  /** Index into the source, inclusive. */
  from: number
  /** Index into the source, exclusive. */
  to: number
  kind: SpanKind
}

/**
 * The lexer's zero-width markers.
 *
 * `\x02` opens a document and `\x1f` announces that a scalar follows; neither
 * appears in the source, so neither may advance the offset. Everything else the
 * lexer yields is a slice of the input, which is what makes the reassembly
 * property hold.
 */
const isMarker = (token: string): boolean => {
  const code = token.charCodeAt(0)
  return code < 0x20 && token !== '\n' && token !== '\t'
}

const PUNCTUATION = new Set([':', '-', '?', ',', '[', ']', '{', '}', '---', '...'])

const BOOLEANS = new Set([
  'true',
  'false',
  'True',
  'False',
  'TRUE',
  'FALSE',
  'yes',
  'no',
  'on',
  'off',
])
const NULLS = new Set(['null', 'Null', 'NULL', '~'])

/** A plain scalar's kind, judged the way a reader judges it rather than by resolution. */
const scalarKind = (text: string): SpanKind => {
  if (
    text.startsWith('"') ||
    text.startsWith("'") ||
    text.startsWith('|') ||
    text.startsWith('>')
  ) {
    return 'string'
  }
  if (BOOLEANS.has(text)) return 'boolean'
  if (NULLS.has(text)) return 'null'
  // Deliberately not YAML's full number grammar: this decides a colour, and a
  // reader calling `0x1f` a number is right whatever the resolver does with it.
  if (/^[-+]?(\d[\d_]*)(\.\d*)?([eE][-+]?\d+)?$/.test(text) || /^0[xob][\dA-Fa-f_]+$/.test(text)) {
    return 'number'
  }
  return 'scalar'
}

/**
 * Split `source` into spans covering every character exactly once.
 *
 * A lexer error is not raised: `yaml`'s lexer is total over any string, and the
 * point of using it here is that half-typed input has an answer. What it cannot
 * classify comes back as `scalar`, which renders as ordinary text.
 */
export function lexYaml(source: string): Span[] {
  const spans: Span[] = []
  let at = 0
  /*
   * Whether the scalar coming next is a key.
   *
   * The lexer announces a scalar with a marker and does not say what it is for,
   * so a key is recognised the way a reader recognises one: it is the scalar
   * with a `:` after it. Held as a pending index rather than decided on sight,
   * because the `:` has not been seen yet when the scalar is emitted.
   */
  let pendingScalar: number | null = null

  const push = (from: number, to: number, kind: SpanKind) => {
    if (to > from) spans.push({ from, to, kind })
  }

  for (const token of new Lexer().lex(source)) {
    if (isMarker(token)) continue

    const from = at
    at += token.length
    const to = at

    if (token.startsWith('#')) {
      push(from, to, 'comment')
      pendingScalar = null
      continue
    }

    if (token.trim() === '') {
      push(from, to, 'space')
      continue
    }

    if (PUNCTUATION.has(token)) {
      /*
       * The `:` is what turns the scalar before it into a key — retyped rather
       * than guessed at when the scalar was emitted, because `- a` and `a:` are
       * the same token stream up to this point.
       */
      if (token === ':' && pendingScalar !== null) {
        const held = spans[pendingScalar]
        if (held) held.kind = 'key'
      }
      push(from, to, 'punctuation')
      pendingScalar = null
      continue
    }

    if (/^[&*!%]/.test(token)) {
      push(from, to, 'annotation')
      pendingScalar = null
      continue
    }

    pendingScalar = spans.length
    push(from, to, scalarKind(token))
  }

  /*
   * Anything the lexer did not reach — it stops at the end of the last document
   * it could open, and an empty or whitespace-only source produces nothing at
   * all. Covering the remainder is what keeps the reassembly property true for
   * every input rather than for the ones that lex cleanly.
   */
  push(at, source.length, 'scalar')

  return spans
}
