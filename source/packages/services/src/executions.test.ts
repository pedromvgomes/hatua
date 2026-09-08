import type { WorkflowExecution } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import { createExecutionStore } from './executions'
import type { Cursor, ExecutionSource, ExecutionSummary } from './ports'

/**
 * The store behind the **Runs** view: an unbounded list walked a page at a time,
 * and one record held while it is read.
 *
 * Paging is the property under test rather than an implementation detail. Run
 * history is the list `ports.ts` names when it says every unbounded list is
 * paged — a workflow that runs nightly for three years cannot be drained — so
 * every failure mode a cursor has is a failure mode a reader will meet.
 */

const summary = (runId: string): ExecutionSummary => ({
  runId,
  status: 'succeeded',
  startedAt: '2026-08-18T07:00:00.000Z',
  durationMs: 1470,
})

const execution = (runId: string, version = 7): WorkflowExecution =>
  ({
    run_id: runId,
    status: 'succeeded',
    workflow: { id: 'wf_morning', version },
    started_at: '2026-08-18T07:00:00.000Z',
    steps: [{ id: 's1', status: 'succeeded' }],
  }) as WorkflowExecution

interface Fake {
  port: ExecutionSource
  lists: (string | undefined)[]
  loads: string[]
}

const host = (
  pages: Cursor<ExecutionSummary>[],
  options: { record?: WorkflowExecution; failLoad?: Error; failList?: Error } = {},
): Fake => {
  const lists: (string | undefined)[] = []
  const loads: string[] = []
  let index = 0
  return {
    lists,
    loads,
    port: {
      listExecutions(_workflowId, cursor) {
        lists.push(cursor)
        if (options.failList) return Promise.reject(options.failList)
        const page = pages[Math.min(index, pages.length - 1)]
        index += 1
        return Promise.resolve(page as Cursor<ExecutionSummary>)
      },
      loadExecution(runId) {
        loads.push(runId)
        if (options.failLoad) return Promise.reject(options.failLoad)
        return Promise.resolve(options.record ?? execution(runId))
      },
    },
  }
}

const settle = () => Promise.resolve().then(() => Promise.resolve())

describe('the list of runs', () => {
  it('fetches once however many regions ask', async () => {
    const fake = host([{ items: [summary('a')] }])
    const store = createExecutionStore(fake.port, 'wf_morning')

    store.load()
    store.load()
    await settle()

    expect(fake.lists).toEqual([undefined])
    expect(store.getSnapshot().list).toMatchObject({ status: 'ready', more: false })
  })

  it('fetches nothing until somebody asks, so a Host pays for a view nobody opens', () => {
    const fake = host([{ items: [summary('a')] }])
    createExecutionStore(fake.port, 'wf_morning')

    expect(fake.lists).toEqual([])
  })

  it('appends the next page and stops when the Host is exhausted', async () => {
    const fake = host([{ items: [summary('a')], next: 'p2' }, { items: [summary('b')] }])
    const store = createExecutionStore(fake.port, 'wf_morning')
    store.load()
    await settle()

    store.loadMore()
    await settle()

    const list = store.getSnapshot().list
    expect(list.status === 'ready' && list.executions.map((one) => one.runId)).toEqual(['a', 'b'])
    expect(list.status === 'ready' && list.more).toBe(false)
  })

  it('refuses a cursor that does not advance, rather than repeating one page for ever', async () => {
    const fake = host([
      { items: [summary('a')], next: 'p2' },
      { items: [summary('b')], next: 'p2' },
    ])
    const store = createExecutionStore(fake.port, 'wf_morning')
    store.load()
    await settle()

    store.loadMore()
    await settle()
    store.loadMore()
    await settle()

    // A cursor that repeats will repeat again, so "Show more" is taken away
    // rather than left inviting a list built out of one page said over and over.
    const list = store.getSnapshot().list
    expect(list.status === 'ready' && list.more).toBe(false)
    expect(list.status === 'ready' && list.error).not.toBeNull()
  })

  it('drops a row with no runId, because that is what a row is opened by', async () => {
    const fake = host([
      { items: [summary('a'), { ...summary('b'), runId: '' } as ExecutionSummary] },
    ])
    const store = createExecutionStore(fake.port, 'wf_morning')
    store.load()
    await settle()

    const list = store.getSnapshot().list
    expect(list.status === 'ready' && list.executions.map((one) => one.runId)).toEqual(['a'])
  })

  it('deduplicates a page that overlaps what is already held', async () => {
    const fake = host([
      { items: [summary('a')], next: 'p2' },
      { items: [summary('a'), summary('b')] },
    ])
    const store = createExecutionStore(fake.port, 'wf_morning')
    store.load()
    await settle()

    store.loadMore()
    await settle()

    const list = store.getSnapshot().list
    expect(list.status === 'ready' && list.executions.map((one) => one.runId)).toEqual(['a', 'b'])
  })

  it('reports a page the Host could not shape, rather than throwing inside a region', async () => {
    const fake = host([{} as Cursor<ExecutionSummary>])
    const store = createExecutionStore(fake.port, 'wf_morning')
    store.load()
    await settle()

    expect(store.getSnapshot().list.status).toBe('failed')
  })

  it('keeps what is held when a FURTHER page fails', async () => {
    const pages: Cursor<ExecutionSummary>[] = [{ items: [summary('a')], next: 'p2' }]
    let fail = false
    const port: ExecutionSource = {
      listExecutions: (_id, cursor) =>
        fail && cursor
          ? Promise.reject(new Error('gone'))
          : Promise.resolve(pages[0] as Cursor<ExecutionSummary>),
      loadExecution: (runId) => Promise.resolve(execution(runId)),
    }
    const store = createExecutionStore(port, 'wf_morning')
    store.load()
    await settle()
    fail = true

    store.loadMore()
    await settle()

    const list = store.getSnapshot().list
    expect(list.status === 'ready' && list.executions).toHaveLength(1)
    expect(list.status === 'ready' && list.error?.message).toBe('gone')
  })
})

