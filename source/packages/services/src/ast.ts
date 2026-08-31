import type { WorkflowDocument } from '@hatua/document'
import { own } from '@hatua/model'

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
  // one line as `[ { id: s3, use: component.email.send } ]`, beside siblings
  // written in block. Only an EMPTY sequence is converted: a list the user wrote in flow
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
 * The loose projection at `path`, whether or not the document validates.
 *
 * Own properties only, through the same `own` every other document-supplied key
 * goes through. Every caller builds its path from literals and list indices
 * today, so `__proto__` cannot reach here — but a reader that walks a
 * user-editable document by dynamic key has to be safe on its own terms rather
 * than by every caller's discipline.
 */
export function readAt(document: WorkflowDocument, path: Path): unknown {
  let value: unknown = asObject(document)
  for (const part of path) {
    if (value === null || typeof value !== 'object') return undefined
    value = own(value as Record<string, unknown>, String(part))
  }
  return value
}

/**
 * The key order a Block documents, which is the workflow's own argument one
 * level down: a person reads the diff, so a key the file does not have yet is
 * created among the keys it does rather than appended after `steps:`.
 */
export const BLOCK_KEY_ORDER = ['id', 'name', 'params', 'outputs', 'vars', 'steps']

/** The same, for a Trigger: `addTrigger` writes `name:` only when it is given. */
export const TRIGGER_KEY_ORDER = ['id', 'use', 'name', 'with']

/**
 * The same, for a Step. The structural keys come last because they hold the
 * rest of the tree: a `with:` created after `branches:` puts one line of
 * configuration below the fifty lines of Steps it configures.
 */
export const STEP_KEY_ORDER = ['id', 'use', 'name', 'with', 'branches', 'steps', 'handler']

/**
 * The key order `workflow-definition.schema.yaml` documents.
 *
 * A key the document does not have yet is created among the keys it does rather
 * than appended after `steps:`. A Workflow Definition lives in the Host's
 * repository and a person reads the diff, which is the same reason `addStep`
 * writes a Step's keys one at a time instead of spreading an object literal.
 */
export const KEY_ORDER = [
  'id',
  'name',
  'version',
  'status',
  'connections',
  'triggers',
  'vars',
  'blocks',
  'steps',
]

interface Pair {
  key?: unknown
}

/**
 * A pair's key, however the pair was built.
 *
 * `yaml`'s own `setIn` creates an intermediate mapping whose key is a plain
 * **string** rather than a `Scalar`, while a pair this file builds through
 * `newPair` carries a `Scalar`. Reading only `key.value` therefore sees
 * `undefined` for every key some other command created that way — so the key
 * ranks as unrecognised and the next key placed lands after it instead of where
 * the schema documents. Both spellings are the same key and this reads both.
 */
