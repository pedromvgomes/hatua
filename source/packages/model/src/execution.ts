import type { WorkflowExecution } from '@hatua/schema'

/**
 * Reading a **Workflow Execution** against the definition it references.
 *
 * Here rather than in a region for the reason `regionsOf` is here: the card on
 * the map, the pane beside it and any viewer a **Host** writes all ask the same
 * two questions — which records belong to a Step, and what one status stands for
 * them — and three answers to that is a card reading `failed` beside a pane
 * reading `succeeded`.
 */

/** One Step's record, as the schema shapes it. */
export type StepRecord = WorkflowExecution['steps'][number]

export type RunStatus = StepRecord['status']

/**
 * Every record a Step has in one execution.
 *
 * More than one when it sits inside a loop: `core.for_each` runs its children
 * once per item, so a flat `stepId -> status` list cannot say "succeeded 23
 * times and failed once", and the schema gives each pass its own record with its
 * own nested results.
 *
 * The walk descends into iterations and nowhere else, because that is the only
 * nesting an execution has — a **Fork**'s branches are nesting in the
 * definition rather than in the record, and the Steps that ran inside one are
 * reported flat.
 */
export function recordsFor(execution: WorkflowExecution, stepId: string): StepRecord[] {
  const found: StepRecord[] = []
  const visit = (steps: readonly StepRecord[] | undefined) => {
    for (const step of steps ?? []) {
      if (step.id === stepId) found.push(step)
      for (const iteration of step.iterations ?? []) visit(iteration.steps)
    }
  }
  visit(execution.steps)
  return found
}

/**
 * How bad a status is, so several records collapse to the one a card can show.
 *
 * `succeeded` outranks `skipped` deliberately: a Step that ran twenty-three
 * times and was skipped on the twenty-fourth pass did run, and reading `skipped`
 * on its card would say it never did. Everything above them is a state a reader
 * has to see whatever else happened, which is why `failed` is the top.
 */
const SEVERITY: Record<RunStatus, number> = {
  failed: 4,
  running: 3,
  pending: 2,
  succeeded: 1,
  skipped: 0,
}

/**
 * The one status a Step's card shows, or null when the Step has no record at
 * all.
 *
 * Null is a real answer and not a missing one: a Step inside a **Branch** that
 * was not taken never ran, and the version the run is drawn against still holds
 * it. An unmarked card is what says so.
 */
export function statusOf(records: readonly StepRecord[]): RunStatus | null {
  let worst: RunStatus | null = null
  for (const record of records) {
    if (!worst || SEVERITY[record.status] > SEVERITY[worst]) worst = record.status
  }
  return worst
}

/** The log entries belonging to one Step, in the order the Host reported them. */
export function logFor(execution: WorkflowExecution, stepId: string) {
  return (execution.log ?? []).filter((entry) => entry.step === stepId)
}
