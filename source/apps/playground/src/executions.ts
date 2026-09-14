import type { Cursor, ExecutionSource, ExecutionSummary, WorkflowStore } from '@hatua/react'
import type { Step, WorkflowDefinition, WorkflowExecution } from '@hatua/schema'
import { parse } from 'yaml'

/**
 * A Host's run history, faked well enough to be worth looking at.
 *
 * ## Why the records are derived rather than written down
 *
 * A **Workflow Execution** references its definition by version, and the canvas
 * draws it against that version — so a fixture with hard-coded step ids marks
 * nothing the moment anybody edits the seed, adds a Step, or renames one. Every
 * card comes back unmarked and the view looks broken when it is working
 * perfectly.
 *
 * So this reads the version through the same `WorkflowStore` the designer reads,
 * walks the Steps it actually holds, and mints a record per Step. Edit the
 * workflow, publish, run it again here, and the marks follow.
 *
 * ## What each run is for
 *
 * The list is small and each row is a different thing to look at: one that
 * failed part-way, one still running, and two that succeeded. A history where
 * every run looks the same shows none of what the view is for — which is the
 * same argument the workflow and catalogue switchers on `/host.html` make.
 */

/** How a run went, which decides what its records say. */
type Shape = 'succeeded' | 'failed' | 'running'

interface Plan {
  runId: string
  shape: Shape
  /** Minutes before now, so the list is stable within a session and reads as history. */
  agoMinutes: number
  durationMs?: number
}

/**
 * Deliberately more than one page. `VERSIONS_PER_PAGE`'s argument applies here
 * with more force: run history is the list `ports.ts` names when it says every
 * unbounded list is paged, and a fixture that fits in one page never exercises
 * the cursor a real Host would need.
 */
const PER_PAGE = 3

const PLANS: Plan[] = [
  { runId: 'run_8f215', shape: 'failed', agoMinutes: 12, durationMs: 1470 },
  { runId: 'run_7c9d0', shape: 'running', agoMinutes: 3 },
  { runId: 'run_6b4e1', shape: 'succeeded', agoMinutes: 74, durationMs: 920 },
  { runId: 'run_5a1c7', shape: 'succeeded', agoMinutes: 1_450, durationMs: 74_000 },
  { runId: 'run_4d8b3', shape: 'succeeded', agoMinutes: 2_890, durationMs: 1_130 },
]

/** Fixed at module load, so a run does not creep down the list while it is open. */
const STARTED = Date.now()

const startedAt = (plan: Plan) => new Date(STARTED - plan.agoMinutes * 60_000).toISOString()

/**
 * A number that is the same every time for the same inputs.
 *
 * Durations and token counts have to look plausible and must not change between
 * two reads of one run — a pane that renders different numbers each time it is
 * opened is a fixture teaching the reader to distrust the screen.
 */
const jitter = (seed: string, low: number, high: number): number => {
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return low + ((hash >>> 0) % (high - low + 1))
}

/** The verbs whose manifests declare metadata in this playground's catalogue. */
const AGENT = 'component.agent.act'

const isLoop = (step: Step) => step.use === 'core.for_each' || step.use === 'core.repeat'

/**
 * One Step's record, and its children's when it loops.
 *
 * The failing run fails on the LAST Step that has a record, and everything after
 * it is `skipped` — which is what a runner does, and what makes the map worth
 * reading: a run where the failure is invisible in the shape of the marks is a
 * run the canvas adds nothing to.
 */
function recordFor(
  step: Step,
  shape: Shape,
  failingId: string | null,
  reached: boolean,
): WorkflowExecution['steps'][number] {
  const failed = reached && step.id === failingId
  const status = !reached
    ? 'skipped'
    : failed
      ? 'failed'
      : shape === 'running'
        ? 'running'
        : 'succeeded'

  const record: Record<string, unknown> = { id: step.id, status }

  if (status !== 'skipped' && status !== 'running') {
    record.duration_ms = jitter(step.id, 40, 2400)
  }

  if (status !== 'skipped') {
    record.resolved_input = {
      // The Templates in `with:` with their References already replaced, which
      // is the one thing the definition itself cannot show.
      ...Object.fromEntries(
        Object.entries((step.with ?? {}) as Record<string, unknown>).map(([key, value]) => [
          key,
          typeof value === 'string' && value.includes('{{')
            ? `(resolved) ${value.replace(/\{\{|\}\}/g, '').trim()}`
            : value,
        ]),
      ),
    }
  }

  if (status === 'succeeded') {
    record.output = { ok: true, id: `${step.id}_${jitter(step.id, 1000, 9999)}` }
  }

  if (failed) {
    record.error = {
      message: 'The mailbox refused the message.',
      code: 'UPSTREAM_REJECTED',
    }
  }

  // Only where the catalogue declares metadata keys, because the pane renders
  // the values against the manifest's labels and units and has nothing to call
  // a key nobody declared.
  if (step.use === AGENT && status !== 'skipped') {
    record.metadata = {
      tokens: jitter(`${step.id}t`, 300, 2400),
      model: jitter(step.id, 0, 1) === 0 ? 'claude-haiku-4-5' : 'claude-sonnet-5',
    }
  }

  if (isLoop(step)) {
    /*
     * A loop's children get one record per pass, which is the whole reason
     * `iterations` exists: a flat `stepId -> status` list cannot say "succeeded
     * three times and failed once". Three passes, with the last one carrying the
     * failure on a failed run, so the card shows the count beside the worst.
     */
    const passes = 3
    record.iterations = Array.from({ length: passes }, (_, index) => {
      const lastPass = index === passes - 1
      const passFailed = shape === 'failed' && lastPass
      return {
        index,
        status: passFailed ? 'failed' : shape === 'running' && lastPass ? 'running' : 'succeeded',
        duration_ms: jitter(`${step.id}${index}`, 60, 900),
        steps: (step.steps ?? []).map((child) =>
          recordFor(child, passFailed ? 'failed' : shape, passFailed ? child.id : null, true),
        ),
      }
    })
  }

  return record as WorkflowExecution['steps'][number]
}

