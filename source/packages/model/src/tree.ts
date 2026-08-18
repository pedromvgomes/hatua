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
