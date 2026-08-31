import type { WorkflowDocument } from '@hatua/document'
import { renamePath } from '@hatua/expressions'
import { BLOCK_PREFIX, type BoardId } from '@hatua/model'
import type { Declaration } from '@hatua/schema'
import {
  asObject,
  BLOCK_KEY_ORDER,
  boardTemplateRoots,
  detachNode,
  entriesOf,
  insertNode,
  listIn,
  type Path,
  readAt,
  renameKeyIn,
  rewriteTemplates,
  rewriteValuesOfKey,
  setScalar,
  setScalarIn,
  stepEntriesIn,
  topLevelList,
} from './ast'
import type { EditCommand } from './command'
import { requireUsableName } from './names'
import { boardPath } from './steps'

/**
 * The commands that address a Block: its declaration, its contract, and its
 * name.
 *
 * A Block's *steps* are addressed by `steps.ts` like any other Board's, because
 * they are: an `InsertPoint` carries a board, and every path is rooted there
 * rather than at `['steps']`. That is what makes an edit inside a Block the same
 * command as an edit at the root, which is what the extract-into-a-block gesture
 * will compose from — and what keeps a Block built on the canvas and one written
 * by hand in Text Mode the same document.
 */

/** Enough to declare a Block; its contract and its steps are filled in after. */
export interface NewBlock {
  /** Minted from the ids already declared when omitted. */
  id?: string
  name?: string
}

/** Which half of the contract a declaration belongs to. */
export type ContractSide = 'params' | 'outputs'

/** The path of the mapping declaring a Block. */
export function blockPath(document: WorkflowDocument, id: string): Path {
  const blocks = asObject(document).blocks
  const list = Array.isArray(blocks) ? blocks : []
  const index = list.findIndex(
    (entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).id === id,
  )
  if (index === -1) throw new Error(`No block with id "${id}"`)
  return ['blocks', index]
}

/**
 * The id the next Block would be declared under.
 *
 * Ids are minted rather than random, so the same edits produce the same
 * document twice — the property the round-trip tests rest on and the reason a
 * diff in the Host's repository stays readable.
 *
 * Exported because a surface that declares a Block usually has to say which one
 * it just declared — a new Block's Board opens as its tab (ADR-0017), and a
 * caller cannot open one it does not know the name of. Asking here and passing
 * the answer to `addBlock` keeps one minting rule instead of a second copy that
 * agrees by inspection.
 */
export function nextBlockId(document: WorkflowDocument): string {
  const taken = new Set<string>()
  for (const { entry } of entriesOf(document, 'blocks')) {
    if (typeof entry.id === 'string') taken.add(entry.id)
  }
  for (let n = 1; ; n++) {
    const id = `block_${n}`
    if (!taken.has(id)) return id
  }
}

/**
 * Declare a Block, creating `blocks:` in its documented position when the file
 * has none.
 *
 * Written with an empty `steps:` rather than none at all: the schema requires
 * the key, and a Board the canvas can open is a Board with a list to drop the
 * first Step into.
 */
export function addBlock(block: NewBlock = {}): EditCommand {
  return {
    label: `Add ${block.name ?? 'a block'}`,
    apply(document) {
      if (block.id !== undefined) requireUsableName(block.id)
      const listPath = topLevelList(document, 'blocks')
      const id = block.id ?? nextBlockId(document)

      // Two blocks under one id is worse than a refused declaration, for the
      // reason `renameBlock` gives: every reader resolves the FIRST match, so
      // the second block's Board opens on the first's steps and `removeBlock`
      // deletes the wrong one. A minted id is free of this by construction; one
      // a caller chose is not, and neither is a minted one applied against a
      // document that has moved on since it was asked for.
      for (const { entry } of entriesOf(document, 'blocks')) {
        if (entry.id === id) throw new Error(`A block named "${id}" already exists`)
      }

      // Key by key rather than an object literal, so the order in the file is
      // the order the schema documents instead of whatever insertion order an
      // object literal happened to have.
      const value: Record<string, unknown> = { id }
      if (block.name) value.name = block.name
      value.steps = []

      const list = asObject(document).blocks
      const index = Array.isArray(list) ? list.length : 0
      insertNode(document, listPath, index, document.ast.createNode(value))
    },
  }
}

/**
 * Remove a Block, and everything on its Board.
 *
 * Call sites are left alone and go stale, which is the same rule renaming a
 * variable key follows: rewriting every `use:` on a keystroke edits the file in
 * places the user is not looking, and the consequence — a call naming a block
 * that is not there — is already a state the model has and already reports.
 */
export function removeBlock(id: string): EditCommand {
  return {
    label: `Remove ${id}`,
    apply(document) {
      const [, index] = blockPath(document, id) as [string, number]
      detachNode(document, ['blocks'], index)
    },
  }
}

