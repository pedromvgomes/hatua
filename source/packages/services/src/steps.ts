import type { WorkflowDocument } from '@hatua/document'
import type { Step } from '@hatua/schema'

/**
 * The edit commands, and the addressing they need.
 *
 * ADR-0001 decides what a command IS: a surgical mutation of the YAML document,
 * taking the same path a text edit takes. There is no typed graph to mutate and
 * no sync layer to keep honest — a command reaches into the AST, moves nodes
 * about, and the projection is recomputed from what is left. That is why
 * `moveStep` splices the existing node rather than rebuilding one from its
 * projection: the node carries the user's comments, key order and quoting, and
 * a rebuilt one would not.
 *
 * Only three commands exist here, and that is deliberate. The mechanism is the
 * deliverable; a command set designed before the screens that create them is a
 * command set those screens reshape. These three have consumers landing with
 * this PR — the Library's `onSelect` adds, and the Flow tab moves and removes.
 */

/** A position among a list of sibling Steps, named in domain terms rather than YAML paths. */
export interface InsertPoint {
  /**
   * The container Step whose children receive it. Absent for the workflow's
   * root sequence.
   */
  parentId?: string
  /**
   * Which of a `core.fork`'s branches, by index. Absent for a `core.for_each`'s
   * own nested `steps`, and absent at the root.
   */
  branchIndex?: number
  /** Position among the siblings. The list's length appends. */
  index: number
}

/** Enough to write a Step; everything else is the Inspector's to fill in later. */
export interface NewStep {
  /** The manifest verb, e.g. `email.send`. */
  use: string
  name?: string
  /** Minted from the ids already in the document when omitted. */
  id?: string
}

/**
 * One undoable change.
 *
 * `apply` mutates and returns nothing: there is no inverse to write, because
 * undo restores the document's previous TEXT rather than replaying an opposite
 * command. See `createEditingStore` for why that is the cheaper correctness.
 *
 * Throwing aborts the command. The store catches it, leaves the document alone
 * and records nothing on the undo stack, so a command that cannot find its Step
 * is a no-op rather than half an edit.
 */
export interface EditCommand {
  /** What an undo control says it will undo. */
  readonly label: string
  apply(document: WorkflowDocument): void
}

type Path = (string | number)[]

interface Located {
  /** Path of the sequence holding the Step. */
  listPath: Path
  index: number
}

/**
 * The document as plain JS, whether or not it is a valid Workflow Definition.
 *
 * `toJSON()` is not usable here and must not become so: it throws while the
 * source is mid-edit, which is a legitimate state (ADR-0001), and a command
 * that only worked on documents that already validate would be unusable in
 * exactly the situation the user is trying to edit their way out of. The AST's
 * own projection has no opinion about the schema.
 */
const asObject = (document: WorkflowDocument): Record<string, unknown> => {
  const value = document.ast.toJS()
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/**
 * Depth-first, parents before children, over the loose projection.
 *
 * Non-object entries are SKIPPED, never compacted away. A `steps:` list can
 * legitimately hold a bare `-` — that is a null item, and it is exactly what a
 * user halfway through typing in Text Mode has — and the index yielded here is
 * used verbatim against the AST sequence by `detachNode` and `insertNode`.
 * Filtering the list first renumbered everything after the hole, so removing a
 * Step deleted its neighbour instead. Skip in place; the index must stay the
 * index the document has.
 */
function* walk(
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
        yield* walk((branch as Record<string, unknown>).steps, [
          ...base,
          index,
          'branches',
          b,
          'steps',
        ])
      }
    }
    if (step.steps) yield* walk(step.steps, [...base, index, 'steps'])
  }
}

function locate(document: WorkflowDocument, id: string): Located | undefined {
  for (const found of walk(asObject(document).steps, ['steps'])) {
    if (found.step.id === id) return { listPath: found.listPath, index: found.index }
  }
  return undefined
}

/**
 * The YAML path of the sequence an InsertPoint names.
 *
 * Resolved against the document every time rather than held: a path is only
 * valid for the tree that produced it, and two commands applied in a row would
 * see the second one's indices shifted by the first.
 */
function listPathOf(document: WorkflowDocument, point: InsertPoint): Path {
  if (point.parentId === undefined) return ['steps']

  const parent = locate(document, point.parentId)
  if (!parent) throw new Error(`No Step with id "${point.parentId}"`)

  const parentPath = [...parent.listPath, parent.index]
  return point.branchIndex === undefined
    ? [...parentPath, 'steps']
    : [...parentPath, 'branches', point.branchIndex, 'steps']
}

/**
 * Ids are minted rather than random, so the same edits produce the same
 * document twice — which is what makes the round-trip tests assertable and
 * keeps a diff in the Host's repository readable. `s1`, `s2`… matching the
 * convention the fixtures and the design handoff both use.
 */
function mintId(document: WorkflowDocument): string {
  const taken = new Set<string>()
  for (const { step } of walk(asObject(document).steps, ['steps'])) {
    if (typeof step.id === 'string') taken.add(step.id)
  }
  for (let n = 1; ; n++) {
    const id = `s${n}`
    if (!taken.has(id)) return id
  }
}

interface Seq {
  items: unknown[]
  flow?: boolean
  commentBefore?: string
}

const asSeq = (value: unknown): Seq | undefined =>
  value && typeof value === 'object' && 'items' in value && Array.isArray((value as Seq).items)
    ? (value as Seq)
    : undefined

