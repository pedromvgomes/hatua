import type { Slot } from '@hatua/expressions'
import type { Block, Declaration, Step, WorkflowDefinition } from '@hatua/schema'
import { own, regionsOf, type StepRef, walkDocument } from './tree'

/**
 * Blocks: what a call takes, what a return publishes, and which Blocks reach
 * which.
 *
 * A Block is invoked as `use: block.<id>` rather than by a verb of its own —
 * ADR-0014 gives the verb namespace three roots, and "declared in this document"
 * is one of them, so calling costs a namespace rather than a fourth structural
 * verb (ADR-0013).
 */

/** The root that says a verb names a Block in this document. */
export const BLOCK_PREFIX = 'block.'

/** The verb that publishes a Block's declared outputs and ends it. */
export const RETURN_VERB = 'core.return'

/** The Block a verb names, or null when it names something else. */
export const blockIdOf = (use: string): string | null =>
  use.startsWith(BLOCK_PREFIX) ? use.slice(BLOCK_PREFIX.length) : null

/** One Block by id. */
export const blockOf = (doc: WorkflowDefinition, id: string): Block | undefined =>
  doc.blocks?.find((block) => block.id === id)

/**
 * The Slots a call's `with:` map resolves into: one per declared parameter,
 * typed by the declaration.
 *
 * Deliberately NOT routed through a synthesized Component Manifest. A manifest
 * field carries a rendering `kind` and no type, so
 * `slotsFor` recovers the expected type from `FIELD_KIND_TYPES` — and that
 * vocabulary cannot express "a Template that must produce a boolean" at all,
 * because `bool` holds a literal rather than a Template. Synthesizing a manifest
 * would therefore have thrown away exactly the half of the contract the call
 * site exists to check. A declaration's `t` IS the expected type, which is what
 * a Slot has always been (CONTEXT.md): a Template together with the type it must
 * produce.
 *
 * The rendering kind is a screen's problem and is derived where the screen is.
 */
export const callSlots = (step: Step, block: Block): Slot[] => declaredSlots(block.params, step)

/**
 * The Slots a `core.return`'s `with:` map resolves into: one per declared
 * output of the Block it sits on.
 *
 * `core.return` is the mirror of `core.map`. A mapping's *outputs* come from its
 * own field values because no manifest can declare them; a return's *inputs*
 * come from the enclosing Block's `outputs:` for the same reason — they are
 * whatever that Block promised, and no manifest knows which Block a step is on.
 */
export const returnSlots = (step: Step, block: Block): Slot[] => declaredSlots(block.outputs, step)

const declaredSlots = (declarations: readonly Declaration[] | undefined, step: Step): Slot[] => {
  const values = (step.with ?? {}) as Record<string, unknown>
  const slots: Slot[] = []

  for (const declaration of declarations ?? []) {
    const template = own(values, declaration.k)
    // A parameter nobody filled in is reported as missing by its own rule.
    // Resolving `undefined` as a Template would report a parse error instead,
    // which names the wrong problem in a place the user cannot act on.
    if (typeof template !== 'string') continue
    slots.push({ name: declaration.k, template, expectedType: declaration.t })
  }

  return slots
}

/**
 * Which Blocks a Block reaches directly, in document order.
 *
 * Reads the whole Board rather than its top level: a call nested inside a Fork
 * branch, a loop body or a `core.try`'s handler still reaches, which is the
 * entire point of asking. A region missing from this walk is a region recursion
 * can hide in: the call graph comes out short an edge, the cycle is not found,
 * and the document publishes.
 */
export function callsOf(steps: readonly Step[]): string[] {
  const found: string[] = []
  const walk = (list: readonly Step[]) => {
    for (const step of list) {
      const id = blockIdOf(step.use)
      if (id !== null) found.push(id)
      for (const region of regionsOf(step)) walk(region.steps)
    }
  }
  walk(steps)
  return found
}

/**
 * The Blocks that take part in a cycle, by id.
 *
 * ADR-0013 refuses recursion because "unbounded recursion is the jump problem
 * wearing a contract's clothes" — so this is a design-time answer rather than a
 * depth limit a runner discovers. Direct and indirect are one question: a Block
 * that reaches itself through any chain is in a cycle, and a colour-marked
 * depth-first walk answers both without a second traversal.
 */
