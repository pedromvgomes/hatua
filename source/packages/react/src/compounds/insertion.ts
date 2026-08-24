import { match, type ValueType } from '@hatua/expressions'
import type { HoleSpan } from './templateSpans'

/**
 * Where the caret is, what an insertion there would mean, and what type the
 * result has to produce.
 *
 * Separate from the widget because every one of these questions has a right
 * answer that a test can state in one line, and because the picker, the
 * completion list, the ⚡ button and a drop all have to answer them the same
 * way.
 */

/** Both MIME types a dragged leaf carries. */
export const REFERENCE_MIME = 'application/x-hatua-reference'

/**
 * What a drag out of the reference tree puts on the clipboard.
 *
 * Two types, because the two readers want different things. A drop into a Hatua
 * field wants the **bare path**: the field decides the delimiters, and whether
 * it appends or replaces. A drop into any other editor on the page — the Host's
 * own notes field, a chat box, a terminal — should still paste something
 * meaningful, and `text/plain` is the only thing those read.
 *
 * Written down here rather than at the drag site because the Data panel will
 * produce this payload too, and a format invented independently on the drop
 * side is a format that will not match.
 */
export const dragPayload = (path: string): readonly (readonly [string, string])[] => [
  [REFERENCE_MIME, path],
  ['text/plain', `{{ ${path} }}`],
]

/** The dragged path, or null when what was dropped is not one of ours. */
export const droppedPath = (transfer: DataTransfer | null): string | null =>
  transfer?.getData(REFERENCE_MIME) || null

export interface CaretContext {
  /** The hole the caret sits in, or null when it sits in the surrounding text. */
  hole: HoleSpan | null
  /** The expression text from the hole's `{{` up to the caret, left-trimmed. */
  prefix: string
  /** Where `prefix` begins in the value, which is what an accepted row replaces. */
  prefixStart: number
}

/**
 * What the caret is inside.
 *
 * The delimiters are read off the text here, and `templateSpans` refuses to do
 * that — the two are asking different questions and the difference is the whole
 * justification. **Highlighting is about meaning**: a `{{ '{{' }}` painted as
 * two holes would be the highlighter disagreeing with the parser about what the
 * text says, which is the scanner ADR-0008 keeps out of both languages. **This
 * is about position**: where a popup goes, and which characters an accepted row
 * replaces. Nothing it returns decides what anything means, and every value it
 * produces is handed straight back to the parser a keystroke later.
 *
 * It also has to answer while the text does *not* parse, which is the ordinary
 * state of a Template halfway through being typed — `{{ s2.` is exactly when
 * the completion list is wanted, and it is exactly when no parser will say
 * anything useful about it.
 *
 * `prefix` is deliberately the text since the `{{`, not the token under the
 * caret: a completion offers what the whole path so far can reach, and
 * `s2.messages[].su` is one prefix rather than four.
 */
export function caretContext(value: string, caret: number): CaretContext {
  const outside: CaretContext = { hole: null, prefix: '', prefixStart: caret }
  if (caret === 0) return outside

  const open = value.lastIndexOf('{{', caret - 1)
  // `open + 2 > caret` means the caret is between the two braces, so the `{{`
  // is not complete before it and there is no hole yet. Left as "inside", the
  // prefix started one character AFTER the caret, and accepting a row spliced a
  // reversed range: `a{{b}}` with the caret at 2 became `a{{steps.s2{b}}`.
  if (open === -1 || open + 2 > caret) return outside

  // A `}}` between that `{{` and the caret means the hole closed before the
  // caret got here, and the caret is in the text after it.
  const close = value.indexOf('}}', open + 2)
  if (close !== -1 && close + 2 <= caret) return outside

  const hole = { start: open, end: close === -1 ? value.length : close + 2 }
  const written = value.slice(open + 2, caret)
  const from = tokenStart(written)
  return { hole, prefix: written.slice(from), prefixStart: open + 2 + from }
}

