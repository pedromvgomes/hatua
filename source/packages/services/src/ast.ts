import type { WorkflowDocument } from '@hatua/document'

/**
 * Reaching into the document's AST, in the terms a command needs.
 *
 * Nothing here imports `yaml`. Every new node is minted through
 * `document.ast.createNode`, which @hatua/document already owns: a second copy
 * of the library in this package's dependencies is a second copy in a Host's
 * bundle, and nodes built by one copy fail the other's `instanceof` checks,
 * which is a failure with no error message on it.
 *
 * Nodes are recognised by the tag `yaml` stamps on each one — a REGISTERED
 * symbol, `Symbol.for('yaml.node.type')`, holding `Symbol.for('yaml.seq')` or
 * `Symbol.for('yaml.map')`. The global registry is what makes that readable
 * from here: the same call in two modules yields the same symbol, so this
 * matches whichever copy of the library parsed the document.
 *
 * Shape alone cannot do it. A YAMLMap's `items` is a `Pair[]`, so "a sequence
 * is whatever carries an `items` array" calls `steps:` written as a mapping a
 * list — and `insertNode` then splices a bare node into a mapping's pair list,
 * which throws `Map items must all be pairs` the next time the document is
 * serialised, out of a `toString()` no caller expects to fail. An empty `[]`
 * and an empty `{}` are indistinguishable by shape altogether. A half-written
 * `steps:` is a state ADR-0001 requires this file to survive, so it has to be
 * told apart rather than guessed at.
 */

const NODE_TYPE = Symbol.for('yaml.node.type')
const SEQ = Symbol.for('yaml.seq')
const MAP = Symbol.for('yaml.map')

const tagOf = (value: unknown): symbol | undefined =>
  value && typeof value === 'object'
    ? ((value as Record<symbol, unknown>)[NODE_TYPE] as symbol | undefined)
    : undefined

export type Path = (string | number)[]

/**
 * The document as plain JS, whether or not it is a valid Workflow Definition.
 *
 * `toJSON()` is not usable here and must not become so: it throws while the
 * source is mid-edit, which is a legitimate state (ADR-0001), and a command
 * that only worked on documents that already validate would be unusable in
 * exactly the situation the user is trying to edit their way out of. The AST's
 * own projection has no opinion about the schema.
 */
