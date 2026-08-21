import { type WorkflowDefinition, workflowDefinition } from '@hatua/schema'
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
 * We keep both. Because Hatua does not own the file, an untouched document must
 * come back byte-identical; once edited, the AST's serialisation is the best
 * available and still keeps every comment.
 */

export interface WorkflowDocument {
  /** Ergonomic view. Mutating it is how you edit the document. */
  readonly ast: Document
  /**
   * Typed projection. Throws if the document is not a valid Workflow
   * Definition — use `validate()` first when the source may be malformed, and
   * `toString()`/`ast` to drive Text Mode over a document that does not parse
   * into a workflow yet.
   */
  toJSON(): WorkflowDefinition
  /** Non-throwing counterpart to `toJSON()`. */
  validate(): ReturnType<typeof workflowDefinition.safeParse>
  /** Byte-identical to the input while untouched; comment-preserving once edited. */
  toString(): string
}

export function parseWorkflow(source: string): WorkflowDocument {
  const cst = [...new Parser().parse(source)]
  const documents = [...new Composer({ keepSourceTokens: true }).compose(cst)]
  const [ast] = documents
  if (!ast) throw new Error('No YAML document found in source')

  // Rejected rather than carried. YAML lets one file hold several documents
  // separated by `---`. Composing the first while stringifying the whole CST as
  // `original` would make an untouched multi-document file round-trip whole and
  // then lose everything after document one at the first edit — invisible right
  // up until something edits a document.
  //
  // The alternative is to keep every document and re-serialise them all. We do
  // not, because there is nothing for the extra documents to BE. A Workflow
  // Definition is a mapping with `id`, `name`, `version`, `status` and `steps`
  // (schemas/workflow-definition.schema.yaml); a second document in the same
  // file is not a second workflow Hatua could show, edit or publish — the Host
  // addresses one workflow by id and one version by number, and `saveDraft`
  // takes one blob of YAML. Carrying bytes we can neither interpret nor render
  // is how the divergence ADR-0001 exists to prevent gets in through the back
  // door: the user would edit a file whose other half Hatua never showed them.
  //
  // So the seam says no, once, at parse — where the caller still has the text
  // and can put it in Text Mode.
  if (documents.length > 1) {
    throw new Error(
      `A Workflow Definition is a single YAML document; this source holds ${documents.length}. ` +
        'Split the file, or edit it as text outside Hatua.',
    )
  }

  // Serialisation of the untouched AST. Comparing against it detects edits
  // however they were made — no dirty flag for a caller to forget to set, which
  // would make toString() silently discard them.
  const pristine = String(ast)
  const original = cst.map((t) => CST.stringify(t)).join('')

  const serialise = () => {
    const current = String(ast)
    return current === pristine ? original : current
  }

  return {
    ast,
    toString: serialise,
    validate: () => workflowDefinition.safeParse(ast.toJS()),
    toJSON: () => {
      const result = workflowDefinition.safeParse(ast.toJS())
      if (!result.success) {
        throw new Error(`Not a valid Workflow Definition: ${result.error.issues[0]?.message}`)
      }
      return result.data
    },
  }
}