/**
 * Where the thing being completed begins, inside the hole.
 *
 * Not the `{{`. An Expression is a whole language, and a path is only ever the
 * innermost part of one: `dt.diff(dt.` is a call whose first argument is
 * halfway through being named, and measuring the prefix from the `{{` asks for
 * the members of something called `dt.diff(dt`, which is nothing.
 *
 * So the prefix runs back to the last character that cannot continue a path or
 * a call chain. `.`, `[` and `]` continue one — `s2.messages[].su` is a single
 * prefix rather than four — while a paren, a comma, whitespace and every
 * operator end it.
 */
function tokenStart(written: string): number {
  for (let i = written.length - 1; i >= 0; i--) {
    if (!/[A-Za-z0-9_.[\]]/.test(written[i] as string)) return i + 1
  }
  return 0
}

/**
 * The type an insertion at this position has to produce — the open question the
 * left rail closes.
 *
 * The marking judges a row against the type the *hole* must produce, and that
 * depends on the hole rather than on the field. Two cases and one rule:
 *
 * - **A hole that is the whole value** resolves to the field's own value, and
 *   `resolve()` keeps the expression's type intact — the number 24, not the
 *   string "24". So the field's declared type is what it has to produce.
 * - **A hole inside mixed text** is concatenated into a sentence. ADR-0009
 *   keeps interpolation soft precisely because that is what mixed text *means*,
 *   and `checkTemplate` already reflects it: for a template with more than one
 *   segment it infers each hole and then judges *the template* as `text`,
 *   saying nothing at all about what any individual hole produces. Marking such
 *   a hole against the field's declared type would paint rows red-in-effect
 *   that the checker is perfectly happy with — a `number` field holding
 *   `Order {{ steps.s2.ref }}` is a text template either way, and whether `steps.s2.ref` is
 *   text or a number changes nothing about it.
 *
 * So a hole in mixed text is judged against `text`, which `match()` already
 * spells out as *any scalar fits*. That is not a loosening to nothing: a list
 * or an object interpolated into a sentence stays unmarked, which is ADR-0009's
 * own line — softness "does not extend to non-scalars", and `json.stringify()`
 * is what says so explicitly when it was meant.
 *
 * One rule covers both: **`--hatua-status-ok` means this row fits *here*.** Nothing
 * is ever marked wrong either way, so a judgement that is merely stricter than
 * necessary is not a harmless conservatism — it is a green rail withheld from
 * a row that is exactly right, which is the only signal the rail carries.
 *
 * Undefined when the field declares no type at all — a workflow variable, whose
 * type is read *from* its value, so there is nothing to check it against.
 *
 * `[start, end)` is the range the insertion covers: the hole being edited, or
 * the caret. Whether what results is a whole-value Template is then one
 * question — is there anything outside that range? — asked of the value that
 * is about to exist. Whitespace counts as text, exactly as it does in
 * `checkTemplate`: `  {{ x }}` is mixed text to the evaluator, so it is mixed
 * text here.
 */
export function expectedAt(
  value: string,
  start: number,
  end: number,
  declared: ValueType | undefined,
): ValueType | undefined {
  if (declared === undefined) return undefined
  const whole = value.slice(0, start) === '' && value.slice(end) === ''
  return whole ? declared : 'text'
}

/**
 * Whether a row producing `actual` fits where it is going.
 *
 * Two outcomes and not three. **Nothing is ever marked wrong**: neutral covers
 * "does not fit" and "cannot be judged" alike, which is what keeps `unknown`
 * from being painted as a mistake — and ADR-0009's line about errors blocking Publish
 * and never editing applies to a picker just as much. It guides; it does not
 * refuse.
 *
 * Exact match only, because ADR-0009 forbids coercion outright — `1 == '1'` is
 * false — so there is no assignability lattice to consult beyond the one
 * `match()` already is.
 */
export const fits = (actual: ValueType | undefined, expected: ValueType | undefined): boolean =>
  actual !== undefined && expected !== undefined && match(actual, expected) === 'matches'

export interface Edit {
  value: string
  /** Where the caret lands, which is never simply the end of what was written. */
  caret: number
}

