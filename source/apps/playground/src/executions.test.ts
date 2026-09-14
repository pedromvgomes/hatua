import { workflowExecution } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { createLocalExecutionSource } from './executions'
import { createMemoryWorkflowStore, SEED } from './workflow-store'

/**
 * The playground's run history, held to two things a fake can quietly stop
 * doing.
 *
 * **It has to satisfy the schema.** Nothing in the app validates a
 * `WorkflowExecution` — Hatua renders what the Host hands over — so a fixture
 * that drifts from the contract is a screen that renders wrongly with nothing
 * saying why. This is the only thing checking it.
 *
 * **It has to name Steps the document actually holds.** The records are derived
 * from the version rather than written down precisely so the marks survive an
 * edit to the seed; a fixture that stopped doing that would leave every card
 * unmarked, which looks exactly like a broken Runs view.
 */

const stepIds = (yaml: string): string[] => {
  const definition = parse(yaml) as { steps?: { id: string }[] }
  return (definition.steps ?? []).map((step) => step.id)
}

const source = () => createLocalExecutionSource(createMemoryWorkflowStore())

/** The list has to be read first: it is what says which version to draw against. */
const opened = async (index = 0) => {
  const runs = source()
  const page = await runs.listExecutions('wf_morning')
  const runId = page.items[index]?.runId
  if (!runId) throw new Error('The fixture served no runs.')
  return runs.loadExecution(runId)
}

describe('the fake run history', () => {
  it('serves records that satisfy the contract', async () => {
    const execution = await opened()

    const parsed = workflowExecution.safeParse(execution)
    expect(parsed.error?.issues).toBeUndefined()
    expect(parsed.success).toBe(true)
  })

  it('names the Steps the seed actually holds, so the map marks real cards', async () => {
    const execution = await opened()

    // Derived from the version rather than written down: hard-coded ids stop
    // matching the moment anybody edits the seed, and every card comes back
    // unmarked while the view is working perfectly.
    expect(execution.steps.map((one) => one.id)).toEqual(stepIds(SEED))
  })

  it('references a version rather than embedding a definition', async () => {
    const execution = await opened()

    expect(execution.workflow.version).toBeGreaterThan(0)
    expect('definition' in execution).toBe(false)
  })

  it('gives a loop one record per pass, which is what iterations is for', async () => {
    const execution = await opened()

    // `s4` is the seed's `core.for_each`. A flat `stepId -> status` list cannot
    // say "succeeded twice and failed once", and the card beside the map shows
    // the count because of it.
    const loop = execution.steps.find((one) => one.id === 's4')
    expect(loop?.iterations).toHaveLength(3)
    expect(loop?.iterations?.[0]?.steps?.[0]?.id).toBe('s5')
  })

  it('fails part-way rather than at the first Step, so the map has something to say', async () => {
    const execution = await opened(0)

    expect(execution.status).toBe('failed')
    const failed = execution.steps.filter((one) => one.status === 'failed')
    const skipped = execution.steps.filter((one) => one.status === 'skipped')
    expect(failed).toHaveLength(1)
    // Something ran before it and something was skipped after it, which is the
    // shape that makes a run worth drawing on a canvas at all.
    expect(execution.steps[0]?.status).toBe('succeeded')
    expect(skipped.length).toBeGreaterThan(0)
  })

  it('reads the same run twice the same way', async () => {
    // A pane that renders different numbers each time it is opened teaches the
    // reader to distrust the screen.
    expect(await opened()).toEqual(await opened())
  })

  it('pages, because run history is the list that cannot be drained', async () => {
    const runs = source()
    const first = await runs.listExecutions('wf_morning')
    expect(first.next).toBeDefined()

    const second = await runs.listExecutions('wf_morning', first.next)
    expect(second.items.length).toBeGreaterThan(0)
    expect(second.next).toBeUndefined()

    const ids = [...first.items, ...second.items].map((one) => one.runId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('refuses a cursor it never issued', async () => {
    const runs = source()
    await expect(runs.listExecutions('wf_morning', 'nonsense')).rejects.toThrow()
  })
})
