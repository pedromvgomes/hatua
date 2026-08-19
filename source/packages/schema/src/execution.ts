import { z } from 'zod'

/**
 * A Workflow Execution — the record of one run, handed to Hatua by the Host and
 * rendered as run history. Read-only: Hatua never produces one, because it
 * never executes anything.
 */

export const stepStatus = z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped'])
export type StepStatus = z.infer<typeof stepStatus>

export const runStatus = z.enum(['running', 'succeeded', 'failed'])
export type RunStatus = z.infer<typeof runStatus>

export const stepExecution = z.object({
  /** Matches Step.id in the Workflow Definition this run came from. */
  stepId: z.string().min(1),
  status: stepStatus,
  durationMs: z.number().nonnegative().optional(),
  /** The step's inputs with every Reference replaced by the value it received. */
  resolvedInput: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
})
export type StepExecution = z.infer<typeof stepExecution>

export const executionLogEntry = z.object({
  at: z.string(),
  channel: z.string(),
  message: z.string(),
})
export type ExecutionLogEntry = z.infer<typeof executionLogEntry>

export const workflowExecution = z.object({
  runId: z.string().min(1),
  workflowId: z.string().min(1),
  status: runStatus,
  startedAt: z.string(),
  durationMs: z.number().nonnegative().optional(),
  steps: z.array(stepExecution),
  log: z.array(executionLogEntry).optional(),
})
export type WorkflowExecution = z.infer<typeof workflowExecution>