/** The Steps on the root Board, flat — the level an execution reports at. */
const rootSteps = (definition: WorkflowDefinition): Step[] => definition.steps ?? []

function build(plan: Plan, version: number, definition: WorkflowDefinition): WorkflowExecution {
  const steps = rootSteps(definition)

  /*
   * Which Step a failed run failed on: the second, or the last when the workflow
   * is shorter than that. Not the first, because a run that fails immediately
   * leaves every card `skipped` and the map has nothing to say.
   */
  const failingId =
    plan.shape === 'failed' ? (steps[1]?.id ?? steps[steps.length - 1]?.id ?? null) : null

  /*
   * A run still going has reached part-way and no further, which is what makes
   * `pending` a status worth having: the Steps after the one in flight have not
   * been skipped, they have not happened yet.
   */
  const reachedUpTo =
    plan.shape === 'running' ? Math.max(1, Math.floor(steps.length / 2)) : steps.length

  const records = steps.map((step, index) => {
    if (plan.shape === 'running' && index > reachedUpTo) {
      return { id: step.id, status: 'pending' } as WorkflowExecution['steps'][number]
    }
    const reached = failingId === null || index <= steps.findIndex((one) => one.id === failingId)
    return recordFor(step, plan.shape, failingId, reached)
  })

  const started = startedAt(plan)

  return {
    run_id: plan.runId,
    status: plan.shape,
    workflow: { id: definition.id, version },
    trigger: {
      id: definition.triggers?.[0]?.id ?? 'overnight',
      payload: { received_at: started, from: 'accounts@example.com', attachments: 3 },
    },
    started_at: started,
    ...(plan.durationMs === undefined ? {} : { duration_ms: plan.durationMs }),
    steps: records,
    log: [
      { at: started, message: 'Run started' },
      ...records
        .filter((record) => record.status !== 'pending')
        .map((record) => ({
          at: started,
          step: record.id,
          channel: record.status === 'failed' ? 'error' : 'runner',
          message:
            record.status === 'failed'
              ? 'The mailbox refused the message.'
              : `Step ${record.id} ${record.status}`,
        })),
      ...(plan.shape === 'running' ? [] : [{ at: started, message: `Run ${plan.shape}` }]),
    ],
  } as WorkflowExecution
}

/**
 * Reads the definition through the Host's own storage, which is what makes the
 * marks land on the Steps that are actually there.
 *
 * The live **Published Version** when there is one, and the **Draft**'s number
 * otherwise: a playground that has never published still has a document, and a
 * run history that refused to answer until somebody pressed Publish would hide
 * the whole view behind a step nobody would think to take.
 */
export function createLocalExecutionSource(
  workflows: WorkflowStore,
  options: { delayMs?: number; failLoad?: boolean } = {},
): ExecutionSource {
  const wait = () =>
    options.delayMs ? new Promise<void>((done) => setTimeout(done, options.delayMs)) : undefined

  const versionToDrawAgainst = async (workflowId: string): Promise<number> => {
    const page = await workflows.listVersions(workflowId)
    const published = page.items.find((one) => one.status === 'published')
    // Newest first, so the first row is the fallback when nothing is published.
    return published?.version ?? page.items[0]?.version ?? 1
  }

  return {
    async listExecutions(workflowId, cursor): Promise<Cursor<ExecutionSummary>> {
      await wait()
      const version = await versionToDrawAgainst(workflowId)
      // Held so the row and the record cannot disagree about which version a run
      // ran against — the reader would see a map of one and a caption of the
      // other.
      lastVersion.set(workflowId, version)

      const from = cursor ? Number(cursor) : 0
      if (!Number.isInteger(from) || from < 0 || from >= PLANS.length) {
        throw new Error('That page of runs is no longer there. Try again.')
      }
      const slice = PLANS.slice(from, from + PER_PAGE)
      const next = from + PER_PAGE

      return {
        items: slice.map((plan) => ({
          runId: plan.runId,
          status: plan.shape,
          startedAt: startedAt(plan),
          ...(plan.durationMs === undefined ? {} : { durationMs: plan.durationMs }),
        })),
        ...(next < PLANS.length ? { next: String(next) } : {}),
        total: PLANS.length,
      }
    },

    async loadExecution(runId): Promise<WorkflowExecution> {
      await wait()
      if (options.failLoad) {
        throw new Error('That run is no longer available.')
      }
      const plan = PLANS.find((one) => one.runId === runId)
      if (!plan) throw new Error('No such run.')

      const workflowId = [...lastVersion.keys()][0] ?? 'wf_morning'
      const version = lastVersion.get(workflowId) ?? (await versionToDrawAgainst(workflowId))
      const yaml = await workflows.loadVersion(workflowId, version)
      const definition = parse(yaml) as WorkflowDefinition

      return build(plan, version, definition)
    },
  }
}

/**
 * Which version each workflow's runs are drawn against, remembered from the
 * list.
 *
 * `loadExecution` takes a run id and nothing else — the port's shape, because a
 * run id is globally unique to a Host — so this is where a fake gets back to the
 * workflow it belongs to.
 */
const lastVersion = new Map<string, number>()
