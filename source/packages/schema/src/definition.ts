import { z } from 'zod'

/**
 * A Workflow Definition — the declarative description of a workflow. Read and
 * written by Hatua.
 *
 * Steps form a tree, nesting through `branches:` (forks) and `steps:` (loops).
 * There is deliberately no position data: node placement is derived from the
 * tree on every render, which is what makes it impossible for a hand-edited
 * file to disagree with the flow map. See ADR-0001.
 */

/** A `{{source.path}}` token. Stored verbatim so renaming a step never breaks one. */
export const REFERENCE_PATTERN = /\{\{([^}]+)\}\}/g

export const workflowInput = z.object({
  key: z.string().min(1),
  type: z.string().min(1),
})
export type WorkflowInput = z.infer<typeof workflowInput>

/** Field values, keyed by FieldSpec.k. References remain `{{…}}` strings. */
export const stepValues = z.record(z.string(), z.unknown())
export type StepValues = z.infer<typeof stepValues>

export interface Branch {
  label: string
  /** Absent on the fallback branch of a condition fork. */
  when?: string
  steps: Step[]
}

export interface Step {
  /** Stable; this is what References point at. */
  id: string
  /** The component's YAML verb, e.g. `email.send`. */
  use: string
  name: string
  with?: StepValues
  /** Fork children. */
  branches?: Branch[]
  /** Loop children — nested directly, with no branch wrapper. */
  steps?: Step[]
}

export const step: z.ZodType<Step> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    use: z.string().min(1),
    name: z.string(),
    with: stepValues.optional(),
    branches: z.array(branch).optional(),
    steps: z.array(step).optional(),
  }),
)

export const branch: z.ZodType<Branch> = z.lazy(() =>
  z.object({
    label: z.string(),
    when: z.string().optional(),
    steps: z.array(step),
  }),
)

export const workflowDefinition = z.object({
  name: z.string(),
  id: z.string().min(1),
  inputs: z.array(workflowInput).optional(),
  vars: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(step),
})
export type WorkflowDefinition = z.infer<typeof workflowDefinition>
