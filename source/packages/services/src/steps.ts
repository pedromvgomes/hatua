import type { WorkflowDocument } from '@hatua/document'
import { type BoardId, bornRegionsOf, type InsertPoint, type StepRef } from '@hatua/model'

/**
 * Re-exported because a Host writes against @hatua/services and never installs
 * @hatua/model. It is defined there because it is a position in the tree rather
 * than a service: @hatua/layout emits one per gap on the map, and a package that
 * had to reach past the model for it would be reaching past the layer that owns
 * the vocabulary.
 */
export type { InsertPoint } from '@hatua/model'

import type { Step } from '@hatua/schema'
import { asObject, detachNode, insertNode, type Path, readAt } from './ast'
import type { EditCommand } from './command'

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
 * This file holds the commands that address a Step, and only those. The
 * workflow's own fields — its name, its Triggers, its variables — are addressed
 * by key rather than by tree position, and live in `workflow.ts` and
 * `variables.ts`. Splitting them keeps the addressing in one file per subject:
 * everything below needs an `InsertPoint` and a walk of the tree, and nothing
 * beside it does.
 */

/** Enough to write a Step; everything else is the Inspector's to fill in later. */
export interface NewStep {
  /** The manifest verb, e.g. `component.email.send`. */
  use: string
  name?: string
  /** Minted from the ids already in the document when omitted. */
  id?: string
}

interface Located {
  /** Path of the sequence holding the Step. */
  listPath: Path
  index: number
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
    if (step.handler) yield* walk(step.handler, [...base, index, 'handler'])
  }
}

/**
 * The YAML path of a Board's root sequence.
 *
 * A Block is found by id rather than by index, because the index is a fact
 * about the file that a concurrent edit changes, and a command resolves its
 * paths against the document it is applied to.
 */
export function boardPath(document: WorkflowDocument, board: BoardId | undefined): Path {
  if (board === undefined || board === null) return ['steps']

  const blocks = asObject(document).blocks
  const list = Array.isArray(blocks) ? blocks : []
  const index = list.findIndex(
    (entry) =>
      entry && typeof entry === 'object' && (entry as Record<string, unknown>).id === board,
  )
  if (index === -1) throw new Error(`No block with id "${board}"`)

  return ['blocks', index, 'steps']
}

function locate(document: WorkflowDocument, ref: StepRef): Located | undefined {
  const root = boardPath(document, ref.board)
  for (const found of walk(readAt(document, root), root)) {
    if (found.step.id === ref.id) return { listPath: found.listPath, index: found.index }
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
  const root = boardPath(document, point.board)
  if (point.parentId === undefined) return root

  const parent = locate(document, { board: point.board ?? null, id: point.parentId })
  if (!parent) throw new Error(`No Step with id "${point.parentId}"`)

  const parentPath = [...parent.listPath, parent.index]
  if (point.branchIndex !== undefined) {
    return [...parentPath, 'branches', point.branchIndex, 'steps']
  }
  return [...parentPath, point.region === 'handler' ? 'handler' : 'steps']
}

/**
 * Ids are minted rather than random, so the same edits produce the same
 * document twice — which is what makes the round-trip tests assertable and
 * keeps a diff in the Host's repository readable. `s1`, `s2`… matching the
 * convention the fixtures and the design handoff both use.
 */
function mintId(document: WorkflowDocument, board: BoardId | undefined): string {
  const root = boardPath(document, board)
  const taken = new Set<string>()
  // Ids are Board-local, so only this Board's are taken. Minting against the
  // whole document would make a block's first step `s7` because the root has
  // six, which is a name nobody chose about a tree nobody is looking at.
  for (const { step } of walk(readAt(document, root), root)) {
    if (typeof step.id === 'string') taken.add(step.id)
  }
  for (let n = 1; ; n++) {
    const id = `s${n}`
    if (!taken.has(id)) return id
  }
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
      const id = step.id ?? mintId(document, at.board)

      // Written key by key rather than spread from an object literal so the
      // order in the file is the order the schema documents — `id`, `use`,
      // `name` — instead of whatever an object literal's insertion order
      // happened to be. A Workflow Definition lives in the Host's repository
      // and a person reads the diff.
      const value: Record<string, unknown> = { id, use: step.use }
      if (step.name) value.name = step.name

      // A container is born with its regions. They come last so the structural
      // keys sit under the descriptive ones, and empty so the Step is
      // unfinished in the document exactly as it is on screen — an empty region
      // is a frame with an insert point in it, which is the only way a Step ever
      // gets inside a container that was just added.
      for (const [key, list] of Object.entries(bornRegionsOf(step.use))) value[key] = list

      insertNode(document, listPath, at.index, document.ast.createNode(value))
    },
  }
}

/**
 * Remove a Step, and everything nested inside it. A Fork takes its Branches
 * with it, which is the only coherent reading — a Branch has no meaning without
 * the Fork that holds it, and the schema gives it nowhere else to live.
 */
export function removeStep(ref: StepRef): EditCommand {
  return {
    label: `Remove ${ref.id}`,
    apply(document) {
      const found = locate(document, ref)
      if (!found) throw new Error(`No Step with id "${ref.id}"`)
      detachNode(document, found.listPath, found.index)
    },
  }
}

/**
 * Move a Step to another position — within its list, into a Branch, out of a
 * loop. The node itself is moved, so the comment a user wrote above the Step
 * travels with it.
 */
export function moveStep(ref: StepRef, to: InsertPoint): EditCommand {
  return {
    label: `Move ${ref.id}`,
    apply(document) {
      const found = locate(document, ref)
      if (!found) throw new Error(`No Step with id "${ref.id}"`)

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
        throw new Error(`Cannot move Step "${ref.id}" inside itself`)
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
 * valid Workflow Definition, and whether or not the Board is still there.
 *
 * `definition?.steps.length ?? 0` cannot tell "no Steps" from "does not
 * project", and a caller appending at that index would prepend instead. This
 * reads the same loose projection every command reads.
 *
 * **A Board that is gone holds no Steps.** `boardPath` throws for one, which is
 * right for a command — an edit aimed at a Board that is not there must refuse
 * rather than land somewhere else — and wrong for a reader: this one is called
 * inside a click handler, synchronously, with nothing to catch it, and "how
 * many Steps" has a perfectly good answer for a Board nobody can find. The
 * append that follows is then a command against a missing Board, which is a
 * no-op with an undo entry rather than an exception out of an event handler.
 */
export const rootStepCount = (document: WorkflowDocument, board?: BoardId): number => {
  let path: Path
  try {
    path = boardPath(document, board)
  } catch {
    return 0
  }
  const steps = readAt(document, path)
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
    if (step.handler) {
      const hit = stepIn(step.handler, id)
      if (hit) return hit
    }
  }
  return undefined
}
