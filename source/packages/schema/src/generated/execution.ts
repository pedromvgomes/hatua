// GENERATED — do not edit.
// Source: schemas/workflow-execution.schema.yaml
// Regenerate: pnpm codegen
import { z } from 'zod'

export const stepExecution = z.strictObject({
  /**
   * Matches a `Step.id` in the referenced definition version.
   */
  id: z.string().min(1),
  status: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']),
  duration_ms: z.number().min(0).optional(),
  /**
   * The step's inputs with every Reference replaced by the value it received.
   */
  resolved_input: z.unknown().optional(),
  output: z.unknown().optional(),
  /**
   * Values for the keys this step's component declares under `metadata` in its manifest. The manifest supplies the label, type, unit, and whether each key is a measure or a dimension; this carries only the values, so the UI renders any component's metadata generically.
   */
  metadata: z.record(z.string(), z.unknown()).optional(),
  get error() {
    return error.optional()
  },
  /**
   * Present only on loop steps. `core.for_each` runs its children once per item, so a flat `stepId -> status` list cannot express "this step succeeded 23 times and failed once". Each pass gets its own record with its own nested step results.
   */
  get iterations() {
    return z.array(iteration).optional()
  },
})
export type StepExecution = z.infer<typeof stepExecution>

export const iteration = z.strictObject({
  index: z.number().int().min(0),
  status: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']),
  duration_ms: z.number().min(0).optional(),
  get steps() {
    return z.array(stepExecution).optional()
  },
  get error() {
    return error.optional()
  },
})
export type Iteration = z.infer<typeof iteration>

export const error = z.strictObject({
  message: z.string(),
  /**
   * Stable machine code, so the UI can react without parsing prose.
   */
  code: z.string().optional(),
})
export type Error = z.infer<typeof error>

export const logEntry = z.strictObject({
  at: z.iso.datetime({ offset: true }),
  /**
   * Optional — run-level entries have no step.
   */
  step: z.string().optional(),
  /**
   * Free-form origin label, e.g. `email`, `error`.
   */
  channel: z.string().optional(),
  message: z.string(),
})
export type LogEntry = z.infer<typeof logEntry>

/**
 * The record of one run of a Workflow Definition, handed to Hatua by the Host and rendered as run history. Read-only: Hatua never produces one, because it never executes anything.
 * An execution REFERENCES its definition by version rather than embedding it. That is why published versions are immutable and retained — painting a three-week-old run against today's definition would put durations on steps that did not exist and silently drop steps that did.
 * There is no run-level metadata block. Totals and pivots (`tokens per model`, `tokens per step`) are derived by Hatua from the per-step values below, using the `measure` / `dimension` roles the component manifests declare. That keeps runners from each inventing their own summary shape.
 */
export const workflowExecution = z.strictObject({
  run_id: z.string().min(1),
  status: z.enum(['running', 'succeeded', 'failed']),
  /**
   * Resolved through `WorkflowStore.loadVersion(id, version)`.
   */
  workflow: z.strictObject({
    id: z.string().min(1),
    version: z.number().int().min(1),
  }),
  /**
   * Which declared trigger fired, and what it delivered.
   */
  trigger: z
    .strictObject({
      /**
       * Matches a `triggers[].id` in the referenced definition.
       */
      id: z.string().min(1),
      payload: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  started_at: z.iso.datetime({ offset: true }),
  finished_at: z.iso.datetime({ offset: true }).optional(),
  duration_ms: z.number().min(0).optional(),
  get steps() {
    return z.array(stepExecution)
  },
  get log() {
    return z.array(logEntry).optional()
  },
})
export type WorkflowExecution = z.infer<typeof workflowExecution>