export function cyclicBlocks(doc: WorkflowDefinition): Set<string> {
  // First-wins, matching `blockOf` — `Map.set` would let the LAST block under a
  // repeated id decide what the call graph is while every other reader acts on
  // the first, so recursion would be analysed against one block's steps and
  // reported against another's.
  const edges = new Map<string, string[]>()
  for (const block of doc.blocks ?? []) {
    if (edges.has(block.id)) continue
    edges.set(block.id, callsOf(block.steps))
  }

  /*
   * Tarjan's strongly connected components, and not the path-slice walk this
   * question invites.
   *
   * A depth-first walk that marks "everything from where this id reappears" is
   * right about the cycle it is standing on and blind to every cycle that closes
   * through a node it has already finished. With `b1 → b2`, `b2 → b3, b4`,
   * `b3 → b1` and `b4 → b3`, the walk proves `b1 → b2 → b3 → b1`, finishes `b3`,
   * and then meets `b3` again from `b4` as a *finished* node — so `b4` is never
   * marked, though `b4 → b3 → b1 → b2 → b4` is as much a cycle as the first.
   *
   * An SCC is exactly the right shape for the question: two Blocks are in one
   * component when each reaches the other, which is what "takes part in a cycle"
   * means. A Block that merely *reaches* a cycle is a component of its own and
   * stays unmarked, which is the distinction the old walk got right and this
   * keeps.
   */
  const cyclic = new Set<string>()
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  let counter = 0

  const visit = (id: string) => {
    index.set(id, counter)
    low.set(id, counter)
    counter += 1
    stack.push(id)
    onStack.add(id)

    for (const next of edges.get(id) ?? []) {
      // A call to a block nothing declares is not an edge: BLOCK_UNKNOWN reports
      // it, and following it here would invent a node with no calls of its own.
      if (!edges.has(next)) continue
      if (!index.has(next)) {
        visit(next)
        low.set(id, Math.min(low.get(id) ?? 0, low.get(next) ?? 0))
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id) ?? 0, index.get(next) ?? 0))
      }
    }

    if (low.get(id) !== index.get(id)) return

    const component: string[] = []
    let member: string | undefined
    do {
      member = stack.pop()
      if (member === undefined) break
      onStack.delete(member)
      component.push(member)
    } while (member !== id)

    // A component of one is a cycle only when the Block calls itself: every
    // other single Block reaches a cycle at most, and is not on one.
    const callsItself = component.length === 1 && (edges.get(id) ?? []).includes(id)
    if (component.length > 1 || callsItself) for (const one of component) cyclic.add(one)
  }

  for (const id of edges.keys()) if (!index.has(id)) visit(id)
  return cyclic
}

/**
 * Every Step that calls a Block, on every Board including the Block's own.
 *
 * The other direction from `callsOf`, and it walks the whole document rather
 * than one Board: a call sits wherever somebody wrote it, and a count that only
 * looked at the root would tell a user deleting a Block that nothing calls it
 * while two other Blocks do.
 */
export function callSitesOf(doc: WorkflowDefinition, id: string): StepRef[] {
  const found: StepRef[] = []
  for (const { step, board, id: stepId } of walkDocument(doc)) {
    if (blockIdOf(step.use) === id) found.push({ board, id: stepId })
  }
  return found
}

/**
 * What a Block takes and publishes, in a line: `1 param · 2 outputs`.
 *
 * One definition because two surfaces say it — the canvas's root node for the
 * Board a Block opens, and the card that Board is reached from. Two spellings
 * of the same count read as two different facts about one Block.
 *
 * An absent Block reads as a contract of nothing rather than as an empty
 * string: a Board resolved against a document that no longer declares it still
 * draws a node, and a summary that vanishes reads as a Board with no contract
 * instead of one that is not there.
 */
export const contractSummary = (block: Block | undefined): string => {
  const params = block?.params?.length ?? 0
  const outputs = block?.outputs?.length ?? 0
  return `${params} ${params === 1 ? 'param' : 'params'} · ${outputs} ${outputs === 1 ? 'output' : 'outputs'}`
}
