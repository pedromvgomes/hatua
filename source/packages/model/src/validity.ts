import {
  CORE_FUNCTIONS,
  type FunctionDeclarations,
  type ScopeEntry,
  type Slot,
  sourceReference,
  type TypeNode,
  validate,
} from '@hatua/expressions'
import type {
  Block,
  ContextKey,
  Declaration,
  Manifest,
  Step,
  WorkflowDefinition,
} from '@hatua/schema'
import { blockIdOf, blockOf, cyclicBlocks, RETURN_VERB } from './blocks'
import { type ConnectionTypes, mismatchedConnections, unresolvedConnections } from './connections'
import { type Diagnostic, raise } from './diagnostic'
import { newScopeMemo, scopeFor, typeAtPath } from './scope'
import {
  FOR_EACH_LIST_FIELD,
  FOR_EACH_VERB,
  FORK_VERB,
  repeatSlot,
  SET_VAR_VERB,
  slotsForStep,
  whenSlot,
} from './slots'
import {
  type BoardId,
  boards,
  own,
  REPEAT_VERB,
  regionsOf,
  stepKey,
  TRY_VERB,
  varsOn,
  walkDocument,
  walkSteps,
} from './tree'

/**
 * Whether a Workflow Definition is filled in enough to run — the rules that read
 * a Step against its Component Manifest, the verbs Hatua interprets
 * structurally, the contract a Block declares, and the Connections a `conn`
 * field may hold.
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
  return String(own(values, key as string) ?? '') === expected
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
      if (!unfilled(own(values, declaration.k))) continue
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
      if (!unfilled(own(values, field.k))) continue
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

    if (step.use === SET_VAR_VERB) {
      // Structural, for the reason a return's fields are: what a `core.set_var`
      // takes is a var key and a value typed by the var that key names, and no
      // manifest knows which Board a Step is on. Its manifest declares no
      // fields at all, so without this a set_var with nothing in it reports
      // nothing.
      for (const [key, label] of SET_VAR_FIELDS) {
        if (!unfilled(own(values, key))) continue
        out.push(raise('FIELD_REQUIRED', { ...subject, fieldKey: key }, { label }))
      }
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
export function malformedContainers(
  doc: WorkflowDefinition,
  manifests: ManifestIndex = new Map(),
): Diagnostic[] {
  const out: Diagnostic[] = []
  const catalogue = [...manifests.values()]

  for (const { step, board } of walkDocument(doc)) {
    const subject: Partial<Diagnostic> = { stepId: step.id, ...boardOn(board) }

    if (step.use === FORK_VERB) {
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
      // Presence and not truthiness, which is the distinction the schema draws:
      // a branch whose condition is still empty carries one nobody has written
      // yet, and is not the fallback.
      if (branches.some((branch) => branch.when !== undefined)) {
        branches.forEach((branch, index) => {
          if (branch.when !== undefined || index === branches.length - 1) return
          out.push(raise('BRANCH_UNREACHABLE_AFTER', subject, { label: branch.label }))
        })
      }
    }

    // One code for both loop verbs: the mistake is the same and so is the fix,
    // and the message names neither.
    if (
      (step.use === FOR_EACH_VERB || step.use === REPEAT_VERB) &&
      (step.steps ?? []).length === 0
    ) {
      out.push(raise('LOOP_HAS_NO_BODY', subject))
    }

    // Read from the tree rather than from `with:`, because that is where it
    // lives: `FIELD_KIND_TYPES` has no mappable boolean, so a condition under
    // `with:` would type-check as text — see `repeatSlot`.
    if (step.use === REPEAT_VERB && (step.until ?? '').trim() === '') {
      out.push(raise('REPEAT_HAS_NO_CONDITION', subject))
    }

    /*
     * A `core.try` is two regions, so it is two codes.
     *
     * Not LOOP_HAS_NO_BODY, which reads "this loop repeats nothing" — the right
     * sentence about a for_each and the wrong one about a verb that is not a
     * loop. The Fork's pair settled this shape already: separate codes where the
     * missing half differs, because the sentence that helps differs with it.
     */
    if (step.use === TRY_VERB) {
      if ((step.steps ?? []).length === 0) out.push(raise('TRY_HAS_NO_BODY', subject))
      if ((step.handler ?? []).length === 0) out.push(raise('TRY_HAS_NO_HANDLER', subject))
    }

    /*
     * The rule that makes `t: item` observable.
     *
     * `list` is a `ref` field and `FIELD_KIND_TYPES` maps `ref` to `unknown`, so
     * the ordinary Slot check accepts anything written there — which is how a
     * loop pointed at a number type-checks clean while `item` quietly resolves
     * to nothing and matches everything downstream. Only a statically-KNOWN
     * conflict is reported, matching the lattice everywhere else: an expression
     * with no static type is accepted with the run-time check every unknown
     * gets.
     */
    if (step.use === FOR_EACH_VERB) {
      const named = loopListType(doc, board, step, catalogue)
      if (named && named.type !== 'list' && named.type !== 'unknown' && named.type !== 'item') {
        out.push(
          raise(
            'LOOP_LIST_NOT_A_LIST',
            { ...subject, fieldKey: FOR_EACH_LIST_FIELD },
            {
              name: listReferenceOf(step) ?? FOR_EACH_LIST_FIELD,
              actual: named.type,
            },
          ),
        )
      }
    }

    if (step.use === SET_VAR_VERB) {
      const key = own((step.with ?? {}) as Record<string, unknown>, 'key')
      // A missing key is FIELD_REQUIRED's to report. Resolving `undefined`
      // against the Board would say no variable is called "undefined", which
      // names a variable the user never wrote.
      if (typeof key === 'string' && key !== '' && !varsOn(doc, board).some((v) => v.key === key)) {
        out.push(raise('VAR_UNKNOWN', { ...subject, fieldKey: 'key' }, { name: key }))
      }
    }
  }

  return out
}

