import type { Block, Step, Variable, WorkflowDefinition } from '@hatua/schema'

/**
 * Pure domain rules over the step tree. No state, no I/O, no YAML — those live
 * in @hatua/document. Everything here is a function of the typed projection.
 */

/**
 * Which Board a Step sits on: a Block's id, or `null` for the root Board.
 *
 * `null` rather than a sentinel string because the root Board is not a Block and
 * has no id to borrow — a string would have to be one no Block could ever be
 * called, which is a reserved word this design spent ADR-0014 getting rid of.
 */
export type BoardId = string | null

/**
 * One drawable Step tree and the root that gives it its parameters.
 *
 * A document holds the root Board, whose root is `triggers:`, plus one per
 * Block, whose root is its declared contract. Scope is computed against a Board
 * and never across two, which is what keeps a call a cross-link with a contract
 * rather than a jump (ADR-0013).
 */
export interface Board {
  readonly id: BoardId
  /** The Block this Board belongs to. Absent on the root Board. */
  readonly block?: Block
  readonly steps: readonly Step[]
}

/**
 * Read one key of a document-supplied map.
 *
 * `Object.hasOwn` is the whole guarantee, and it is the same one `resolve.ts`
 * gives for `{{ steps.s2.constructor }}`. A Workflow Definition is user-editable
 * YAML and the schema's identifier rule permits underscores, so `__proto__` is a
 * legal field key, a legal declaration key and a legal var key — and a bare
 * `values[k]` there reads `Object.prototype` rather than nothing, which makes a
 * missing value look present. Go has no prototype to find, so this is also what
 * keeps the two languages saying the same thing about the same document.
 */
export const own = (values: Record<string, unknown> | undefined, key: string): unknown =>
  values && Object.hasOwn(values, key) ? values[key] : undefined

/** A Step, and the Board it is on. Neither half identifies one alone. */
export interface StepRef {
  readonly board: BoardId
  readonly id: string
}

/**
 * Every Board in the document, root first.
 *
 * This is the traversal that cannot forget a Block. A validator walking
 * `doc.steps` sees a document with three Blocks in it and reports nothing about
 * any of them, silently — so nothing here walks `doc.steps` directly.
 */
export function* boards(doc: WorkflowDefinition): Generator<Board> {
  yield { id: null, steps: doc.steps }
  for (const block of doc.blocks ?? []) yield { id: block.id, block, steps: block.steps }
}

/** One Board by id, or undefined when nothing declares it. */
export function boardOf(doc: WorkflowDefinition, id: BoardId): Board | undefined {
  for (const board of boards(doc)) if (board.id === id) return board
  return undefined
}

/**
 * Depth-first walk of every step in one tree, parents before children.
 *
 * Every region a container owns is walked here and nowhere else: a Fork's
 * branches, a loop body, and a `core.try`'s handler. A region this forgets is a
 * region no rule ever sees — the validator reports nothing about it, silently,
 * which is the same failure as a validator that only ever looked at the root
 * Board.
 */
export function* walkSteps(steps: readonly Step[]): Generator<Step> {
  for (const step of steps) {
    yield step
    for (const branch of step.branches ?? []) yield* walkSteps(branch.steps)
    if (step.steps) yield* walkSteps(step.steps)
    if (step.handler) yield* walkSteps(step.handler)
  }
}

/**
 * Every Step in the document, tagged with the Board it is on.
 *
 * `walkSteps` is the primitive — "walk this list" — and this is what supplies it
 * every list there is. A rule written against this one gains Block coverage by
 * construction rather than by remembering to ask for it.
 */
export function* walkDocument(doc: WorkflowDefinition): Generator<StepRef & { step: Step }> {
  for (const board of boards(doc)) {
    for (const step of walkSteps(board.steps)) yield { step, board: board.id, id: step.id }
  }
}

/**
 * One string naming one Step, for the places that need a flat key — a `Map`, a
 * React key, a `data-` attribute.
 *
 * Minted here rather than concatenated at each call site: five hand-rolled
 * spellings are five chances to pick a different separator, and two of them
 * disagreeing is a diagnostic filed under a key nothing looks up. `/` is safe
 * because the schema holds every id to an identifier, which cannot contain one.
 */
export const stepKey = ({ board, id }: StepRef): string => (board === null ? id : `${board}/${id}`)

/** A Step by Board and id. Both halves are needed: ids are Board-local. */
export function findStep(doc: WorkflowDefinition, ref: StepRef): Step | undefined {
  const board = boardOf(doc, ref.board)
  if (!board) return undefined
  for (const step of walkSteps(board.steps)) if (step.id === ref.id) return step
  return undefined
}

/**
 * The variables one Board declares: the workflow's at the root, a Block's inside
 * one.
 *
 * This is the whole of "a `core.set_var` can never reach out of the Board it is
 * on" — there is no second list to fall back to, so a Block naming a workflow
 * variable is an unknown name rather than a scope a runner resolves differently.
 *
 * Exported because a runner has to answer the same question the builder does,
 * and the Go SDK's `VarsOn` is this function: a rule restated at two call sites
 * is two rules the day one of them gains a fallback.
 */
export const varsOn = (doc: WorkflowDefinition, board: BoardId): readonly Variable[] =>
  board === null ? (doc.vars ?? []) : (boardOf(doc, board)?.block?.vars ?? [])

/** One Board's variable by key, or undefined when that Board declares none. */
export const variableOn = (
  doc: WorkflowDefinition,
  board: BoardId,
  key: string,
): Variable | undefined => varsOn(doc, board).find((variable) => variable.key === key)

/** Every step id on one Board, for detecting references to steps that vanished. */
export function stepIds(doc: WorkflowDefinition, board: BoardId): Set<string> {
  const found = boardOf(doc, board)
  return new Set(found ? [...walkSteps(found.steps)].map((step) => step.id) : [])
}