/** The roots a Reference begins with (ADR-0014). */
const PARAMS_ROOT = 'params.'
const STEPS_ROOT = 'steps.'

/**
 * Rename a Block, and rewrite every call that named it.
 *
 * One `sequence()`'s worth of change in one command, because the two halves are
 * one thing the user did (ADR-0021): a slug renamed without its call sites is a
 * Block nothing resolves, and every reader here — the canvas included — reads
 * that as a *deleted* Block.
 *
 * `use:` is not a Template. `block.` is not an expression root (ADR-0014), so a
 * call is a name in the document and the rewrite is a scalar edit rather than a
 * substitution inside a hole. Its whole reach is the document, because a Block
 * may be called from any Board including another Block's.
 */
export function renameBlock(from: string, to: string): EditCommand {
  return {
    label: `Rename ${from}`,
    apply(document) {
      requireUsableName(to)
      const path = blockPath(document, from)

      // Two blocks under one id is worse than a refused rename. Every reader
      // here resolves the FIRST match, so the second block's Board opens on the
      // first's steps, `removeBlock` deletes the wrong one and `addDeclaration`
      // edits the wrong contract — and `BLOCK_ID_DUPLICATE` only stops Publish,
      // long after the edit commands have gone to the wrong place.
      for (const { entry } of entriesOf(document, 'blocks')) {
        if (entry.id === to) throw new Error(`A block named "${to}" already exists`)
      }

      setScalar(document, [...path, 'id'], to)

      // After the declaration, so a refused rename leaves every call site alone:
      // the collision check above throws before anything has been rewritten.
      const was = `${BLOCK_PREFIX}${from}`
      const now = `${BLOCK_PREFIX}${to}`
      rewriteValuesOfKey(document, [], 'use', (value) => (value === was ? now : value))
    },
  }
}

/**
 * Set a Block's display name, which nothing references.
 *
 * Through `setScalarIn`, because a Block declared here starts without one:
 * `addBlock` writes `name:` only when it is given, so the first name a user
 * types is a key the mapping does not have, and appending it puts the name
 * below the Block's whole `steps:` list.
 */
export function setBlockName(id: string, name: string): EditCommand {
  return {
    label: `Rename ${id}`,
    apply(document) {
      setScalarIn(document, blockPath(document, id), 'name', BLOCK_KEY_ORDER, name)
    },
  }
}

/**
 * Add a parameter or an output, at the end of its list.
 *
 * At the end rather than the top because a call site's fields are drawn in
 * declaration order, and inserting above an existing one would reorder a form
 * somebody is already looking at.
 */
export function addDeclaration(
  id: string,
  side: ContractSide,
  declaration: Declaration,
): EditCommand {
  return {
    label: side === 'params' ? `Add ${declaration.label}` : `Publish ${declaration.label}`,
    apply(document) {
      requireUsableName(declaration.k)
      const block = blockPath(document, id)
      const listPath = listIn(document, block, side, BLOCK_KEY_ORDER)

      const value: Record<string, unknown> = {
        k: declaration.k,
        label: declaration.label,
        t: declaration.t,
      }
      if (declaration.of) value.of = declaration.of

      // The raw sequence length, not `entriesOf`'s count: that generator skips a
      // malformed entry, so a list holding a bare `-` would splice the new
      // declaration above whatever follows the hole — the reordering this
      // command exists to avoid.
      const held = readAt(document, listPath)
      const index = Array.isArray(held) ? held.length : 0
      insertNode(document, listPath, index, document.ast.createNode(value))
    },
  }
}

/**
 * Remove a parameter or an output.
 *
 * What pointed at it goes stale rather than being repaired: a removed parameter
 * leaves a value under an unknown key at every call site, and a removed output
 * leaves `{{ steps.<call>.<k> }}` naming nothing. Both are already detected and
 * already surfaced, so neither needs a repair mechanism invented for it.
 */
export function removeDeclaration(id: string, side: ContractSide, k: string): EditCommand {
  return {
    label: `Remove ${k}`,
    apply(document) {
      const { listPath, index } = locateDeclaration(document, id, side, k)
      detachNode(document, listPath, index)
    },
  }
}

/** The index of the declaration under `k`, against the list as the document holds it. */
function locateDeclaration(
  document: WorkflowDocument,
  id: string,
  side: ContractSide,
  k: string,
): { listPath: Path; index: number } {
  const listPath = [...blockPath(document, id), side]
  for (const { entry, index } of entriesOf(document, listPath)) {
    if (entry.k === k) return { listPath, index }
  }
  throw new Error(`No "${k}" declared under ${side}`)
}

