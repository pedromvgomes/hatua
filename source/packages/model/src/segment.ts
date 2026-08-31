import type { Step, WorkflowDefinition } from '@hatua/schema'
import { RETURN_VERB } from './blocks'
import { type Board, type BoardId, boardOf, regionsOf, type StepRef, walkSteps } from './tree'

/**
 * A contiguous stretch of sibling **Steps** in one region of one **Board**.
 *
 * The shape a selection takes and the shape extraction consumes (ADR-0018,
 * ADR-0020). A Segment of one is a Segment: a single container together with
 * its whole body is the flattening case a Block exists for.
 *
 * ## Named by Steps, never by positions
 *
 * `{ board, steps }` and not a start index and a length. A Segment is held
 * across edits, and an index range means a Step added above it silently changes
 * which Steps are in it — the argument `RegionRef` makes about `branchIndex`,
 * which it accepts only because a Branch has no id and a Step has one.
 *
 * So contiguity is *derived* rather than stored, by `segmentSteps` against the
 * Board being drawn. What the shape does carry structurally is the **one
 * Board**: a `readonly StepRef[]` can express a selection spanning two Boards,
 * which is not a Segment and never can be, and hoisting the Board out makes
 * that unrepresentable rather than something every reader has to filter for.
 */
export interface Segment {
  readonly board: BoardId
  /** The Steps, by id, in document order. Never empty. */
  readonly steps: readonly string[]
}

/** One Step's place among its siblings: the list it sits in, and where. */
export interface Siblings {
  readonly steps: readonly Step[]
  readonly index: number
}

/**
 * The sibling list holding one Step, and its position in it.
 *
 * The whole of "are these two Steps siblings": two ids resolve to the same
 * `steps` array or they do not. Identity of the array is the test rather than a
 * path, because `regionsOf` hands the region's own list over and a Board holds
 * exactly one array per region.
 */
export function siblingsOf(board: Board, id: string): Siblings | undefined {
  const search = (steps: readonly Step[]): Siblings | undefined => {
    const index = steps.findIndex((step) => step.id === id)
    if (index !== -1) return { steps, index }
    for (const step of steps) {
      for (const region of regionsOf(step)) {
        const found = search(region.steps)
        if (found) return found
      }
    }
    return undefined
  }
  return search(board.steps)
}

/**
 * The Segment reaching from one Step to another, or `undefined` when the two
 * are not siblings.
 *
 * The *only* way a Segment of more than one Step is built, which is what makes
 * "a selection is always extractable" true by construction rather than by a
 * check somebody has to remember to run (ADR-0020). Order of the arguments does
 * not matter: a user may extend a selection upwards, and the Steps come back in
 * document order either way.
 */
export function segmentBetween(
  board: Board,
  anchorId: string,
  headId: string,
): Segment | undefined {
  const anchor = siblingsOf(board, anchorId)
  const head = siblingsOf(board, headId)
  // Array identity, not equality: two regions may hold Steps with equal
  // contents, and a Segment spanning them has no single list to become.
  if (!anchor || !head || anchor.steps !== head.steps) return undefined
  const from = Math.min(anchor.index, head.index)
  const through = Math.max(anchor.index, head.index)
  return {
    board: board.id,
    steps: anchor.steps.slice(from, through + 1).map((step) => step.id),
  }
}

/** A Segment holding one Step. */
export const segmentOf = ({ board, id }: StepRef): Segment => ({ board, steps: [id] })

/**
 * The Steps a Segment actually names on a Board, in document order.
 *
 * Every consumer's way in, and the place a Segment held across an edit is
 * reconciled with the document as it is now: a Step that has been removed drops
 * out, and what is left is still contiguous because removal closes the gap.
 *
 * Empty means the Segment names nothing on this Board — a Board that is gone, a
 * Block that was deleted, or a Segment whose every Step has been removed. A
 * caller showing a selection draws nothing for it; a caller acting on one has
 * nothing to act on.
 */
export function segmentSteps(doc: WorkflowDefinition, segment: Segment): readonly Step[] {
  const board = boardOf(doc, segment.board)
  if (!board) return []
  const wanted = new Set(segment.steps)
  // The first id that still resolves, rather than `steps[0]`: removing the
  // Segment's leading Step must not take the rest of the selection with it.
  const siblings = segment.steps.reduce<Siblings | undefined>(
    (found, id) => found ?? siblingsOf(board, id),
    undefined,
  )
  if (!siblings) return []
  return siblings.steps.filter((step) => wanted.has(step.id))
}

/**
 * Whether a Segment names this Step, for a surface deciding whether to draw a
 * card as selected.
 *
 * A Board comparison and not only an id: ids are Board-local, so two Blocks may
 * each hold a Step called `ret` and a bare id highlights both (ADR-0013).
 */
export const segmentHolds = (segment: Segment | undefined, ref: StepRef): boolean =>
  segment !== undefined && segment.board === ref.board && segment.steps.includes(ref.id)

/**
 * The Step one place from the Segment's head, in the direction given, or
 * `undefined` at the end of the sibling list.
 *
 * What `Shift`+`↑`/`↓` moves. The *head* moves and the anchor stays, so the
 * same keystroke grows a Segment and shrinks it from the other end.
 */
export function siblingFrom(board: Board, id: string, step: 1 | -1): string | undefined {
  const found = siblingsOf(board, id)
  return found?.steps[found.index + step]?.id
}

/**
 * Whether a Segment holds a `core.return`, anywhere inside it.
 *
 * What extraction refuses (ADR-0018). Moved onto a new Board, a return binds to
 * the *new* Block's `outputs:` and ends a Block the author did not mean it to
 * end — behaviour the move silently changes, with nothing malformed for a rule
 * to report. So the gesture is not offered rather than repaired.
 *
 * Nested and not only the Segment's own Steps: a return inside a Fork branch
 * inside the Segment moves with it and binds exactly the same way.
 *
 * Takes the Steps a Segment resolves to rather than the Segment, so a caller
 * that has already asked `segmentSteps` — which is every caller, because the
 * count beside the action comes from the same answer — does not resolve twice.
 * The command and the control that offers it read one rule.
 */
export const segmentReturns = (steps: readonly Step[]): boolean =>
  [...walkSteps(steps)].some((step) => step.use === RETURN_VERB)