/**
 * The fields a `core.set_var` takes. Labels rather than keys in the message,
 * matching every other required-field diagnostic — the sentence is read by
 * someone looking at a form, not at YAML.
 */
const SET_VAR_FIELDS: readonly (readonly [string, string])[] = [
  ['key', 'Variable'],
  ['value', 'Value'],
]

/** The path a loop's `list` names, when it names exactly one and nothing else. */
function listReferenceOf(step: Step): string | null {
  const template = own(step.with as Record<string, unknown> | undefined, FOR_EACH_LIST_FIELD)
  return typeof template === 'string' ? sourceReference(template) : null
}

/**
 * The declared type of what a loop's `list` names, or null when the document
 * does not say.
 *
 * Deliberately the same read `loopElementType` performs, one step short of
 * taking the element: the diagnostic and the binding must agree about which
 * lists are lists, and two readings of one field are two answers waiting to
 * disagree — a loop reported as iterating a number while `item` resolved
 * anyway, or the reverse.
 */
function loopListType(
  doc: WorkflowDefinition,
  board: BoardId,
  step: Step,
  manifests: readonly Manifest[],
): TypeNode | null {
  const path = listReferenceOf(step)
  if (path === null) return null
  return typeAtPath(scopeFor(doc, { board, id: step.id }, manifests), path)
}

/**
 * Whether a step list, read from its own root level, always reaches a return.
 *
 * A `core.fork` discharges the obligation only when EVERY branch does, which is
 * the same all-paths reasoning `scopeFor` applies to what a Step can read.
 *
 * The two loop verbs answer differently, and the difference is the whole rule.
 * A `core.for_each` never discharges it: a return inside its body exits the
 * Block early and is perfectly legal, but the list may be empty and the body
 * may never run. A `core.repeat` does, because it tests its `until` after the
 * body and therefore always runs it once. One question — is this region
 * guaranteed to run at all — which is the sibling-branch argument applied to
 * time rather than to paths.
 */