/**
 * Rename a declaration's key. **References are not rewritten**, for the reason
 * `renameVariable` gives: every intermediate keystroke is a rename too, so a
 * mechanism that followed one would edit the user's file on every character.
 *
 * A stale `{{ params.<k> }}` inside the Block, and a value left under an unknown
 * key at every call site, are both states the model already has and already
 * reports.
 */
export function renameDeclaration(
  id: string,
  side: ContractSide,
  from: string,
  to: string,
): EditCommand {
  return {
    label: `Rename ${from}`,
    apply(document) {
      requireUsableName(to)
      const { listPath, index } = locateDeclaration(document, id, side, from)

      // Two declarations under one key is worse than a refused rename. Every
      // reader here resolves the FIRST match — `boardScope` offers it, this
      // command edits it and `removeDeclaration` deletes it — so the second row
      // would edit the first row's declaration while `{{ params.<k> }}` named a
      // value with two answers and no diagnostic.
      for (const other of entriesOf(document, listPath)) {
        if (other.index !== index && other.entry.k === to) {
          throw new Error(`A "${to}" is already declared under ${side}`)
        }
      }

      setScalar(document, [...listPath, index, 'k'], to)

      // After the declaration, so a refused rename leaves the document as it
      // found it: the collision check above throws before anything else moves.
      if (side === 'params') rewriteParamKey(document, id, from, to)
      else rewriteOutputReferences(document, id, from, to)
    },
  }
}

/**
 * A parameter is read inside its Block and supplied at every call site, and the
 * two are not the same kind of thing.
 *
 * Inside, `{{ params.<k> }}` is a Reference in a Template. At a call site the
 * key is a **mapping key** under `with:` — the name of the field being filled,
 * not a path being read — so that half is a structural rename and no
 * substitution could reach it.
 */
function rewriteParamKey(document: WorkflowDocument, id: string, from: string, to: string) {
  for (const root of boardTemplateRoots(document, id)) {
    rewriteTemplates(document, root, (source) =>
      renamePath(source, `${PARAMS_ROOT}${from}`, `${PARAMS_ROOT}${to}`),
    )
  }
  for (const call of callSites(document, id)) {
    renameKeyIn(document, [...call.listPath, call.index, 'with'], from, to)
  }
}

/**
 * An output is read at the call site, through the calling Step's id.
 *
 * `{{ steps.<call id>.<k> }}` and never `{{ block.… }}` — the path goes through
 * the Step that called, because that is where the value arrives. So the rewrite
 * is one substitution per call site, against the Board that call sits on, and a
 * Block called from three Boards is three different prefixes.
 */
function rewriteOutputReferences(document: WorkflowDocument, id: string, from: string, to: string) {
  for (const call of callSites(document, id)) {
    const stepId = call.step.id
    if (typeof stepId !== 'string') continue
    for (const root of boardTemplateRoots(document, call.board)) {
      rewriteTemplates(document, root, (source) =>
        renamePath(source, `${STEPS_ROOT}${stepId}.${from}`, `${STEPS_ROOT}${stepId}.${to}`),
      )
    }
  }
}

/**
 * Every Step calling this Block, on every Board.
 *
 * An AST walk rather than `callSitesOf`, which takes a projection a command may
 * not have (ADR-0001). A Block may be called from another Block's Board, so the
 * root Board alone is not the answer.
 */
function* callSites(document: WorkflowDocument, id: string) {
  const verb = `${BLOCK_PREFIX}${id}`
  const blocks = asObject(document).blocks
  const boards: BoardId[] = [null]
  for (const entry of Array.isArray(blocks) ? blocks : []) {
    const held = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).id : null
    if (typeof held === 'string') boards.push(held)
  }
  for (const board of boards) {
    const root = boardPath(document, board)
    for (const found of stepEntriesIn(readAt(document, root), root)) {
      if (found.step.use === verb) yield { ...found, board }
    }
  }
}

/** Write a declaration's friendly label, which nothing references. */
export function setDeclarationLabel(
  id: string,
  side: ContractSide,
  k: string,
  label: string,
): EditCommand {
  return {
    label: `Rename ${k}`,
    apply(document) {
      const { listPath, index } = locateDeclaration(document, id, side, k)
      setScalar(document, [...listPath, index, 'label'], label)
    },
  }
}

/**
 * Write a declaration's declared type.
 *
 * The one edit on a contract row that re-checks anything: a parameter's `t` is
 * what the Slot at every call site is checked against, and an output's is what
 * `{{ steps.<call>.<k> }}` carries downstream. Neither is read off a value —
 * a Block's Board is rebuilt on every invocation and holds no literal to read.
 */
export function setDeclarationType(
  id: string,
  side: ContractSide,
  k: string,
  t: string,
): EditCommand {
  return {
    label: `Retype ${k}`,
    apply(document) {
      const { listPath, index } = locateDeclaration(document, id, side, k)
      setScalar(document, [...listPath, index, 't'], t)
    },
  }
}
