import type { Block, Declaration, Manifest, Step, WorkflowDefinition } from '@hatua/schema'
import { blockIdOf, blockOf, cyclicBlocks, RETURN_VERB } from './blocks'
import type { Diagnostic } from './connections'
import { DEFINITION_DIAGNOSTICS, type DefinitionCode } from './generated/diagnostics'
import { type BoardId, boards, stepKey, walkDocument, walkSteps } from './tree'

/**
 * Whether a Workflow Definition is filled in enough to run — the rules that read
 * a Step against its Component Manifest, the verbs Hatua interprets
 * structurally, and the contract a Block declares.
 *
 * Here rather than in @hatua/services for the same reason `tree.ts` is: these
 * are pure domain rules over the typed projection, so a Host's runner can hold
 * a definition to exactly what the builder held it to. The store that watches
 * them and the region that draws a dot are separate concerns and live
 * elsewhere.
 *
 * Every code and what it blocks is declared in
 * `schemas/definition-diagnostics.yaml` and generated into both languages,
 * because `blocks` is part of the contract: a code that stopped Publish here and
 * merely informed in Go would let a workflow publish from one builder and not
 * another.
 *
 * Nothing below walks `doc.steps`. `walkDocument` yields every Step on every
 * Board, so a rule written here covers a Block's steps by construction — the
 * alternative is a validator that reports nothing about three Blocks, silently,
 * because it only ever looked at the root.
 */

type ManifestIndex = ReadonlyMap<string, Manifest>

/** The declared message, with its `{name}` holes filled. */
const message = (code: DefinitionCode, fields: Record<string, string> = {}): string =>
  DEFINITION_DIAGNOSTICS[code].message.replace(/\{(\w+)\}/g, (whole, name) => fields[name] ?? whole)

/** One diagnostic, taking `blocks` from the declaration rather than restating it. */
const raise = (
  code: DefinitionCode,
  subject: Partial<Diagnostic>,
  fields?: Record<string, string>,
): Diagnostic => ({
  code,
  message: message(code, fields),
  blocks: DEFINITION_DIAGNOSTICS[code].blocks,
  ...subject,
})

/**
 * Whether a field is shown, and therefore whether it can be missing.
 *
 * `when: [otherKey, value]` shows a field only while another field equals a
 * value — it is how one trigger component reshapes its form across schedule,
 * API and upstream modes. Counting a hidden field as unfilled would mark a Step
 * invalid for a field the user cannot see, let alone fill.
 *
 * Exported because the form that draws the fields has to ask the same question,
 * and two copies of it are two answers waiting to disagree: a hidden field that
 * starts blocking Publish, or a visible required one that stops being reported.
 * `reference.ts` and `slots.ts` refuse the same duplication for the same
 * reason — the rule lives once, in the package that owns the domain.
 */
export const fieldVisible = (
  field: Manifest['fields'][number],
  values: Record<string, unknown>,
): boolean => {
  if (!field.when) return true
  const [key, expected] = field.when
  return String(values[key as string] ?? '') === expected
}

/**
 * Empty means empty: absent, null, or a string of nothing but whitespace.
 *
 * `false` and `0` are values. A `bool` field left off is genuinely unset, but a
 * `bool` field set to false is answered — and treating a falsy value as missing
 * would make "no" impossible to say.
 */
