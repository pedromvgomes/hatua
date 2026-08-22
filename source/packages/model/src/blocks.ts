import type { Slot } from '@hatua/expressions'
import type { Block, Declaration, Step, WorkflowDefinition } from '@hatua/schema'

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
    const template = values[declaration.k]
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
 * branch or a loop body still reaches, which is the entire point of asking.
 */
export function callsOf(steps: readonly Step[]): string[] {
  const found: string[] = []
  const walk = (list: readonly Step[]) => {
    for (const step of list) {
      const id = blockIdOf(step.use)
      if (id !== null) found.push(id)
      for (const branch of step.branches ?? []) walk(branch.steps)
      if (step.steps) walk(step.steps)
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

  const cyclic = new Set<string>()
  const visiting = new Set<string>()
  const done = new Set<string>()

  const visit = (id: string, path: string[]) => {
    if (visiting.has(id)) {
      // Everything from where this id first appears is on the cycle; what came
      // before merely leads to it and is not itself recursive.
      for (const member of path.slice(path.indexOf(id))) cyclic.add(member)
      return
    }
    if (done.has(id) || !edges.has(id)) return

    visiting.add(id)
    for (const next of edges.get(id) ?? []) visit(next, [...path, id])
    visiting.delete(id)
    done.add(id)
  }

  for (const id of edges.keys()) visit(id, [])
  return cyclic
}