/**
 * A comment above the FIRST item of a block sequence is anchored to the
 * sequence, not to the item — every other item carries its own `commentBefore`.
 *
 * Left alone, that makes the comment describe a position rather than a Step:
 * remove the first Step and its comment stays behind to label whatever moves
 * up; move it and the comment does not go with it. The user wrote "# retry the
 * flaky one" above a Step, and it ends up above a different one, in a file that
 * lives in their repository.
 *
 * So it is lifted onto the item before any splice and lowered back onto the
 * sequence afterwards. Between those two calls every comment belongs to a node,
 * which is the model the rest of the file assumes.
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
 */
function insertNode(document: WorkflowDocument, listPath: Path, index: number, node: unknown) {
  const seq = asSeq(document.ast.getIn(listPath, true))

  if (!seq) {
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
function detachNode(document: WorkflowDocument, listPath: Path, index: number): unknown {
  const seq = asSeq(document.ast.getIn(listPath, true))
  if (!seq) throw new Error(`No step sequence at ${listPath.join('.')}`)

  liftLeadingComment(seq)
  const [node] = seq.items.splice(index, 1)
  lowerLeadingComment(seq)
  return node
}

const samePath = (a: Path, b: Path) => a.length === b.length && a.every((part, i) => part === b[i])

/**
 * Add a Step. The Library's `onSelect` is the consumer: a Manifest names the
 * `use`, the insertion point comes from whichever `+` was clicked, and
 * everything else — the field values under `with:` — is the Inspector's.
 */
export function addStep(step: NewStep, at: InsertPoint): EditCommand {
  return {
    label: `Add ${step.name ?? step.use}`,
    apply(document) {
      const listPath = listPathOf(document, at)
      const id = step.id ?? mintId(document)

      // Written key by key rather than spread from an object literal so the
      // order in the file is the order the schema documents — `id`, `use`,
      // `name` — instead of whatever an object literal's insertion order
      // happened to be. A Workflow Definition lives in the Host's repository
      // and a person reads the diff.
      const value: Record<string, unknown> = { id, use: step.use }
      if (step.name) value.name = step.name

      insertNode(document, listPath, at.index, document.ast.createNode(value))
    },
  }
}

/**
 * Remove a Step, and everything nested inside it. A Fork takes its Branches
 * with it, which is the only coherent reading — a Branch has no meaning without
 * the Fork that holds it, and the schema gives it nowhere else to live.
 */
export function removeStep(id: string): EditCommand {
  return {
    label: `Remove ${id}`,
    apply(document) {
      const found = locate(document, id)
      if (!found) throw new Error(`No Step with id "${id}"`)
      detachNode(document, found.listPath, found.index)
    },
  }
}

/**
 * Move a Step to another position — within its list, into a Branch, out of a
 * loop. The node itself is moved, so the comment a user wrote above the Step
 * travels with it.
 */
export function moveStep(id: string, to: InsertPoint): EditCommand {
  return {
    label: `Move ${id}`,
    apply(document) {
      const found = locate(document, id)
      if (!found) throw new Error(`No Step with id "${id}"`)

      // Resolved twice, against the tree before the move and against the tree
      // after it, because a YAML path is only valid for the tree that produced
      // it.
      //
      // This one is the reason: detaching a Step shifts every sibling after it
      // down one, and if the destination is INSIDE one of those siblings then
      // its path — `steps.2.branches.0.steps`, say — now points at
      // `steps.1.…`. `insertNode` looked there, found nothing, and fell through
      // to its "the sequence does not exist yet" branch, which `setIn` a whole
      // new root Step into being. The document stopped validating and the
      // dragged Step ended up inside a fabricated node. Reachable by dragging
      // any Step onto an insert point inside a Fork or loop that sits after it.
      const targetBefore = listPathOf(document, to)

      // A container cannot be moved into itself: the subtree would be detached
      // and then spliced into a sequence that is inside the detached node, so
      // the Step and everything under it would vanish from the document while
      // still holding a reference to itself. The projection would simply be
      // missing them, with no error anywhere.
      //
      // Checked before the detach, which is also what makes the second
      // resolution below safe: the destination is not inside what we lifted
      // out, so it is still in the tree afterwards.
      const ownPath = [...found.listPath, found.index]
      if (
        targetBefore.length > ownPath.length &&
        samePath(targetBefore.slice(0, ownPath.length), ownPath)
      ) {
        throw new Error(`Cannot move Step "${id}" inside itself`)
      }

      const node = detachNode(document, found.listPath, found.index)
      const targetPath = listPathOf(document, to)

      // The same shift, one list up. A move further along the SAME list
      // overshoots by one without this: moving s1 to index 3 of a four-step
      // list means "after s4", and the list is three long by the time the node
      // is spliced back in. Compared against the pre-detach path, because that
      // is the tree `to.index` was expressed against.
      const index =
        samePath(found.listPath, targetBefore) && to.index > found.index ? to.index - 1 : to.index

      insertNode(document, targetPath, index, node)
    },
  }
}

/**
 * How many Steps the root sequence holds, whether or not the document is a
 * valid Workflow Definition.
 *
 * `definition?.steps.length ?? 0` cannot tell "no Steps" from "does not
 * project", and a caller appending at that index would prepend instead. This
 * reads the same loose projection every command reads.
 */
export const rootStepCount = (document: WorkflowDocument): number => {
  const steps = asObject(document).steps
  return Array.isArray(steps) ? steps.length : 0
}

/**
 * The typed Step under an id, or undefined. Convenience for a caller that
 * already has the projection — commands themselves never use it, because they
 * must work on a document that does not project.
 */
export const stepIn = (steps: readonly Step[], id: string): Step | undefined => {
  for (const step of steps) {
    if (step.id === id) return step
    for (const branch of step.branches ?? []) {
      const hit = stepIn(branch.steps, id)
      if (hit) return hit
    }
    if (step.steps) {
      const hit = stepIn(step.steps, id)
      if (hit) return hit
    }
  }
  return undefined
}
