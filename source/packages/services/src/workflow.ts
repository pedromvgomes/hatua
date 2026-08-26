import type { WorkflowDocument } from '@hatua/document'
import { asObject, detachNode, entriesOf, insertNode, setScalar, topLevelList } from './ast'
import type { EditCommand } from './command'

/**
 * The commands that address the workflow itself: its identity, its Triggers,
 * and the Connections it declares.
 *
 * Addressed by key, not by tree position. A Step is found by walking a tree and
 * spliced at an `InsertPoint`; `name` is one key on the root mapping and a
 * Trigger is one entry of one top-level list. That difference is why these are
 * not in `steps.ts` — nothing here needs the walk, and nothing there can be
 * written without it.
 *
 * **A Trigger is not a Step.** `triggers` is a top-level list, `scopeFor` emits
 * `triggers.<id>` per entry, and `removeStep` cannot reach one. CONTEXT.md is
 * unambiguous about it and the schema follows, which is what makes `core.start`
 * unnecessary.
 *
 * Every command splices or writes into the node the document already has,
 * rather than rebuilding one from the projection — the reasoning `steps.ts`
 * gives applies verbatim: the node carries the user's comments, key order and
 * quoting, and a rebuilt one would not.
 */

/**
 * Bind a Host's Connection handle to a workflow-local name.
 *
 * A `conn` field stores the NAME, never the handle: `connections[]` holds the
 * `ref` once, and every field that uses it points at the id. That is what lets
 * a Connection be renamed by the Host without touching a field, and it is why
 * picking one the workflow has not declared yet is two edits rather than one —
 * `sequence` makes them a single undo.
 *
 * The id is the caller's to choose, because the caller is the only thing that
 * knows what the other ids are and what this Connection is called. Nothing here
 * can mint one without reading a projection a command must not depend on.
 */
export function declareConnection(id: string, ref: string): EditCommand {
  return {
    label: `Add ${id}`,
    apply(document) {
      for (const { entry } of entriesOf(document, 'connections')) {
        // Both refuse rather than no-op, and the ref one matters most: this
        // command is composed with the one that points a field at `id`
        // (`sequence`), so returning quietly would leave the field naming a
        // Connection the workflow never declared — the `blocks: 'edit'` state
        // `@hatua/model` says only a hand-edit can produce. A caller that finds
        // the handle already bound wants the existing name, not a second one.
        if (entry.ref === ref) {
          throw new Error(`That connection is already declared as "${String(entry.id)}"`)
        }
        if (entry.id === id) throw new Error(`A connection named "${id}" already exists`)
      }

      const listPath = topLevelList(document, 'connections')
      const list = asObject(document).connections
      const index = Array.isArray(list) ? list.length : 0
      insertNode(document, listPath, index, document.ast.createNode({ id, ref }))
    },
  }
}

/** Enough to write a Trigger; its `with:` values are the Workflow tab's to fill in. */
export interface NewTrigger {
  /** The manifest verb, e.g. `component.schedule.cron`. */
  use: string
  name?: string
  /** Minted from the ids already in the document when omitted. */
  id?: string
}

/**
 * Rename the workflow. `name` is free to change and nothing references it — a
 * Reference addresses a Step by id, never the document by name.
 */
export function setWorkflowName(name: string): EditCommand {
  return {
    label: 'Rename the workflow',
    apply(document) {
      setScalar(document, ['name'], name)
    },
  }
}

/**
 * Set the workflow's slug — the `id:` key, which is what the design calls the
 * slug and what the top bar renders beside the name.
 *
 * The schema calls it stable "across every version", and that is what it is:
 * publishing a Draft does not mint a new one, so every version of a workflow
 * carries the same slug. It is not immutable. A Host addresses a workflow
 * through its own `workflowId`, and whether that tracks this key is the Host's
 * to decide — the same bargain as a Trigger's id, and the same one ADR-0001
 * draws around the file generally: the user may write anything into it in Text
 * Mode, so a builder that refused to would only be harder to use than a text
 * editor.
 */