export const asObject = (document: WorkflowDocument): Record<string, unknown> => {
  const value = document.ast.toJS()
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

interface Seq {
  items: unknown[]
  flow?: boolean
  commentBefore?: string
}

export const asSeq = (value: unknown): Seq | undefined =>
  tagOf(value) === SEQ && Array.isArray((value as Seq).items) ? (value as Seq) : undefined

/**
 * A comment above the FIRST item of a block sequence is anchored to the
 * sequence, not to the item — every other item carries its own `commentBefore`.
 *
 * Left alone, that makes the comment describe a position rather than a thing:
 * remove the first entry and its comment stays behind to label whatever moves
 * up; move it and the comment does not go with it. The user wrote "# retry the
 * flaky one" above a Step, and it ends up above a different one, in a file that
 * lives in their repository.
 *
 * So it is lifted onto the item before any splice and lowered back onto the
 * sequence afterwards. Between those two calls every comment belongs to a node,
 * which is the model the rest of this file assumes.
 */
const liftLeadingComment = (seq: Seq) => {
  // Block sequences only. A flow list keeps its comment at the list level
  // whatever happens to its items, so moving one onto an item there would
  // change what the comment is about — and re-anchoring it forces the list to
  // break across lines, rewriting formatting Hatua does not own (ADR-0001).
  if (seq.flow) return
  const first = seq.items[0] as { commentBefore?: string } | undefined
  if (!first || seq.commentBefore === undefined) return
  first.commentBefore =
    first.commentBefore === undefined
      ? seq.commentBefore
      : `${seq.commentBefore}\n${first.commentBefore}`
  seq.commentBefore = undefined
}

const lowerLeadingComment = (seq: Seq) => {
  if (seq.flow) return
  const first = seq.items[0] as { commentBefore?: string } | undefined
  if (!first || first.commentBefore === undefined) return
  seq.commentBefore = first.commentBefore
  first.commentBefore = undefined
}

/**
 * Splice a node into the sequence at `listPath`, creating the sequence when the
 * document has none — an empty Branch has no `steps:` key at all until the
 * first Step lands in it.
 *
 * ABSENT is the only thing that gets created. A key holding a mapping or a
 * scalar is a half-written list, not a missing one, and replacing it with
 * `[node]` would delete whatever the user had typed there — which is the
 * opposite of what a command may do to a file it does not own (ADR-0001).
 */
export function insertNode(
  document: WorkflowDocument,
  listPath: Path,
  index: number,
  node: unknown,
) {
  const existing = document.ast.getIn(listPath, true)
  const seq = asSeq(existing)

  if (!seq) {
    if (existing !== undefined) throw new Error(`${listPath.join('.')} is not a list`)
    document.ast.setIn(listPath, [node])
    return
  }

  // `steps: []` is flow style, and splicing into it keeps flow style — so the
  // first Step added to an empty Branch re-serialises the whole subtree onto
  // one line as `[ { id: s3, use: email.send } ]`, beside siblings written in
  // block. Only an EMPTY sequence is converted: a list the user wrote in flow
  // style with items in it is a formatting choice, and Hatua does not own the
  // file's formatting (ADR-0001).
  if (seq.items.length === 0) seq.flow = false

  liftLeadingComment(seq)
  seq.items.splice(Math.max(0, Math.min(index, seq.items.length)), 0, node)
  lowerLeadingComment(seq)
}

/** Remove the node at `listPath[index]` and hand it back, formatting intact. */
export function detachNode(document: WorkflowDocument, listPath: Path, index: number): unknown {
  const seq = asSeq(document.ast.getIn(listPath, true))
  if (!seq) throw new Error(`No sequence at ${listPath.join('.')}`)
  if (index < 0 || index >= seq.items.length) {
    throw new Error(`No entry at ${listPath.join('.')}.${index}`)
  }

  liftLeadingComment(seq)
  const [node] = seq.items.splice(index, 1)
  lowerLeadingComment(seq)
  return node
}

/** A scalar node, told apart from a collection by the same tag `asSeq` reads. */
const asScalar = (value: unknown): { value: unknown } | undefined => {
  const tag = tagOf(value)
  return tag !== SEQ && tag !== MAP && value && typeof value === 'object' && 'value' in value
    ? (value as { value: unknown })
    : undefined
}

/**
 * Write a scalar, keeping the style the user wrote it in.
 *
 * `setIn` replaces the whole node, so renaming a workflow written as
 * `name: "Morning inbox triage"` returns it as `name: Morning inbox triage` —
 * Hatua rewriting quoting it does not own (ADR-0001). Assigning to the existing
 * scalar's `value` leaves its style alone, and only a key the document does not
 * have yet is built from scratch.
 */
export function setScalar(
  document: WorkflowDocument,
  path: Path,
  value: string | number | boolean,
) {
  const node = asScalar(document.ast.getIn(path, true))
  if (node) node.value = value
  else document.ast.setIn(path, value)
}

/**
 * The key order `workflow-definition.schema.yaml` documents.
 *
 * A key the document does not have yet is created among the keys it does rather
 * than appended after `steps:`. A Workflow Definition lives in the Host's
 * repository and a person reads the diff, which is the same reason `addStep`
 * writes a Step's keys one at a time instead of spreading an object literal.
 */
const KEY_ORDER = ['id', 'name', 'version', 'status', 'connections', 'triggers', 'vars', 'steps']

interface Pair {
  key?: { value?: unknown }
}

/**
 * The top-level mapping's pairs, or undefined when the document is not a
 * mapping.
 *
 * Tagged, not shaped, for the reason `asSeq` gives: a top-level SEQUENCE also
 * carries an `items` array, and reading it as pairs would splice a `Pair` into
 * a sequence — the same corruption as the other way round, and it surfaces the
 * same way, from a `toString()` no caller guards. `- just\n- a list` parses, so
 * it opens, so a command can be run against it.
 */
const topLevelPairs = (document: WorkflowDocument): Pair[] | undefined => {
  const contents = document.ast.contents
  if (tagOf(contents) !== MAP) return undefined
  const items = (contents as { items?: unknown }).items
  return Array.isArray(items) ? (items as Pair[]) : undefined
}

/** One `key: value` pair, built by the document rather than by a `yaml` import. */
const newPair = (document: WorkflowDocument, key: string, value: unknown): Pair => {
  const map = document.ast.createNode({ [key]: value }) as { items?: unknown[] }
  const [pair] = map.items ?? []
  if (!pair) throw new Error(`Could not create the "${key}" key`)
  return pair as Pair
}

/**
 * The path of a top-level list, creating an empty one in its schema position
 * when the document has no such key.
 *
 * A key that exists and holds something other than a list throws rather than
 * being replaced — a mapping and a scalar alike. `triggers: tomorrow` and
 * `triggers:` written as a mapping are half-typed documents, not absent ones,
 * and overwriting either would discard text the user is in the middle of.
 */
export function topLevelList(document: WorkflowDocument, key: string): Path {
  const existing = document.ast.getIn([key], true)
  if (asSeq(existing)) return [key]
  if (existing !== undefined) throw new Error(`"${key}" is not a list`)

  const pairs = topLevelPairs(document)
  // A Workflow Definition is a mapping, and a document that is not one has
  // nowhere to put a top-level key: `setIn(['vars'], …)` against a sequence
  // asks it to index by a string and throws with a message about indices. The
  // command aborts either way; saying which document it refused is what makes
  // the difference readable.
  if (!pairs) throw new Error(`Cannot add "${key}" to a document that is not a mapping`)

  const rank = KEY_ORDER.indexOf(key)
  // An unrecognised key ranks -1 and therefore sorts before everything, so a
  // new key lands after whatever the Host or the user added of their own.
  const before = pairs.findIndex((pair) => {
    const name = pair.key?.value
    return typeof name === 'string' && KEY_ORDER.indexOf(name) > rank
  })

  pairs.splice(before === -1 ? pairs.length : before, 0, newPair(document, key, []))
  return [key]
}

/**
 * The entries of a top-level list, as plain JS objects, with the index each one
 * occupies in the document.
 *
 * Non-object entries are SKIPPED, never compacted away, for the reason `walk`
 * gives in steps.ts: the index yielded here is used verbatim against the AST
 * sequence, so filtering the list first would renumber everything after a hole
 * and remove the wrong entry.
 */
export function* entriesOf(
  document: WorkflowDocument,
  key: string,
): Generator<{ entry: Record<string, unknown>; index: number }> {
  const list = asObject(document)[key]
  const items = Array.isArray(list) ? list : []
  for (let index = 0; index < items.length; index++) {
    const entry = items[index]
    if (entry && typeof entry === 'object') yield { entry: entry as Record<string, unknown>, index }
  }
}
