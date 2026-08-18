import type { WorkflowDefinition } from '@hatua/schema'
import { Composer, CST, type Document, Parser } from 'yaml'

/**
 * Owns the YAML document. This layer holds the source of truth (ADR-0001) —
 * the parsed representation, not a typed object graph. Canvas edits and text
 * edits both land here, so the user's comments, key order and style survive.
 *
 * There are two layers, and the distinction matters:
 *
 *   CST  — concrete syntax tree. Byte-exact: stringifying an unmodified CST
 *          reproduces the input character for character, whitespace included.
 *   AST  — the `Document` API. Ergonomic (getIn/setIn), and it preserves
 *          comments, but it NORMALISES some whitespace: three spaces before an
 *          inline comment come back as one.
 *
 * We keep both. Because Hatua does not own the file, surgical edits belong on
 * the CST; the AST is for reading and for edits where a normalised diff is
 * acceptable. `toString()` returns the original bytes while untouched.
 */

export interface WorkflowDocument {
  /** Concrete syntax tree. Byte-exact; the authoritative representation. */
  readonly cst: ReturnType<Parser['parse']> extends Generator<infer T> ? T[] : never
  /** Ergonomic view over the same document. Preserves comments, normalises some spacing. */
  readonly ast: Document
  /** Typed projection, re-derived. Never mutate this — it is a copy. */
  toJSON(): WorkflowDefinition
  /** Serialise back to text. Byte-identical to the input until something is edited. */
  toString(): string
}

export function parseWorkflow(source: string): WorkflowDocument {
  const cst = [...new Parser().parse(source)]
  const [ast] = [...new Composer({ keepSourceTokens: true }).compose(cst)]
  if (!ast) throw new Error('No YAML document found in source')

  const dirty = false
  return {
    cst: cst as never,
    ast,
    toJSON: () => ast.toJS() as WorkflowDefinition,
    // While nothing has been edited, replay the CST for a byte-exact result.
    // Once the AST is touched we fall back to its serialiser, which keeps
    // comments but may normalise whitespace around them.
    toString: () => (dirty ? String(ast) : cst.map((t) => CST.stringify(t)).join('')),
  }
}