function alwaysReturns(steps: readonly Step[]): boolean {
  return steps.some((step) => {
    if (step.use === RETURN_VERB) return true

    // A repeat tests its `until` AFTER the body, so the body always runs — and
    // a region guaranteed to run discharges what it guarantees. This is the one
    // line separating the two loop verbs, and it is the same question asked of
    // both: a `core.for_each`'s list may be empty, a repeat's first pass is
    // unconditional.
    if (step.use === REPEAT_VERB) return alwaysReturns(step.steps ?? [])

    /*
     * A `core.try` discharges the obligation only when BOTH regions do.
     *
     * The body always runs, so on its own it would look like a repeat. But a
     * failure part-way through the body is exactly what a try exists to admit,
     * and that path leaves the body without finishing it and enters the handler
     * instead. So the guarantee is the conjunction: every path out of a try goes
     * through the body OR through the handler, and a region that may skip its
     * return leaves one of them open. That is the Fork's all-branches reasoning,
     * asked of two regions where one of them is conditional.
     */
    if (step.use === TRY_VERB) {
      return alwaysReturns(step.steps ?? []) && alwaysReturns(step.handler ?? [])
    }

    if (step.use !== FORK_VERB) return false

    const branches = step.branches ?? []
    if (branches.length === 0) return false

    /*
     * Which fork this is, read from the branches because the schema has no mode
     * field — the same question `regionsOf` and `branchUnreachableAfter` ask,
     * and asked the same way. A fork where NO branch carries `when` is the
     * parallel one.
     *
     * Presence rather than truthiness, which is how `malformedContainers` and
     * `branchKeyword` read it too. One rule treating `when: ""` as the fallback
     * while another treats it as a condition refuses publish to a Block that
     * does return on every path.
     */
    if (branches.some((branch) => branch.when !== undefined)) {
      // A condition fork is first-match-wins, so one whose every branch carries
      // a `when` can match none of them and fall straight through. Only an
      // unconditional last branch — the fallback — makes it exhaustive, and the
      // schema says that branch MAY be unconditional rather than must be.
      // Without this the obligation is discharged by a fork that can skip every
      // path, and a Step legitimately placed after such a fork is refused
      // publish as unreachable.
      if (branches.at(-1)?.when !== undefined) return false

      // Exactly one branch runs, so every one of them has to carry a return.
      return branches.every((branch) => alwaysReturns(branch.steps))
    }

    /*
     * Every branch of a parallel fork runs, so ONE that always returns ends the
     * Block — which is the opposite quantifier from the condition fork above,
     * for the opposite reason. Asking `every` here refuses publish to a Block
     * that does return on every path, and leaves a Step placed after such a
     * fork unreported when it can never run.
     */
    return branches.some((branch) => alwaysReturns(branch.steps))
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

  const declared = new Set<string>()
  for (const block of doc.blocks ?? []) {
    // A call resolves to the first block under an id, so a second is
    // unreachable — and every other reader would have to agree about which one
    // `block.x` meant. Reported rather than silently resolved.
    if (declared.has(block.id)) {
      out.push(raise('BLOCK_ID_DUPLICATE', { blockId: block.id }, { name: block.id }))
    }
    declared.add(block.id)
  }

  for (const block of doc.blocks ?? []) {
    for (const [side, declarations] of [
      ['parameter', block.params],
      ['output', block.outputs],
    ] as const) {
      const named = new Set<string>()
      for (const declaration of declarations ?? []) {
        if (named.has(declaration.k)) {
          out.push(
            raise(
              'DECLARATION_KEY_DUPLICATE',
              { blockId: block.id },
              { side, block: block.id, name: declaration.k },
            ),
          )
        }
        named.add(declaration.k)
      }
    }
  }

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

/**
 * Every step list in a tree — the root, each Branch's, each loop body's, and
 * each `core.try`'s handler.
 *
 * A region missing from here is a region STEP_AFTER_RETURN never looks at, so a
 * Step sitting after a `core.return` inside a handler would be reported by
 * neither language and published by both.
 */
function* stepLists(steps: readonly Step[]): Generator<readonly Step[]> {
  yield steps
  for (const step of steps) {
    for (const region of regionsOf(step)) yield* stepLists(region.steps)
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
   * The same, for what belongs to a Connection rather than to any Step using it.
   *
   * Only CONNECTION_NOT_ESTABLISHED files here: the other connection codes are
   * raised at a field, so they name a Step or a Trigger as well and belong on
   * the row the user can act on. A Connection declared and never wired is at
   * fault on its own — it is unfinished whether or not anything points at it
   * yet — and there is no Step to hang it on.
   *
   * A fourth map for the reason the second and third exist, and the fault is
   * filed once here rather than raised again at every field that points at the
   * Connection — the duplication `troubledBlocks` refuses for a call, one seam
   * over: a Publish gate counting faults must not count one Connection five
   * times because five Steps use it. The `conn` field that draws it looks the
   * Connection up by the id it holds.
   */
  byConnection: ReadonlyMap<string, Diagnostic[]>
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

/**
 * Every Template on every Board, checked against the type its field declares
 * and the scope its Step can see.
 *
 * The fifth rule family, and the one that reaches into a different package:
 * `@hatua/expressions` owns the grammar and the checking, and has done since
 * before anything called it. What was missing was the walk — "which Templates
 * are there, and what may each of them address" is a question about a Workflow
 * Definition, which is this package's subject and not that one's.
 *
 * **Errors only.** An expression diagnostic carries a severity, and a warning
 * informs without blocking anything (ADR-0009's gradual typing: an unprovable
 * type defers to run time). A `Diagnostic` here carries `blocks` instead, whose
 * two values both block something, so a warning has nothing to become. The
 * Inspector calls `validate` itself and renders every severity; this pass exists
 * to mark cards and gate Publish, and neither is a warning's business.
 *
 * **Steps only.** A Trigger's fields and a Variable's initial value are
 * Templates too, and neither has a scope anyone has defined — `scopeFor` takes a
 * `StepRef` because a scope is a position in a tree, and a Trigger is upstream
 * of every position. Checking them against a scope invented here would be a
 * second answer to a question the model has not been asked yet.
 */
export function expressionRules(
  doc: WorkflowDefinition,
  manifests: ManifestIndex,
  context: readonly ContextKey[] = [],
  functions: FunctionDeclarations = CORE_DECLARATIONS,
): Diagnostic[] {
  const out: Diagnostic[] = []
  const catalogue = [...manifests.values()]
  // One memo for the whole document. A scope is positional, so every Step's
  // names each Step upstream of it — recomputing those per Step is what makes a
  // pass over a thousand Steps cost a second rather than a millisecond, and
  // this runs on every keystroke.
  const memo = newScopeMemo()

  for (const { step, board } of walkDocument(doc)) {
    const subject: Partial<Diagnostic> = { stepId: step.id, ...boardOn(board) }
    // Built once per Step and shared by every Slot on it: a Step's scope is a
    // fact about where it sits, and a `with:` map of ten fields is ten Templates
    // resolved against one answer.
    let scope: ScopeEntry[] | undefined

    const check = (slot: Slot) => {
      // A blank Template is not a wrong one. Whether a field may be left empty
      // is `req:`'s business, and whether a repeat may have no condition is
      // REPEAT_HAS_NO_CONDITION's — both already say so. Type-checking it too
      // reports "blank is not a boolean" beside "this has no condition", which
      // is one gap described twice. Whitespace and not just `''`, because the
      // rules that own the question all trim and two spellings of empty would
      // put the second sentence back for a field holding a space.
      if (slot.template.trim() === '') return
      scope ??= scopeFor(doc, { board, id: step.id }, catalogue, context, memo)
      for (const found of validate(slot.template, slot.expectedType, { scope, functions })) {
        if (found.severity !== 'error') continue
        out.push({
          code: found.code,
          message: found.message,
          blocks: 'publish',
          fieldKey: slot.name,
          ...subject,
        })
      }
    }

    for (const slot of slotsForStep(doc, board, step, manifests.get(step.use))) check(slot)

    // A Branch's condition and a loop's termination test sit beside `steps:`
    // rather than under `with:`, which is what lets them be boolean at all —
    // `FIELD_KIND_TYPES` has no mappable boolean. So no manifest names them and
    // `slotsForStep` cannot yield them.
    for (const branch of step.branches ?? []) {
      if (branch.when !== undefined) check(whenSlot(branch.when))
    }
    if (typeof step.until === 'string') check(repeatSlot(step.until))
  }

  return out
}

/**
 * Every rule family over every Board, filed by the subject each one names.
 *
 * `connectionTypes` is the one input that is not the document or a manifest. A
 * Connection stores an opaque `ref` and nothing more (ADR-0007), so its type
 * comes from the Host, asynchronously, and may never come at all — a Host that
 * wires no `ConnectionSource` is correctly configured, not broken.
 *
 * **Absence narrows this pass; it never stops it.** Handed no types, the two
 * connection codes that need one go unreported and every other family runs
 * exactly as it would have. The alternative — returning nothing until the
 * Connections arrive — would leave a Host that wires no `ConnectionSource` with
 * no validation whatsoever, silently, including the rules that have nothing to
 * do with Connections. See ADR-0022.
 */
export function validateDefinition(
  doc: WorkflowDefinition,
  manifests: ManifestIndex,
  context: readonly ContextKey[] = [],
  connectionTypes?: ConnectionTypes,
): Validity {
  const all = [
    ...unknownComponents(doc, manifests),
    ...missingRequiredFields(doc, manifests),
    ...malformedContainers(doc, manifests),
    ...blockRules(doc),
    ...expressionRules(doc, manifests, context),
    ...unresolvedConnections(doc),
    ...mismatchedConnections(doc, manifests, connectionTypes),
  ]

  const byStep = new Map<string, Diagnostic[]>()
  const byTrigger = new Map<string, Diagnostic[]>()
  const byBlock = new Map<string, Diagnostic[]>()
  const byConnection = new Map<string, Diagnostic[]>()

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
    // Last, because a Connection is the subject of a fault only when no Step or
    // Trigger is. A `conn` field's diagnostic names both, and the row holding
    // the field is where somebody can act on it.
    else if (diagnostic.connectionId) file(byConnection, diagnostic.connectionId, diagnostic)
  }
  return { byStep, byTrigger, byBlock, byConnection, all }
}

/**
 * Hatua's own functions, as declarations without implementations.
 *
 * The default a checker uses when the caller supplies none. Built from
 * `CORE_FUNCTIONS` rather than `coreFunctions()`, which pairs each declaration
 * with the code that runs it: a builder validating a document never calls one,
 * and reaching for the registry would put all thirty-four implementations in
 * every Host's bundle to answer questions about arity.
 *
 * A **Host's** functions are absent because there is nowhere to declare one —
 * `ManifestEntry` is a Component, a Trigger or a Run Context, and no manifest
 * kind carries a function signature. So no Host-declared call can reach here to
 * be reported unknown, and the parameter is what the port will thread through
 * when it exists.
 */
const CORE_DECLARATIONS: FunctionDeclarations = new Map(
  CORE_FUNCTIONS.map((spec) => [spec.qualified, { spec }]),
)
