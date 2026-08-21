import type { WorkflowDocument } from '@hatua/document'
import { asObject, detachNode, entriesOf, insertNode, setScalar, topLevelList } from './ast'
import type { EditCommand } from './command'

/**
 * The commands that address a workflow variable.
 *
 * A variable is `{key, value}` in the top-level `vars:` list, read as
 * `{{ var.<key> }}` from anywhere — it has no position in the tree, so unlike a
 * Step it is never out of scope.
 *
 * **A variable's value is a Template**, not a literal. It may hold `{{ … }}`,
 * and what it can read is the unpositioned scope: Run Context, Triggers and
 * earlier variables, never a Step's outputs, because no Step is guaranteed to
 * have run.
 *
 * Its *type* follows from what is stored: `varType` in @hatua/model reads a
 * variable's type off its value, because a variable is the one addressable
 * thing with no declaration to consult. So editing one changes what every
 * downstream Expression reading it type-checks against, which is correct and is
 * the reason `variables.test.ts` asserts it end to end.
 */

/**
 * Keys are minted rather than blank, because a blank one is not a variable the
 * schema allows and would make the document stop projecting the moment the row
 * appeared. `new_variable`, then `new_variable_2` — deterministic, so the same
 * edits produce the same document twice.
 */
function mintKey(document: WorkflowDocument): string {
  const taken = new Set<string>()
  for (const { entry } of entriesOf(document, 'vars')) {
    if (typeof entry.key === 'string') taken.add(entry.key)
  }
  if (!taken.has('new_variable')) return 'new_variable'
  for (let n = 2; ; n++) {
    const key = `new_variable_${n}`
    if (!taken.has(key)) return key
  }
}

/** The index of the variable under `key`, against the list as the document holds it. */
function locateVariable(document: WorkflowDocument, key: string): number {
  for (const { entry, index } of entriesOf(document, 'vars')) {
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
export function addVariable(key?: string): EditCommand {
  return {
    label: 'Add a variable',
    apply(document) {
      const listPath = topLevelList(document, 'vars')
      const list = asObject(document).vars
      const index = Array.isArray(list) ? list.length : 0
      const value: Record<string, unknown> = { key: key ?? mintKey(document), value: '' }
      insertNode(document, listPath, index, document.ast.createNode(value))
    },
  }
}

/**
 * Remove a variable. Every `{{ var.<key> }}` pointing at it goes stale and is
 * reported, for the reason `renameVariable` gives.
 */
export function removeVariable(key: string): EditCommand {
  return {
    label: `Remove ${key}`,
    apply(document) {
      detachNode(document, ['vars'], locateVariable(document, key))
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
 */
export function renameVariable(from: string, to: string): EditCommand {
  return {
    label: `Rename ${from}`,
    apply(document) {
      setScalar(document, ['vars', locateVariable(document, from), 'key'], to)
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
 * (ADR-0001). It is also what makes the type marking move, since `varType`
 * reads a variable's type off the value stored here.
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
 * Write a variable's value, as the Template it is.
 *
 * `setIn` rather than an assignment onto the existing scalar, because this is
 * the one field whose *style* is part of its meaning: `value: "7"` is text and
 * `value: 7` is a number, so keeping the quoting the previous value was written
 * in would make a variable that starts out quoted impossible to turn into a
 * number. Everywhere else the quoting is the user's and stays.
 */
export function setVariableValue(key: string, template: string): EditCommand {
  return {
    label: `Edit ${key}`,
    apply(document) {
      const index = locateVariable(document, key)
      document.ast.setIn(['vars', index, 'value'], scalarFor(template))
    },
  }
}
