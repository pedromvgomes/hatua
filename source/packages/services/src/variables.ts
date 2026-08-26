import type { WorkflowDocument } from '@hatua/document'
import type { BoardId } from '@hatua/model'
import {
  BLOCK_KEY_ORDER,
  detachNode,
  entriesOf,
  insertNode,
  KEY_ORDER,
  listIn,
  type Path,
  readAt,
  setScalar,
} from './ast'
import { blockPath } from './blocks'
import type { EditCommand } from './command'
import { requireUsableName } from './names'

/**
 * The commands that address a workflow variable.
 *
 * A variable is `{key, value}` in a `vars:` list, read as `{{ var.<key> }}` from
 * anywhere on its Board — it has no position in the tree, so unlike a Step it is
 * never out of scope.
 *
 * Every command below takes a Board. The workflow's variables live in the
 * top-level `vars:`; a Block's live in its own, are rebuilt on every invocation,
 * and are invisible outside it. One set of commands rather than two, because the
 * two differ only in which mapping holds the list — and two would be two answers
 * about where a created key lands.
 *
 * **A variable's value is a Template**, not a literal. It may hold `{{ … }}`,
 * and what it can read is the unpositioned scope: Run Context, Triggers and
 * earlier variables, never a Step's outputs, because no Step is guaranteed to
 * have run.
 *
 * Its *type* is declared, in `t`, and is the one thing here that re-types every
 * downstream Expression. The value box does not: `value` is only the FIRST
 * value, because `core.set_var` writes the same variable from a Step, so a type
 * read off the literal in the document would be a claim about one moment rather
 * than about the variable (ADR-0013). `setVariableType` is therefore a command
 * of its own, and `variables.test.ts` follows it to a verdict.
 */

/**
 * Keys are minted rather than blank, because a blank one is not a variable the
 * schema allows and would make the document stop projecting the moment the row
 * appeared. `new_variable`, then `new_variable_2` — deterministic, so the same
 * edits produce the same document twice.
 */
/** Where a Board's variables live: the document's own list, or a Block's. */
function varsPath(document: WorkflowDocument, board: BoardId): Path {
  return board === null ? ['vars'] : [...blockPath(document, board), 'vars']
}

/** The same, creating the list in its documented position when there is none. */
function ensureVars(document: WorkflowDocument, board: BoardId): Path {
  return board === null
    ? listIn(document, [], 'vars', KEY_ORDER)
    : listIn(document, blockPath(document, board), 'vars', BLOCK_KEY_ORDER)
}

function mintKey(document: WorkflowDocument, board: BoardId): string {
  const taken = new Set<string>()
  for (const { entry } of entriesOf(document, varsPath(document, board))) {
    if (typeof entry.key === 'string') taken.add(entry.key)
  }
  if (!taken.has('new_variable')) return 'new_variable'
  for (let n = 2; ; n++) {
    const key = `new_variable_${n}`
    if (!taken.has(key)) return key
  }
}

/** The index of the variable under `key`, against the list as the document holds it. */
function locateVariable(document: WorkflowDocument, board: BoardId, key: string): number {
  for (const { entry, index } of entriesOf(document, varsPath(document, board))) {
    if (entry.key === key) return index
  }
  throw new Error(`No variable named "${key}"`)
}

/**
 * Add a variable, at the end of the list.
 *
 * At the end rather than the top because order is meaningful: a variable may
 * read the ones declared before it, so a new row inserted above an existing one
 * would silently change what that one is allowed to see.
 */
export function addVariable(key?: string, board: BoardId = null): EditCommand {
  return {
    label: 'Add a variable',
    apply(document) {
      if (key !== undefined) requireUsableName(key)
      const listPath = ensureVars(document, board)
      const list = readAt(document, listPath)
      const index = Array.isArray(list) ? list.length : 0
      // `t` is written rather than left out, for the reason the key is minted
      // rather than left blank: the schema requires it, so a row without one is
      // a document that stops projecting the moment it appears. `text` because
      // it is the type an empty value is, and it is the one every other type
      // can be typed over from the row's control.
      const value: Record<string, unknown> = {
        key: key ?? mintKey(document, board),
        t: 'text',
        value: '',
      }
      insertNode(document, listPath, index, document.ast.createNode(value))
    },
  }
}

