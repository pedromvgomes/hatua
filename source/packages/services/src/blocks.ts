import type { WorkflowDocument } from '@hatua/document'
import type { Declaration } from '@hatua/schema'
import {
  asObject,
  BLOCK_KEY_ORDER,
  detachNode,
  entriesOf,
  insertNode,
  listIn,
  type Path,
  readAt,
  setScalar,
  topLevelList,
} from './ast'
import type { EditCommand } from './command'

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
 * Ids are minted rather than random, so the same edits produce the same
 * document twice — the property the round-trip tests rest on and the reason a
 * diff in the Host's repository stays readable.
 */
function mintId(document: WorkflowDocument): string {
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
      const listPath = topLevelList(document, 'blocks')
      const id = block.id ?? mintId(document)

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

/** Rename a Block. Its call sites go stale and are reported, never rewritten. */
export function renameBlock(from: string, to: string): EditCommand {
  return {
    label: `Rename ${from}`,
    apply(document) {
      setScalar(document, [...blockPath(document, from), 'id'], to)
    },
  }
}

/** Set a Block's display name, which nothing references. */
export function setBlockName(id: string, name: string): EditCommand {
  return {
    label: `Rename ${id}`,
    apply(document) {
      setScalar(document, [...blockPath(document, id), 'name'], name)
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
      const listPath = [...blockPath(document, id), side]
      for (const { entry, index } of entriesOf(document, listPath)) {
        if (entry.k !== k) continue
        detachNode(document, listPath, index)
        return
      }
      throw new Error(`No "${k}" declared under ${side}`)
    },
  }
}