const keyOf = (pair: Pair): string | undefined => {
  const key = pair.key
  if (typeof key === 'string') return key
  const held = (key as { value?: unknown } | undefined)?.value
  return typeof held === 'string' ? held : undefined
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
/** The pairs of the mapping at `path`, or of the document when the path is empty. */
const pairsAt = (document: WorkflowDocument, path: Path): Pair[] | undefined => {
  const node = path.length === 0 ? document.ast.contents : document.ast.getIn(path, true)
  if (tagOf(node) !== MAP) return undefined
  const items = (node as { items?: unknown }).items
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
export const topLevelList = (document: WorkflowDocument, key: string): Path =>
  listIn(document, [], key, KEY_ORDER)

/**
 * The path of a list inside the mapping at `parent`, creating an empty one in
 * its documented position when the mapping has no such key.
 *
 * The same function serves a top-level `vars:` and a Block's own `vars:`,
 * because they differ only in which mapping holds them and which key order that
 * mapping documents. Two functions would be two answers about where a created
 * key lands, and a Block written by the canvas would diff differently from one
 * written by hand.
 */
export function listIn(
  document: WorkflowDocument,
  parent: Path,
  key: string,
  order: readonly string[],
): Path {
  const path = [...parent, key]
  const existing = document.ast.getIn(path, true)
  if (asSeq(existing)) return path
  if (existing !== undefined) throw new Error(`"${key}" is not a list`)

  createKey(document, parent, key, order, [])
  return path
}

/**
 * The path of a mapping inside the mapping at `parent`, creating an empty one
 * in its documented position when the mapping has no such key.
 *
 * `listIn` for a `with:` rather than a `steps:`. A Step added from the
 * catalogue carries no `with:` at all — nothing has been filled in yet — so the
 * first field edited on it is the one that creates the key, and it lands under
 * `use:` rather than below the fifty lines of Steps a container holds.
 *
 * A key holding something other than a mapping throws rather than being
 * replaced, on `listIn`'s reasoning: `with: tomorrow` is a half-typed document
 * and not an absent one, and overwriting it discards text the user is in the
 * middle of.
 */
export function mapIn(
  document: WorkflowDocument,
  parent: Path,
  key: string,
  order: readonly string[],
): Path {
  const path = [...parent, key]
  const existing = document.ast.getIn(path, true)
  if (tagOf(existing) === MAP) return path

  /*
   * `with:` with nothing under it is an EMPTY mapping, not a half-typed one.
   *
   * YAML resolves a dangling key to a null scalar rather than to an absent one,
   * and it is what a user is left with after deleting the last field by hand.
   * Refused, every subsequent edit to that Step is a command that throws — which
   * `EditingStore.apply` turns into a silent no-op, so the form appears to drop
   * every value the user types with nothing anywhere saying why.
   *
   * Written over rather than created beside, so the key keeps its place and the
   * comment above it.
   */
  if (asScalar(existing)?.value === null) {
    // Through `createNode`, so what lands is the document's own mapping node.
    // A plain `{}` is set as a JS value the pair holds opaquely, and the next
    // command to look for pairs under it finds none.
    document.ast.setIn(path, document.ast.createNode({}))
    return path
  }

  if (existing !== undefined) throw new Error(`"${key}" is not a mapping`)

  createKey(document, parent, key, order, {})
  return path
}

/**
 * Write a scalar under `key`, creating the key **in its documented place** when
 * the mapping does not have it yet.
 *
 * `setScalar` alone appends. That is right for a key the document already has —
 * it rewrites the node in place and nothing moves — and wrong for one it does
 * not, because `setIn` puts a new pair at the end: naming a Block that was
 * declared without a name writes `name:` below its `steps:`, which on a Board
 * with fifty Steps is fifty lines from the `id` it belongs to. A Workflow
 * Definition lives in the Host's repository and a person reads the diff, which
 * is the same argument `listIn` and `KEY_ORDER` already make.
 *
 * **A key already holding a collection is refused**, the way `listIn` refuses
 * one holding anything but a list. Falling through to `createKey` there splices
 * a SECOND pair under the same key, and a duplicate key is the one corruption
 * nothing downstream catches: `yaml` resolves it last-wins so the document still
 * projects and `validate()` still succeeds, ADR-0019's backstop sees a document
 * that projects, the text autosaves — and the next `parseWorkflow` of it throws
 * `Document with errors cannot be stringified`, out of a `toString()` no caller
 * expects to fail. The user is left with a file they cannot open, from an edit
 * that looked ordinary. Refusing is a no-op with nothing on the undo stack,
 * which is what every command here does when it cannot address what it was
 * given.
 */
export function setScalarIn(
  document: WorkflowDocument,
  parent: Path,
  key: string,
  order: readonly string[],
  value: string | number | boolean,
) {
  const existing = document.ast.getIn([...parent, key], true)
  const node = asScalar(existing)
  if (node) {
    node.value = value
    return
  }
  if (existing !== undefined) throw new Error(`"${key}" is not a scalar`)

  createKey(document, parent, key, order, value)
}

/**
 * Every Step in a list, nested ones included, with the AST path of the list each
 * sits in.
 *
 * Over the AST's own projection rather than the model's typed tree, because a
 * command runs against a document that does not project (ADR-0001) — so
 * `walkDocument` and every traversal beside it is unavailable to one. The path
 * is what this adds over reading `asObject`: a caller editing *inside* a Step
 * needs to say where it is, not only what it holds.
 */
export function* stepEntriesIn(
  steps: unknown,
  base: Path,
): Generator<{ step: Record<string, unknown>; listPath: Path; index: number }> {
  const list = Array.isArray(steps) ? steps : []
  for (let index = 0; index < list.length; index++) {
    const entry = list[index]
    if (!entry || typeof entry !== 'object') continue
    const step = entry as Record<string, unknown>
    yield { step, listPath: base, index }

    const branches = Array.isArray(step.branches) ? step.branches : []
    for (let b = 0; b < branches.length; b++) {
      const branch = branches[b]
      if (branch && typeof branch === 'object') {
        yield* stepEntriesIn((branch as Record<string, unknown>).steps, [
          ...base,
          index,
          'branches',
          b,
          'steps',
        ])
      }
    }
    if (step.steps) yield* stepEntriesIn(step.steps, [...base, index, 'steps'])
    if (step.handler) yield* stepEntriesIn(step.handler, [...base, index, 'handler'])
  }
}

/**
 * Everywhere on one Board that a Template can sit.
 *
 * A **Board** is the unit scope is computed against (CONTEXT.md), so it is also
 * the unit a Board-local name is rewritten across: `{{ var.x }}` on the root and
 * `{{ var.x }}` inside a Block are different variables, and a rewrite that
 * walked the whole document would repair one by corrupting the other.
 *
 * The root Board is its Triggers, its variables and its Steps — three roots
 * rather than the document, because `blocks:` sits between them and belongs to
 * nobody's Board but its own. A Block's is its whole entry: its `params:` and
 * `outputs:` hold no Templates, so including them costs a parse that changes
 * nothing and saves a list that needs extending whenever a Block gains a key.
 *
 * A Board that is not there has nowhere for a Template to sit, and says so with
 * an empty list rather than by throwing: the rewrite half of a rename must not
 * turn a missing Block into a failed edit when the declaration half already
 * refused for the same reason.
 */
export function boardTemplateRoots(document: WorkflowDocument, board: string | null): Path[] {
  if (board === null) return [['triggers'], ['vars'], ['steps']]
  const blocks = asObject(document).blocks
  const list = Array.isArray(blocks) ? blocks : []
  const index = list.findIndex(
    (entry) =>
      entry && typeof entry === 'object' && (entry as Record<string, unknown>).id === board,
  )
  return index === -1 ? [] : [['blocks', index]]
}

/**
 * Rewrite every Template under `root`, through one substitution.
 *
 * The half of a rename that `@hatua/expressions` cannot do: it knows what a path
 * is and nothing about where Templates live, and this knows where they live and
 * nothing about the grammar (ADR-0021).
 *
 * **Every string scalar, rather than the Slots the manifests declare.** A
 * command runs against a document that does not project (ADR-0001), so
 * `slotsFor` and every other model answer to "which fields hold Templates" is
 * unavailable here — and a `when:`, an `until:` and a `core.map` entry are
 * Templates that sit outside `with:` anyway. `renamePath` returns anything
 * without a matching hole unchanged, so visiting a scalar that is not a Template
 * costs a parse and changes nothing.
 *
 * Keys are not visited. A mapping key is a name in its own right — a field's, a
 * variable's — and never a Template; `renameKeyIn` is what edits one.
 */
export function rewriteTemplates(
  document: WorkflowDocument,
  root: Path,
  rewrite: (source: string) => string,
) {
  const visit = (node: unknown) => {
    const seq = asSeq(node)
    if (seq) {
      for (const item of seq.items) visit(item)
      return
    }
    if (tagOf(node) === MAP) {
      for (const pair of (node as { items?: unknown[] }).items ?? []) {
        visit((pair as { value?: unknown }).value)
      }
      return
    }
    const scalar = asScalar(node)
    if (!scalar || typeof scalar.value !== 'string') return
    const next = rewrite(scalar.value)
    // Written back only where it changed, so a scalar the user quoted a
    // particular way is not re-stamped by an edit that did nothing to it.
    if (next !== scalar.value) scalar.value = next
  }
  visit(document.ast.getIn(root, true))
}

/**
 * Rewrite the string value of every pair under one key, anywhere below `root`.
 *
 * What a Block's slug needs: `use:` is a name in the document rather than a
 * Reference in a Template — `block.` is not an expression root (ADR-0014) — so
 * there is nothing to parse and the pair's value is edited directly.
 *
 * Keyed rather than structural because a command runs against a document that
 * does not project, so "every call site" cannot be asked of the model. A `use:`
 * appears only on a Step and on a Trigger, and a Trigger's names a Component, so
 * a rewrite that only fires on the exact old spelling cannot reach one.
 */
export function rewriteValuesOfKey(
  document: WorkflowDocument,
  root: Path,
  key: string,
  rewrite: (value: string) => string,
) {
  const visit = (node: unknown) => {
    const seq = asSeq(node)
    if (seq) {
      for (const item of seq.items) visit(item)
      return
    }
    if (tagOf(node) !== MAP) return
    for (const pair of (node as { items?: unknown[] }).items ?? []) {
      const value = (pair as { value?: unknown }).value
      const scalar = keyOf(pair as Pair) === key ? asScalar(value) : undefined
      if (scalar && typeof scalar.value === 'string') {
        const next = rewrite(scalar.value)
        if (next !== scalar.value) scalar.value = next
      } else {
        visit(value)
      }
    }
  }
  visit(document.ast.getIn(root, true))
}

/**
 * Rename a key in the mapping at `parent`, in place.
 *
 * The key itself moves, so the value node, its comments and the pair's position
 * all stay exactly where they were — which is what a rename means, and what
 * removing the pair and adding another would not do: the value would be
 * re-serialised and the pair would land wherever `order` put it, several lines
 * from where the user is looking.
 *
 * A mapping without the key is left alone rather than refused. A call site that
 * never filled a parameter in has no pair to rename, and a rename that threw
 * there would refuse the whole edit because one caller left a field blank.
 *
 * **A mapping that already holds `to` is refused.** Renaming onto it would put
 * two pairs under one key, which yaml resolves last-wins while every reader here
 * takes the first — the same trap `setScalarIn`'s neighbours guard, and one that
 * survives into the file because the document still validates.
 */
export function renameKeyIn(document: WorkflowDocument, parent: Path, from: string, to: string) {
  const pairs = pairsAt(document, parent)
  if (!pairs) return
  const pair = pairs.find((one) => keyOf(one) === from)
  if (!pair) return
  if (pairs.some((one) => keyOf(one) === to)) {
    throw new Error(`A "${to}" is already set here`)
  }
  const key = asScalar(pair.key)
  // A plain string key rather than a Scalar is what yaml's own `setIn` produces,
  // so both spellings have to be writable or a rename lands on some call sites
  // and not others (`keyOf` reads both for the same reason).
  if (key) key.value = to
  else (pair as { key: unknown }).key = to
}

/** Splice a pair into the mapping at `parent`, where `order` says it belongs. */
function createKey(
  document: WorkflowDocument,
  parent: Path,
  key: string,
  order: readonly string[],
  value: unknown,
) {
  const pairs = pairsAt(document, parent)
  // A Workflow Definition is a mapping, and a document that is not one has
  // nowhere to put a top-level key: `setIn(['vars'], …)` against a sequence
  // asks it to index by a string and throws with a message about indices. The
  // command aborts either way; saying which document it refused is what makes
  // the difference readable.
  if (!pairs) throw new Error(`Cannot add "${key}" to a document that is not a mapping`)

  const rank = order.indexOf(key)
  // An unrecognised key ranks -1 and therefore sorts before everything, so a
  // new key lands after whatever the Host or the user added of their own.
  const before = pairs.findIndex((pair) => {
    const held = keyOf(pair)
    return held !== undefined && order.indexOf(held) > rank
  })

  pairs.splice(before === -1 ? pairs.length : before, 0, newPair(document, key, value))
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
  where: string | Path,
): Generator<{ entry: Record<string, unknown>; index: number }> {
  const list = readAt(document, typeof where === 'string' ? [where] : where)
  const items = Array.isArray(list) ? list : []
  for (let index = 0; index < items.length; index++) {
    const entry = items[index]
    if (entry && typeof entry === 'object') yield { entry: entry as Record<string, unknown>, index }
  }
}
