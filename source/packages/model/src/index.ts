import type { Step, WorkflowDefinition } from '@hatua/schema'

/**
 * Pure domain rules over the step tree. No state, no I/O, no YAML — those live
 * in @hatua/document. Everything here is a function of the typed projection.
 */

/** Depth-first walk of every step in the tree, parents before children. */
export function* walkSteps(steps: readonly Step[]): Generator<Step> {
  for (const step of steps) {
    yield step
    for (const branch of step.branches ?? []) yield* walkSteps(branch.steps)
    if (step.steps) yield* walkSteps(step.steps)
  }
}

export function findStep(doc: WorkflowDefinition, id: string): Step | undefined {
  for (const step of walkSteps(doc.steps)) if (step.id === id) return step
  return undefined
}

/**
 * The steps a given step may reference: its ancestors and the earlier siblings
 * of every ancestor. Sibling branches are deliberately out of scope, so a user
 * cannot express a mapping that could not resolve at run time.
 */
export function upstreamOf(doc: WorkflowDefinition, id: string): Step[] {
  const found = collectUpstream(doc.steps, id, [])
  return found ?? []
}

function collectUpstream(steps: readonly Step[], id: string, ancestors: Step[]): Step[] | null {
  const earlier: Step[] = []
  for (const step of steps) {
    if (step.id === id) return [...ancestors, ...earlier]

    const nested = [...(step.branches ?? []).map((b) => b.steps), step.steps ?? []]
    for (const children of nested) {
      const hit = collectUpstream(children, id, [...ancestors, ...earlier, step])
      if (hit) return hit
    }
    earlier.push(step)
  }
  return null
}