describe('opening one run', () => {
  it('hands the record back, so the caller can put its version on screen', async () => {
    const fake = host([{ items: [summary('a')] }], { record: execution('a', 3) })
    const store = createExecutionStore(fake.port, 'wf_morning')

    const record = await store.open('a')

    expect(record.workflow.version).toBe(3)
    expect(store.getSnapshot().open).toMatchObject({ status: 'ready', runId: 'a' })
  })

  it('refuses a record that does not say which version it ran against', async () => {
    const fake = host([{ items: [] }], {
      record: { ...execution('a'), workflow: undefined } as unknown as WorkflowExecution,
    })
    const store = createExecutionStore(fake.port, 'wf_morning')

    // Reported here, so the caller does not ask for version `undefined` and
    // render the Host's parse error instead of the fact that the run cannot be
    // drawn at all.
    await expect(store.open('a')).rejects.toThrow(/which version/)
    expect(store.getSnapshot().open.status).toBe('failed')
  })

  it('reports a load the Host refused, in the snapshot and to the caller', async () => {
    const fake = host([{ items: [] }], { failLoad: new Error('no such run') })
    const store = createExecutionStore(fake.port, 'wf_morning')

    await expect(store.open('a')).rejects.toThrow('no such run')
    expect(store.getSnapshot().open).toMatchObject({ status: 'failed', error: expect.any(Error) })
  })

  it('lets the later ask win when two are in flight', async () => {
    const settled: Record<string, (record: WorkflowExecution) => void> = {}
    const port: ExecutionSource = {
      listExecutions: () => Promise.resolve({ items: [] }),
      loadExecution: (runId) =>
        new Promise<WorkflowExecution>((resolve) => {
          settled[runId] = resolve
        }),
    }
    const store = createExecutionStore(port, 'wf_morning')

    const first = store.open('a')
    const second = store.open('b')
    settled.b?.(execution('b'))
    await second
    settled.a?.(execution('a'))
    await first

    // The screen belongs to whichever was asked for last, so the loser publishes
    // nothing rather than replacing it when it eventually lands.
    expect(store.getSnapshot().open).toMatchObject({ status: 'ready', runId: 'b' })
  })

  it('closes, and a load still in flight cannot publish over the close', async () => {
    let land: ((record: WorkflowExecution) => void) | undefined
    const port: ExecutionSource = {
      listExecutions: () => Promise.resolve({ items: [] }),
      loadExecution: () =>
        new Promise<WorkflowExecution>((resolve) => {
          land = resolve
        }),
    }
    const store = createExecutionStore(port, 'wf_morning')

    const opening = store.open('a')
    store.close()
    land?.(execution('a'))
    await opening

    expect(store.getSnapshot().open.status).toBe('none')
  })

  it('leaves the list alone, because the two fail separately', async () => {
    const fake = host([{ items: [summary('a')] }], { failLoad: new Error('body expired') })
    const store = createExecutionStore(fake.port, 'wf_morning')
    store.load()
    await settle()

    await expect(store.open('a')).rejects.toThrow()

    // A Host that keeps summaries longer than it keeps bodies is the ordinary
    // case, and one failure must not empty a list that was answering.
    expect(store.getSnapshot().list.status).toBe('ready')
  })
})