/**
 * Remove a variable. Every `{{ var.<key> }}` pointing at it goes stale and is
 * reported, for the reason `renameVariable` gives.
 */
export function removeVariable(key: string, board: BoardId = null): EditCommand {
  return {
    label: `Remove ${key}`,
    apply(document) {
      detachNode(document, varsPath(document, board), locateVariable(document, board, key))
    },
  }
}

/**
 * Rename a variable's key. **References are not rewritten.**
 *
 * A Reference is stored verbatim, so `{{ var.old_name }}` does not follow the
 * rename: it goes stale and the checker reports it, exactly as it does for a
 * Step that was removed. Rewriting every Template on a keystroke would edit the
 * user's file in places they are not looking, and mid-typing every intermediate
 * key is a rename too — `dige`, `diges`, `digest_to` — so a warning instead of
 * a rewrite would be a dialog on every character.
 *
 * The consequence is a state the model already has, already detects and already
 * surfaces. This adds no failure mode; it declines to invent a repair for one
 * that is visible. See `docs/handoff.md`, which settles it.
 *
 * **A key the schema cannot hold is refused, not written.** `Variable 1` is not
 * an `identifier`, so writing it stops the whole document projecting — and every
 * surface reads the projection, so one committed keystroke empties the canvas,
 * the panel and the step editor at once.
 */
export function renameVariable(from: string, to: string, board: BoardId = null): EditCommand {
  return {
    label: `Rename ${from}`,
    apply(document) {
      // Before anything is located, so a refused name is refused for the reason
      // it is refused rather than for a missing row.
      requireUsableName(to)
      const listPath = varsPath(document, board)
      const index = locateVariable(document, board, from)

      // Two variables under one key is worse than a refused rename. Every
      // reader here finds the FIRST match, so the second row's bin button
      // deletes the first row and its value box edits the first row's value —
      // and `{{ var.<key> }}` becomes a Reference with two answers and no
      // diagnostic, because nothing in the model checks for a duplicate.
      for (const other of entriesOf(document, listPath)) {
        if (other.index !== index && other.entry.key === to) {
          throw new Error(`A variable named "${to}" already exists`)
        }
      }

      setScalar(document, [...listPath, index, 'key'], to)
    },
  }
}

/**
 * Write a variable's declared type.
 *
 * The type control, and the only edit here that changes what a Template reading
 * `{{ var.<key> }}` is checked against. Separate from the value box because the
 * two answer different questions once a `core.set_var` can write the variable:
 * the value box says what it starts as, and this says what it must always be.
 */
export function setVariableType(key: string, t: string, board: BoardId = null): EditCommand {
  return {
    label: `Retype ${key}`,
    apply(document) {
      const listPath = varsPath(document, board)
      setScalar(document, [...listPath, locateVariable(document, board, key), 't'], t)
    },
  }
}

/**
 * The scalar a line of typed text denotes, by YAML's own rules.
 *
 * `7` is a number, `true` is a boolean, and everything else — including every
 * Template, because `{{ … }}` is not a YAML scalar form — is text. That is not
 * a convenience: the same text typed into Text Mode produces exactly these
 * values, and a Workflow Definition edited two ways has to mean one thing
 * (ADR-0001).
 *
 * Only what round-trips. `007` and `1e400` are left as text rather than
 * normalised to `7` and `Infinity`, because rewriting what the user typed is
 * the one thing a value box must not do.
 */
const scalarFor = (text: string): string | number | boolean => {
  if (text === 'true') return true
  if (text === 'false') return false
  const numeric = Number(text)
  if (text.trim() !== '' && Number.isFinite(numeric) && String(numeric) === text) return numeric
  return text
}

/**
 * Write a variable's initial value, as the Template it is.
 *
 * `setIn` rather than an assignment onto the existing scalar, because this is
 * the one field whose *style* is part of its meaning: `value: "7"` is text and
 * `value: 7` is a number. What it is checked against comes from `t` rather than
 * from the quoting, but a document round-trips what the user typed, and
 * silently requoting a number as a string is the one thing a value box must not
 * do.
 */
export function setVariableValue(
  key: string,
  template: string,
  board: BoardId = null,
): EditCommand {
  return {
    label: `Edit ${key}`,
    apply(document) {
      const listPath = varsPath(document, board)
      const index = locateVariable(document, board, key)
      document.ast.setIn([...listPath, index, 'value'], scalarFor(template))
    },
  }
}
