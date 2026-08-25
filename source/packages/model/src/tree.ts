import type { Block, Branch, Step, Variable, WorkflowDefinition } from '@hatua/schema'

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

/** A position among a list of sibling Steps, named in domain terms rather than YAML paths. */
export interface InsertPoint {
  /**
   * Which Board the position is on: a Block's id, or absent for the root.
   *
   * Every path below is rooted here rather than at `['steps']`. That single
   * parameter is what makes an edit on a Block's Board the same command as an
   * edit on the root's — which is the property the extract-into-a-block gesture
   * needs, and what keeps a Block built on the canvas and one hand-written in
   * Text Mode the same document.
   */
  board?: BoardId
  /**
   * The container Step whose children receive it. Absent for the Board's
   * root sequence.
   */
  parentId?: string
  /**
   * Which of a `core.fork`'s branches, by index. Absent for a `core.for_each`'s
   * own nested `steps`, and absent at the root.
   */
  branchIndex?: number
  /**
   * Which of a `core.try`'s two regions. Absent means the body under `steps:`,
   * which is the same key a loop's children sit under.
   *
   * A named region rather than a second index, because the two are not a list:
   * a try has exactly one body and exactly one handler, and an index would let
   * a caller ask for the third one.
   */
  region?: 'handler'
  /** Position among the siblings. The list's length appends. */
  index: number
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
 * The verb that protects a region and falls back to a handler.
 *
 * The one container with two child regions: a body under `steps:` and a handler
 * under `handler:`. Wrapping one Step is retry, wrapping a region is fallback,
 * so one verb serves both (ADR-0013).
 *
 * Its retry policy — how many attempts, how long to wait — sits in `with:` as
 * ordinary manifest fields, and deliberately NOT in a structural key. `until`
 * had to leave `with:` because `FIELD_KIND_TYPES` has no mappable boolean, so a
 * condition there would have type-checked as text. An attempt count is a number
 * and `number` IS a mappable field kind, so the argument that moved `until` does
 * not reach here at all — following it anyway would be copying a conclusion
 * without its reason, and would cost a structural key, a diagnostic and a form
 * control that the manifest already gives for nothing.
 *
 * It sits beside the region vocabulary rather than beside the other verbs
 * because the only question anything asks it is which word goes over a region:
 * `steps:` is one key holding a loop's children and a try's protected body
 * alike, and this is what tells them apart.
 */
export const TRY_VERB = 'core.try'

/** Which of a container's child regions a step list is. */
export type RegionKind = 'branch' | 'body' | 'handler'

/**
 * One child region a container Step owns, and which region it is.
 *
 * A Fork contributes one per Branch, a `core.for_each` and a `core.repeat` one
 * body each, and a `core.try` two — a body under `steps:` and a handler under
 * `handler:` (ADR-0013).
 */
export interface Region {
  readonly kind: RegionKind
  readonly steps: readonly Step[]
  /**
   * The word that goes over this region — `if` / `else if` / `else` / `and`
   * over a Branch, `try` or `loop` over a body, `on failure` over a handler.
   *
   * Here rather than at each surface, because two surfaces draw every region:
   * `<StepList>` puts it in a chip over the region and the canvas puts it in
   * the band above it, and a word each works out for itself is a word they can
   * disagree about. `kind` says which region this is and this says what it is
   * called, so a reader gains both by construction.
   *
   * The verb decides the word and never whether the region exists. A `handler:`
   * on a `core.fork` is meaningless and no runner reads it, but `walkSteps`
   * still yields the Steps inside it, so a surface refusing to draw it makes
   * those Steps unreachable rather than absent.
   */
  readonly keyword: string
  /** The Branch this region is. Absent on a body and on a handler. */
  readonly branch?: Branch
}

/**
 * The regions one Step owns, in document order.
 *
 * The single answer to "what does this Step nest". Every traversal of the tree
 * asks that question, and one that answers it for itself is one that can forget
 * a region — a region no rule then sees, reported by nothing, in silence. That
 * has to be spelled out once so a reader gains coverage of a new region by
 * construction rather than by remembering to ask for it.
 *
 * The region is named rather than yielded as a bare list because a reader that
 * draws differently per region — branches side by side, a try's two regions
 * stacked under their own labels — still has to get its regions from here.
 */
export function* regionsOf(step: Step): Generator<Region> {
  const branches = step.branches ?? []
  for (const [index, branch] of branches.entries()) {
    yield { kind: 'branch', keyword: branchKeyword(branches, index), branch, steps: branch.steps }
  }
  if (step.steps) yield { kind: 'body', keyword: bodyKeyword(step), steps: step.steps }
  if (step.handler) yield { kind: 'handler', keyword: 'on failure', steps: step.handler }
}

/**
 * `if` / `else if` / `else` for a condition fork, `and` for a parallel one.
 *
 * Read from the branches rather than from a mode field, because the schema has
 * no mode field: `when` is "absent on the fallback branch of a condition fork —
 * order matters there, first match wins, and the last branch may be
 * unconditional". A fork where no branch carries `when` is the parallel one.
 *
 * Presence and not truthiness. The distinction the schema draws is absent
 * versus present, so a branch whose condition is still empty is a branch with a
 * condition on it — one nobody has written yet. Read as falsy, a Fork born
 * carrying `when: ''` on its first branch renders `and` / `and` and calls
 * itself parallel, which is the one thing it is not.
 */
function branchKeyword(branches: readonly Branch[], index: number): string {
  if (!branches.some((branch) => branch.when !== undefined)) return 'and'
  if (branches[index]?.when !== undefined) return index === 0 ? 'if' : 'else if'
  return 'else'
}

/**
 * `try` over a `core.try`'s protected region, `loop` over everything else's.
 *
 * `steps:` is one key holding two different ideas, so the word comes from the
 * verb rather than from the key. Reading "loop" over the Steps a try is
 * protecting would name the wrong control flow.
 */
const bodyKeyword = (step: Step): string => (step.use === TRY_VERB ? 'try' : 'loop')

/**
 * Whether a Step owns child regions at all.
 *
 * Asked of `regionsOf` rather than of the three keys, so "container" and "what a
 * container nests" cannot come apart — a fourth region would otherwise be
 * walked by every reader while still reading as a leaf to whichever surface
 * decides how tall a card is or whether it collapses.
 */
export const isContainer = (step: Step): boolean => !regionsOf(step).next().done

/**
 * What a Step is called on screen: its name, falling back to its id.
 *
 * An id is the one thing a Step always has, and it is what a user typed if they
 * hand-wrote the file. Here rather than at each surface because the list, the
 * canvas and every sentence a screen reader hears have to name one Step one
 * way — two spellings is a card and a row that look like two Steps.
 */
export const nameOf = (step: Step): string => step.name || step.id

/**
 * What makes a Step structural, in words: `core.fork · 2 branches`,
 * `core.try · 1 step · handler`.
 *
 * Enumerated off `regionsOf` rather than off the three step keys, so a region
 * added to the walk shows up in the summary by construction. A summary read off
 * `steps:` alone says `core.try` on a try carrying only a handler — a card with
 * a chevron and an `on failure` region under it, describing itself as a leaf.
 *
 * A leaf's summary is its verb and nothing else, which is why the canvas shows
 * this only on the cards `isContainer` makes taller: `LAYOUT.nodeHeight` is "a
 * card with a name and nothing else", so a leaf card has nowhere to put a row.
 * One predicate decides the height and the content, and they cannot come apart.
 */
export function summaryOf(step: Step): string {
  const regions = [...regionsOf(step)]
  const parts = [step.use]

  const branches = regions.filter((region) => region.kind === 'branch').length
  if (branches > 0) parts.push(`${branches} ${branches === 1 ? 'branch' : 'branches'}`)

  for (const region of regions) {
    if (region.kind === 'branch') continue
    if (region.kind === 'handler') parts.push('handler')
    else parts.push(`${region.steps.length} ${region.steps.length === 1 ? 'step' : 'steps'}`)
  }

  return parts.join(' · ')
}

/**
 * Depth-first walk of every step in one tree, parents before children.
 *
 * Every region a container owns is walked here and nowhere else. A region
 * `regionsOf` forgets is a region no rule ever sees — the validator reports
 * nothing about it, silently, which is the same failure as a validator that
 * only ever looked at the root Board.
 */
export function* walkSteps(steps: readonly Step[]): Generator<Step> {
  for (const step of steps) {
    yield step
    for (const region of regionsOf(step)) yield* walkSteps(region.steps)
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
