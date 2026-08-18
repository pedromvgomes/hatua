/**
 * The generated parser, wrapped.
 *
 * The grammar covers the whole Template, not just the expression: scannerless
 * PEG treats the `{{` / `}}` boundary as an ordinary rule, so segmentation is
 * generated in both languages rather than being a hand-written scanner on each
 * side — which would be a divergence surface sitting in front of the parser.
 *
 * There is no escape rule either. `{{ '{{' }}` is not special-cased anywhere:
 * it is a hole containing a text literal, and it falls out of the grammar.
 */
import { parse as generated } from '#generated/parser.js'
import type { Expression, TemplateNode } from './ast.js'
import { type Diagnostic, diagnostic, ExpressionError } from './errors.js'

interface PeggySyntaxError extends Error {
  location?: { start: { offset: number } }
}

const offsetOf = (error: unknown): number =>
  (error as PeggySyntaxError)?.location?.start?.offset ?? 0

/** Parse a whole Template. Throws `ExpressionError` carrying EXPR_PARSE_ERROR. */
export function parseTemplate(source: string): TemplateNode {
  try {
    return generated(source, { startRule: 'Template' }) as TemplateNode
  } catch (error) {
    throw new ExpressionError([
      diagnostic('EXPR_PARSE_ERROR', offsetOf(error), { detail: messageOf(error) }),
    ])
  }
}

/**
 * Parse one Expression, with no surrounding `{{ }}`.
 *
 * Only the conformance corpus and tooling need this; a field value is always a
 * whole Template. It exists because precedence and associativity bugs are
 * *parse* bugs, and they are invisible to evaluation scenarios whenever two
 * parsers build different trees that happen to evaluate alike on the sample
 * data — the most dangerous divergence there is, because it passes everything
 * until one workflow hits the disagreeing case.
 */
export function parseExpression(source: string): Expression {
  try {
    return generated(source, { startRule: 'Expr' }) as Expression
  } catch (error) {
    throw new ExpressionError([
      diagnostic('EXPR_PARSE_ERROR', offsetOf(error), { detail: messageOf(error) }),
    ])
  }
}

/** Parse, returning the diagnostic instead of throwing. */
export function tryParseTemplate(
  source: string,
): { ok: true; template: TemplateNode } | { ok: false; diagnostics: readonly Diagnostic[] } {
  try {
    return { ok: true, template: parseTemplate(source) }
  } catch (error) {
    if (error instanceof ExpressionError) return { ok: false, diagnostics: error.diagnostics }
    throw error
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