/**
 * Write the workflow's slug.
 *
 * Refuses an empty one, and nothing more: the schema spells a workflow's `id`
 * as a non-empty string rather than as an `identifier`, unlike a Block's or a
 * variable's key. Nothing addresses it from inside the document — it is the
 * Host's handle on the file — so the tighter rule the other names carry would
 * be this command inventing a constraint the contract does not have.
 */
export function setWorkflowSlug(slug: string): EditCommand {
  return {
    label: 'Change the slug',
    apply(document) {
      if (slug === '') throw new Error('A workflow needs a slug')
      setScalar(document, ['id'], slug)
    },
  }
}

/** The index of the Trigger under `id`, against the list as the document holds it. */
function locateTrigger(document: WorkflowDocument, id: string): number {
  for (const { entry, index } of entriesOf(document, 'triggers')) {
    if (entry.id === id) return index
  }
  throw new Error(`No Trigger with id "${id}"`)
}

/**
 * Ids are minted rather than random, so the same edits produce the same
 * document twice — which is what makes the round-trip tests assertable and
 * keeps a diff in the Host's repository readable. `t1`, `t2`… beside the `s1`,
 * `s2` a Step gets, because `{{ triggers.t1.at }}` and `{{ steps.s1.count }}` are
 * read side by side.
 */
function mintTriggerId(document: WorkflowDocument): string {
  const taken = new Set<string>()
  for (const { entry } of entriesOf(document, 'triggers')) {
    if (typeof entry.id === 'string') taken.add(entry.id)
  }
  for (let n = 1; ; n++) {
    const id = `t${n}`
    if (!taken.has(id)) return id
  }
}

/**
 * Add a Trigger. The Workflow tab's type picker is the consumer: a Manifest
 * names the `use`, and the field values under `with:` follow one command at a
 * time.
 */
export function addTrigger(trigger: NewTrigger): EditCommand {
  return {
    label: `Add ${trigger.name ?? trigger.use}`,
    apply(document) {
      const listPath = topLevelList(document, 'triggers')
      const id = trigger.id ?? mintTriggerId(document)

      // Written key by key rather than spread from an object literal so the
      // order in the file is the order the schema documents — `id`, `use`,
      // `name`.
      const value: Record<string, unknown> = { id, use: trigger.use }
      if (trigger.name) value.name = trigger.name

      const list = asObject(document).triggers
      const index = Array.isArray(list) ? list.length : 0
      insertNode(document, listPath, index, document.ast.createNode(value))
    },
  }
}

/**
 * Remove a Trigger, and with it everything a Template addressed through
 * `{{ triggers.<id>.… }}`.
 *
 * Those References are not rewritten and not blocked. They go stale and the
 * checker reports them, exactly as it does for a Step that was removed — the
 * decision `docs/handoff.md` settles for a renamed variable, made for the same
 * reason: a repair pass would edit the user's file in places they are not
 * looking.
 */
export function removeTrigger(id: string): EditCommand {
  return {
    label: `Remove ${id}`,
    apply(document) {
      detachNode(document, ['triggers'], locateTrigger(document, id))
    },
  }
}

/** Rename a Trigger. Its `id` is what a Reference points at, so a rename breaks nothing. */
export function setTriggerName(id: string, name: string): EditCommand {
  return {
    label: `Rename ${id}`,
    apply(document) {
      setScalar(document, ['triggers', locateTrigger(document, id), 'name'], name)
    },
  }
}

/**
 * Write one of a Trigger's field values, under the key its Component Manifest
 * declares as `FieldSpec.k`.
 *
 * The value is whatever the field's kind holds — a Template for the kinds that
 * accept an Expression, a literal for the rest. Which is which is the
 * manifest's to say and never this command's: it is handed a value and writes
 * it, exactly as a Step's `with:` entry will be.
 */
export function setTriggerField(
  id: string,
  key: string,
  value: string | number | boolean,
): EditCommand {
  return {
    label: `Edit ${id}`,
    apply(document) {
      setScalar(document, ['triggers', locateTrigger(document, id), 'with', key], value)
    },
  }
}
