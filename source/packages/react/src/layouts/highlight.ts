import { lexYaml, type SpanKind } from '@hatua/document'
import { templateShape } from '../compounds/templateSpans'
import type { CodeKind, CodeToken } from '../units/Code'

/**
 * What each of the two source surfaces hands `<Code>`.
 *
 * They arrive at their tokens completely differently and that is the point.
 * **Text Mode** has *text* — possibly half-typed, possibly not a workflow — so
 * it is lexed. A run's payload is a *value* the Host handed over, so there is
 * nothing to lex: walking it while serialising says a string is a string because
 * it IS one, which no parser can promise.
 *
 * Both end at one token vocabulary, so a string looks the same on either screen.
 */

/** The lexer's vocabulary mapped onto the renderer's, which is smaller. */
const KIND: Record<SpanKind, CodeKind> = {
  comment: 'comment',
  key: 'key',
  string: 'string',
  number: 'number',
  boolean: 'number',
  null: 'number',
  scalar: 'plain',
  punctuation: 'punctuation',
  annotation: 'punctuation',
  space: 'plain',
}

/**
 * YAML source, split for colour.
 *
 * Two passes, because they answer different questions. The lexer says what each
 * run of the document IS; `templateShape` then cuts the runs that hold a
 * `{{ … }}` finer. Neither could do the other's job — a YAML grammar has never
 * heard of a **Template**, and the Template grammar has nothing to say about
 * `steps:`.
 *
 * The Template pass is **derived from the parse, never scanned**. ADR-0008 puts
 * `{{` / `}}` segmentation inside the shared grammar precisely so no
 * hand-written scanner sits in front of the parser, and a highlighter finding
 * its own delimiters would be that scanner — right up until it disagreed about
 * `{{ '{{' }}`, which is a hole holding a text literal rather than an escape.
 */
export function yamlTokens(source: string): CodeToken[] {
  const tokens: CodeToken[] = []

  for (const span of lexYaml(source)) {
    const text = source.slice(span.from, span.to)
    const kind = KIND[span.kind]

    // Only where a hole could be. A comment carrying `{{ … }}` is still a
    // comment — it is not evaluated, and colouring it as live would say it was.
    if (kind === 'string' || kind === 'plain' || kind === 'key') {
      const holes = templateShape(text).holes
      if (holes.length > 0) {
        let at = 0
        for (const hole of holes) {
          if (hole.start > at) tokens.push({ text: text.slice(at, hole.start), kind })
          tokens.push({ text: text.slice(hole.start, hole.end), kind: 'reference' })
          at = hole.end
        }
        if (at < text.length) tokens.push({ text: text.slice(at), kind })
        continue
      }
    }

    tokens.push({ text, kind })
  }

  return tokens
}

/** How deep a payload is indented before it is folded flat. */
const INDENT = '  '

/**
 * A value the **Host** handed over, serialised and coloured in one pass.
 *
 * `JSON.stringify` and then re-parse would be the obvious shape and it throws
 * away the only thing worth having: by the time a payload is text, "was this a
 * string or a number" is a question a tokeniser has to guess at from quotes it
 * has just written. Walking the value keeps the answer.
 *
 * `output` is `{}` in the schema — anything at all — so this handles whatever
 * arrives, including the shapes JSON has no syntax for. A function or a
 * `BigInt` is written as its description rather than dropped, because a payload
 * with a key silently missing is worse than one saying what it holds.
 */
export function valueTokens(value: unknown): CodeToken[] {
  const tokens: CodeToken[] = []

  const push = (text: string, kind: CodeKind) => tokens.push({ text, kind })

  const walk = (node: unknown, depth: number, seen: Set<object>) => {
    if (node === null) return push('null', 'number')

    switch (typeof node) {
      case 'string':
        return push(JSON.stringify(node), 'string')
      case 'number':
        // `NaN` and `Infinity` are numbers with no JSON spelling, and a payload
        // that dropped them would be one whose absence means nothing.
        return push(Number.isFinite(node) ? String(node) : String(node), 'number')
      case 'boolean':
        return push(String(node), 'number')
      case 'bigint':
        return push(`${String(node)}n`, 'number')
      case 'undefined':
        return push('undefined', 'punctuation')
      case 'function':
        return push('<function>', 'punctuation')
      case 'symbol':
        return push(String(node), 'punctuation')
      default:
        break
    }

    const object = node as object

    /*
     * A cycle is written as a marker rather than followed.
     *
     * The Host's payload is arbitrary and nothing here validated it, so a
     * self-referencing object is a possibility — and the alternative to noticing
     * is a stack overflow that takes the whole tree down while rendering
     * history.
     */
    if (seen.has(object)) return push('<circular>', 'punctuation')
    seen.add(object)

    const pad = INDENT.repeat(depth + 1)
    const closePad = INDENT.repeat(depth)

    if (Array.isArray(object)) {
      if (object.length === 0) {
        seen.delete(object)
        return push('[]', 'punctuation')
      }
      push('[\n', 'punctuation')
      object.forEach((item, index) => {
        push(pad, 'plain')
        walk(item, depth + 1, seen)
        push(index === object.length - 1 ? '\n' : ',\n', 'punctuation')
      })
      push(`${closePad}]`, 'punctuation')
      seen.delete(object)
      return
    }

    const entries = Object.entries(object as Record<string, unknown>)
    if (entries.length === 0) {
      seen.delete(object)
      return push('{}', 'punctuation')
    }

    push('{\n', 'punctuation')
    entries.forEach(([key, held], index) => {
      push(pad, 'plain')
      push(JSON.stringify(key), 'key')
      push(': ', 'punctuation')
      walk(held, depth + 1, seen)
      push(index === entries.length - 1 ? '\n' : ',\n', 'punctuation')
    })
    push(`${closePad}}`, 'punctuation')
    seen.delete(object)
  }

  walk(value, 0, new Set())
  return tokens
}