/**
 * Write `text` over `[start, end)`.
 *
 * `caretOffset` is measured from the start of what was written, so a function
 * lands the caret between its parens rather than after them.
 */
export const spliceAt = (
  value: string,
  start: number,
  end: number,
  text: string,
  caretOffset = text.length,
): Edit => ({
  value: value.slice(0, start) + text + value.slice(end),
  caret: start + caretOffset,
})

/**
 * Drop a path into the value, as a Template hole.
 *
 * Spaced on **both** sides when the neighbouring character is not already
 * whitespace. A leading-space rule alone welds the token to the following word:
 * dropping into `Hi there` at the caret after `Hi` gives `Hi {{ x }}there`.
 *
 * `replace` is what a `ref` field passes — for-each's list, Filter's list —
 * because such a field holds exactly one Reference and appending a second is
 * not a value it can ever hold.
 */
export function dropReference(
  value: string,
  start: number,
  end: number,
  path: string,
  { replace = false }: { replace?: boolean } = {},
): Edit {
  const token = `{{ ${path} }}`
  if (replace) return spliceAt(value, 0, value.length, token)

  const before = value.slice(0, start)
  const after = value.slice(end)
  const lead = before !== '' && !/\s$/.test(before) ? ' ' : ''
  const trail = after !== '' && !/^\s/.test(after) ? ' ' : ''

  return spliceAt(value, start, end, `${lead}${token}${trail}`, lead.length + token.length)
}

/**
 * Write a candidate into the value at the caret.
 *
 * Outside a hole the token has to bring its own `{{ }}`; inside one it must
 * not, and it replaces the prefix typed so far rather than appending to it —
 * accepting `s2.count` after `s2.co` has to leave `s2.count` and not
 * `s2.cos2.count`.
 */
export function insertCandidate(
  value: string,
  context: CaretContext,
  caret: number,
  insert: string,
): Edit {
  if (context.hole) {
    // The caret sits where the text ended, so an accepted row that ends in `(`
    // or `.` leaves it exactly where the next thing is typed.
    return spliceAt(value, context.prefixStart, caret, insert)
  }

  const wrapped = `{{ ${insert} }}`
  // Between the braces, not after them: a namespace or an open paren is the
  // start of an expression, and dumping the caret past `}}` abandons it.
  const inner = insert.endsWith('.') || insert.endsWith('(') ? 3 + insert.length : wrapped.length
  return spliceAt(value, caret, caret, wrapped, inner)
}

/**
 * Where the caret goes when a chip is clicked: the end of the expression the
 * chip stands for, just inside the closing braces.
 *
 * A chip is narrower than the characters it replaces, so the offset the browser
 * would derive from the pointer is somewhere arbitrary inside the path — the
 * one place a click has an obviously right answer and would get a nearly random
 * one. The end of the expression is where an edit starts: backspace shortens
 * the path, and a dot extends it.
 */
export function expressionEnd(value: string, hole: HoleSpan): number {
  // Just inside the `}}`, then back over the whitespace the writer put there.
  let at = Math.max(hole.start + 2, hole.end - 2)
  while (at > hole.start + 2 && /\s/.test(value[at - 1] as string)) at--
  return at
}

/**
 * Put a chosen Reference or call in place of a whole hole.
 *
 * What a double-click asks for: the hole is the target, not the caret, and the
 * choice **replaces** it rather than landing inside it. That is the one gesture
 * that retargets an existing Reference in one go — which is what CONTEXT.md
 * means by a Reference being a thing the builder can draw as a pill the user
 * retargets.
 *
 * The caret lands at the end of the new expression, where an edit starts.
 *
 * The span must be one `templateShape` found. `caretContext` is not a source of
 * one: it reports `end` as the next `}}` ANYWHERE, so an unterminated `{{`
 * borrows the closer of a later hole — and splicing that range away takes the
 * later hole and everything between with it.
 */
export function replaceHole(value: string, hole: HoleSpan, insert: string): Edit {
  const written = `{{ ${insert} }}`
  return spliceAt(value, hole.start, hole.end, written, written.length - 3)
}