const unfilled = (value: unknown): boolean => {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

/**
 * Required fields with nothing in them, per Step.
 *
 * A call and a `core.return` are checked against a declaration rather than a
 * manifest — `block.<id>`'s fields are the Block's `params`, and a return's are
 * the Block's `outputs`. Every parameter is required: a declaration IS the
 * contract, and an optional one would be a second concept for a Block to carry.
 */
export function missingRequiredFields(
  doc: WorkflowDefinition,
  manifests: ManifestIndex,
): Diagnostic[] {
  const out: Diagnostic[] = []

  const declared = (
    subject: Partial<Diagnostic>,
    declarations: readonly Declaration[] | undefined,
    values: Record<string, unknown>,
  ) => {
    for (const declaration of declarations ?? []) {
      if (!unfilled(values[declaration.k])) continue
      out.push(
        raise(
          'FIELD_REQUIRED',
          { ...subject, fieldKey: declaration.k },
          {
            label: declaration.label,
          },
        ),
      )
    }
  }

  const fromManifest = (
    subject: Partial<Diagnostic>,
    use: string,
    values: Record<string, unknown>,
  ) => {
    const manifest = manifests.get(use)
    // Unknown components are reported once, by their own rule. Guessing that
    // every field is missing would bury that one diagnostic under ten.
    if (!manifest) return

    for (const field of manifest.fields ?? []) {
      if (!field.req || !fieldVisible(field, values)) continue
      if (!unfilled(values[field.k])) continue
      out.push(raise('FIELD_REQUIRED', { ...subject, fieldKey: field.k }, { label: field.label }))
    }
  }

  for (const { step, board } of walkDocument(doc)) {
    const subject: Partial<Diagnostic> = { stepId: step.id, ...boardOn(board) }
    const values = (step.with ?? {}) as Record<string, unknown>

    const called = blockIdOf(step.use)
    if (called !== null) {
      // A call to a block nothing declares has its own rule; there is no
      // contract to hold its fields to.
      declared(subject, blockOf(doc, called)?.params, values)
      continue
    }

    if (step.use === RETURN_VERB) {
      declared(subject, blockOn(doc, board)?.outputs, values)
      continue
    }

    fromManifest(subject, step.use, values)
  }

  for (const trigger of doc.triggers ?? []) {
    fromManifest(
      { triggerId: trigger.id },
      trigger.use,
      (trigger.with ?? {}) as Record<string, unknown>,
    )
  }

  return out
}

/**
 * A Step or a Trigger whose verb nothing declares.
 *
 * The two roots fail differently, so they are two codes. A `component.*` verb
 * nothing declares blocks editing, because building cannot produce it: the
 * catalogue only offers what it declares, so it means a hand-edit or a Host that
 * dropped a component — and in the second case the fields are gone too, so there
 * is nothing to fill in. A `block.*` verb naming nothing blocks Publish only:
 * renaming or deleting a block is ordinary building, and locking the document
 * for editing over a name the user can fix three lines away would be absurd.
 *
 * Triggers are checked alongside Steps because the same mistake is possible in
 * `triggers:` and has the same consequence: `missingRequiredFields` returns
 * early for a manifest it cannot find, so without this a Trigger naming a verb
 * nothing declares produces no diagnostic at all, while the Board panel draws
 * it as a card that says its type is unknown.
 */
export function unknownComponents(doc: WorkflowDefinition, manifests: ManifestIndex): Diagnostic[] {
  const out: Diagnostic[] = []

  for (const { step, board } of walkDocument(doc)) {
    const called = blockIdOf(step.use)

    if (called !== null) {
      if (blockOf(doc, called)) continue
      out.push(raise('BLOCK_UNKNOWN', { stepId: step.id, ...boardOn(board) }, { name: called }))
      continue
    }

    if (manifests.has(step.use)) continue
    out.push(raise('COMPONENT_UNKNOWN', { stepId: step.id, ...boardOn(board) }, { use: step.use }))
  }

  for (const trigger of doc.triggers ?? []) {
    if (manifests.has(trigger.use)) continue
    out.push(raise('COMPONENT_UNKNOWN', { triggerId: trigger.id }, { use: trigger.use }))
  }

  return out
}

/**
 * The verbs Hatua interprets structurally, held to what they mean.
 *
 * These are read from the tree rather than from a manifest, because a manifest
 * cannot express them: `core.fork`'s Branches and `core.for_each`'s body are
 * positions in the document, not fields under `with:`.
 */
export function malformedContainers(doc: WorkflowDefinition): Diagnostic[] {
  const out: Diagnostic[] = []

  for (const { step, board } of walkDocument(doc)) {
    const subject: Partial<Diagnostic> = { stepId: step.id, ...boardOn(board) }

    if (step.use === 'core.fork') {
      const branches = step.branches ?? []
      // CONTEXT.md defines a Fork as "holding two or more Branches". One branch
      // is not a fork — it is the same path with a condition on it, which is
      // not a thing the runtime can do anything useful with.
      // Two codes rather than one message with a branch in it: an empty fork
      // was never configured, a one-branch fork is half-built, and the sentence
      // that helps differs.
      if (branches.length === 0) out.push(raise('FORK_HAS_NO_BRANCHES', subject))
      else if (branches.length < 2) out.push(raise('FORK_NEEDS_TWO_BRANCHES', subject))

      // A condition fork is "first match wins", so a branch with no `when`
      // before the end swallows every branch after it: they can never be
      // reached. The LAST branch may be unconditional — that is the fallback,
      // and it is the documented shape.
      if (branches.some((branch) => branch.when)) {
        branches.forEach((branch, index) => {
          if (branch.when || index === branches.length - 1) return
          out.push(raise('BRANCH_UNREACHABLE_AFTER', subject, { label: branch.label }))
        })
      }
    }

    if (step.use === 'core.for_each' && (step.steps ?? []).length === 0) {
      out.push(raise('LOOP_HAS_NO_BODY', subject))
    }
  }

  return out
}

/**
 * Whether a step list, read from its own root level, always reaches a return.
 *
 * A `core.fork` discharges the obligation only when EVERY branch does, which is
 * the same all-paths reasoning `scopeFor` applies to what a Step can read.
 *
 * A `core.for_each` never discharges it, and that is the load-bearing case: a
 * return inside a loop body exits the Block early and is perfectly legal, but
 * the list may be empty and the body may never run. That is the sibling-branch
 * argument applied to time rather than to paths.
 */
function alwaysReturns(steps: readonly Step[]): boolean {
  return steps.some((step) => {
    if (step.use === RETURN_VERB) return true
    if (step.use !== 'core.fork') return false
    const branches = step.branches ?? []
    return branches.length > 0 && branches.every((branch) => alwaysReturns(branch.steps))
  })
}

/**
 * The rules a Block carries: recursion, where a return may sit, and whether one
 * is reached.
 *
 * Recursion is answered here rather than by a runner's depth limit because
 * ADR-0013 refuses it at design time — "unbounded recursion is the jump problem
 * wearing a contract's clothes" — so both builders refuse the same document
 * rather than one of them discovering it in production.
 */
export function blockRules(doc: WorkflowDefinition): Diagnostic[] {
  const out: Diagnostic[] = []

  for (const id of cyclicBlocks(doc)) {
    out.push(raise('BLOCK_RECURSION', { blockId: id }, { name: id }))
  }

  for (const board of boards(doc)) {
    const seen = new Set<string>()
    for (const step of walkSteps(board.steps)) {
      // Ids are scoped to a Board, so two blocks may each hold a `ret`. Two on
      // ONE board make `{{steps.ret}}` name two things, which is the one case a
      // Board cannot disambiguate.
      if (seen.has(step.id)) {
        out.push(
          raise('STEP_ID_DUPLICATE', { stepId: step.id, ...boardOn(board.id) }, { name: step.id }),
        )
      }
      seen.add(step.id)

      if (step.use === RETURN_VERB && board.id === null) {
        out.push(raise('RETURN_OUTSIDE_BLOCK', { stepId: step.id }))
      }
    }

    for (const list of stepLists(board.steps)) unreachableAfterReturn(list, board.id, out)

    // A block that declares nothing publishes nothing and needs no return at
    // all: blocks used for their effects alone are the ordinary case.
    if (board.block && (board.block.outputs ?? []).length > 0) {
      if (!alwaysReturns(board.steps)) {
        out.push(
          raise(
            'BLOCK_PATH_WITHOUT_RETURN',
            { blockId: board.id ?? undefined },
            { name: board.block.id },
          ),
        )
      }
    }
  }

  return out
}

/** Every step list in a tree — the root, each Branch's, and each loop body's. */
function* stepLists(steps: readonly Step[]): Generator<readonly Step[]> {
  yield steps
  for (const step of steps) {
    for (const branch of step.branches ?? []) yield* stepLists(branch.steps)
    if (step.steps) yield* stepLists(step.steps)
  }
}

/** Steps sitting after one that always returns can never run. */
function unreachableAfterReturn(steps: readonly Step[], board: BoardId, out: Diagnostic[]) {
  const stops = steps.findIndex((step) => alwaysReturns([step]))
  if (stops === -1) return
  for (const step of steps.slice(stops + 1)) {
    out.push(raise('STEP_AFTER_RETURN', { stepId: step.id, ...boardOn(board) }))
  }
}

const boardOn = (board: BoardId) => (board === null ? {} : { blockId: board })

const blockOn = (doc: WorkflowDefinition, board: BoardId): Block | undefined =>
  board === null ? undefined : blockOf(doc, board)

/*
 * Deliberately NOT a rule: a Branch with no Steps.
 *
 * "Do nothing on this path" is a legitimate and common design — an `else` that
 * exists precisely so the other branch does not run — and the schema allows it
 * (`steps` has no `minItems`). Flagging it would put a permanent error on a
 * workflow that is finished and correct, which is how a validation marker stops
 * being read at all.
 */

/** Every step-level rule, in one pass, indexed by the Step it belongs to. */
export interface Validity {
  /**
   * Diagnostics for each Step that has any, keyed by `stepKey` — Board and id
   * together, because a Block's `ret` and another Block's `ret` are two Steps.
   */
  byStep: ReadonlyMap<string, Diagnostic[]>
  /** The same, for Triggers, which are not Steps and are drawn by another region. */
  byTrigger: ReadonlyMap<string, Diagnostic[]>
  /** The same, for what belongs to a Block rather than to any Step in it. */
  byBlock: ReadonlyMap<string, Diagnostic[]>
  /**
   * Everything, in the order the rules ran.
   *
   * Returned rather than left to a caller to flatten out of `byStep`: a
   * diagnostic about a Trigger has no `stepId`, so flattening the Step map
   * silently drops it — and a Publish gate counting what it found there would
   * pass a workflow whose Trigger is missing a required field.
   */
  all: readonly Diagnostic[]
}

export function validateDefinition(doc: WorkflowDefinition, manifests: ManifestIndex): Validity {
  const all = [
    ...unknownComponents(doc, manifests),
    ...missingRequiredFields(doc, manifests),
    ...malformedContainers(doc),
    ...blockRules(doc),
  ]

  const byStep = new Map<string, Diagnostic[]>()
  const byTrigger = new Map<string, Diagnostic[]>()
  const byBlock = new Map<string, Diagnostic[]>()

  const file = (map: Map<string, Diagnostic[]>, id: string, diagnostic: Diagnostic) => {
    const held = map.get(id)
    if (held) held.push(diagnostic)
    else map.set(id, [diagnostic])
  }

  for (const diagnostic of all) {
    if (diagnostic.stepId) {
      file(
        byStep,
        stepKey({ board: diagnostic.blockId ?? null, id: diagnostic.stepId }),
        diagnostic,
      )
    } else if (diagnostic.triggerId) file(byTrigger, diagnostic.triggerId, diagnostic)
    else if (diagnostic.blockId) file(byBlock, diagnostic.blockId, diagnostic)
  }
  return { byStep, byTrigger, byBlock, all }
}
