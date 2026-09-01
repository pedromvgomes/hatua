import { describe, expect, it } from 'vitest'
import type { Cursor, VersionSummary, WorkflowStore } from './ports'
import { createVersionStore, type VersionsState } from './versions'

/**
 * The list a long-lived workflow actually has.
 *
 * `drain` is the wrong tool here and its own header says why — it throws past
 * its limit rather than truncating, because a truncated list that looks
 * complete is worse than a failure. A workflow published daily for three years
 * is exactly the case that reaches that limit, so this store walks the pages
 * instead.
 */

const summary = (version: number, status: VersionSummary['status']): VersionSummary => ({
  version,
  status,
  updatedAt: `2026-01-${String(version).padStart(2, '0')}T00:00:00.000Z`,
})

interface Fake {
  port: WorkflowStore
  calls: (string | undefined)[]
}

/**
 * A Host serving fixed pages, faked at the port.
 *
 * `listVersions` is deliberately NOT declared `async` — a port method is a
 * plain method on the Host's object and nothing obliges it to return a promise,
 * which is the path the synchronous-throw test below reaches.
 */
const fake = (
  pages: (Cursor<VersionSummary> | Error)[],
  options: { throwSynchronously?: unknown } = {},
): Fake => {
  const calls: (string | undefined)[] = []
  const port = {
    listVersions(_workflowId: string, cursor?: string): Promise<Cursor<VersionSummary>> {
      if (options.throwSynchronously) throw options.throwSynchronously
      const page = pages[calls.length]
      calls.push(cursor)
      if (page instanceof Error) return Promise.reject(page)
      return Promise.resolve(page ?? { items: [] })
    },
  } as unknown as WorkflowStore

  return { port, calls }
}

const settle = async () => {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve()
}

const readyState = (state: VersionsState) => {
  if (state.status !== 'ready') throw new Error(`expected ready, got "${state.status}"`)
  return state
}

describe('opening the list', () => {
  it('fetches nothing until somebody opens it', () => {
    const { port, calls } = fake([{ items: [summary(1, 'published')] }])
    const store = createVersionStore(port, 'wf_morning')

    expect(store.getSnapshot()).toEqual({ status: 'loading' })
    expect(calls).toHaveLength(0)
  })

  it('fetches once however many times it is opened', async () => {
    const { port, calls } = fake([{ items: [summary(1, 'published')] }])
    const store = createVersionStore(port, 'wf_morning')

    store.load()
    store.load()
    await settle()

    expect(calls).toHaveLength(1)
  })

  it('lands ready, newest first as the Host ordered them', async () => {
    const { port } = fake([
      { items: [summary(3, 'draft'), summary(2, 'published'), summary(1, 'archived')] },
    ])
    const store = createVersionStore(port, 'wf_morning')
    store.load()
    await settle()

    expect(readyState(store.getSnapshot()).versions.map((one) => one.version)).toEqual([3, 2, 1])
  })

  it('has no more to offer when the Host sent no cursor', async () => {
    const { port } = fake([{ items: [summary(1, 'published')] }])
    const store = createVersionStore(port, 'wf_morning')
    store.load()
    await settle()

    expect(readyState(store.getSnapshot())).toMatchObject({ more: false, fetching: false })
  })

  it('has more when the Host sent one', async () => {
    const { port } = fake([{ items: [summary(9, 'draft')], next: 'p2' }])
    const store = createVersionStore(port, 'wf_morning')
    store.load()
    await settle()

    expect(readyState(store.getSnapshot()).more).toBe(true)
  })

  it('fails with nothing to show when the first page fails', async () => {
    const { port } = fake([new Error('The workflow service is unreachable.')])
    const store = createVersionStore(port, 'wf_morning')
    store.load()
    await settle()

    expect(store.getSnapshot()).toMatchObject({
      status: 'failed',
      error: { message: 'The workflow service is unreachable.' },
    })
  })

  it('fails rather than throwing out of load() when the port throws synchronously', async () => {
    // A click handler calls this. A Host whose `listVersions` is not `async`
    // would otherwise throw straight back out of the press.
    const { port } = fake([], { throwSynchronously: new Error('no store') })
    const store = createVersionStore(port, 'wf_morning')

    expect(() => store.load()).not.toThrow()
    await settle()
    expect(store.getSnapshot()).toMatchObject({ status: 'failed' })
  })
})

describe('paging through', () => {
  const twoPages = () =>
    fake([
      { items: [summary(3, 'draft'), summary(2, 'published')], next: 'p2' },
      { items: [summary(1, 'archived')] },
    ])

  it('appends the next page and carries the cursor the Host gave', async () => {
    const { port, calls } = twoPages()
    const store = createVersionStore(port, 'wf_morning')
    store.load()
    await settle()

    store.loadMore()
    await settle()

    expect(readyState(store.getSnapshot()).versions.map((one) => one.version)).toEqual([3, 2, 1])
    expect(calls).toEqual([undefined, 'p2'])
  })

  it('stops offering more once the Host is exhausted', async () => {
    const { port } = twoPages()
    const store = createVersionStore(port, 'wf_morning')
    store.load()
    await settle()
    store.loadMore()
    await settle()

    expect(readyState(store.getSnapshot()).more).toBe(false)
  })

  it('says a page is on its way, so the control can say so too', async () => {
    const { port } = twoPages()
    const store = createVersionStore(port, 'wf_morning')
    store.load()
    await settle()

    store.loadMore()
    expect(readyState(store.getSnapshot())).toMatchObject({ fetching: true })
    await settle()
    expect(readyState(store.getSnapshot())).toMatchObject({ fetching: false })
  })

  it('asks once when pressed twice', async () => {
    const { port, calls } = twoPages()
    const store = createVersionStore(port, 'wf_morning')
    store.load()
    await settle()

    store.loadMore()
    store.loadMore()
    await settle()

    expect(calls).toEqual([undefined, 'p2'])
  })

  it('does nothing when there is nothing more, or nothing yet', async () => {
    const { port, calls } = fake([{ items: [summary(1, 'published')] }])
    const store = createVersionStore(port, 'wf_morning')

    // Before the first page has even been asked for.
    store.loadMore()
    expect(calls).toHaveLength(0)

    store.load()
    await settle()
    store.loadMore()
    await settle()
    expect(calls).toHaveLength(1)
  })

  /*
   * One failure must not empty a list that was answering — the same call
   * `connections.ts` makes about a failed `describe`. What is lost is the next
   * page, not the history already on screen.
   */
  it('keeps what it has when a later page fails, and can be asked again', async () => {
    const { port } = fake([
      { items: [summary(3, 'draft'), summary(2, 'published')], next: 'p2' },
      new Error('The workflow service is unreachable.'),
      { items: [summary(1, 'archived')] },
    ])
    const store = createVersionStore(port, 'wf_morning')
    store.load()
    await settle()

    store.loadMore()
    await settle()

    const failed = readyState(store.getSnapshot())
    expect(failed.versions.map((one) => one.version)).toEqual([3, 2])
    expect(failed.error?.message).toBe('The workflow service is unreachable.')
    expect(failed.more).toBe(true)

    store.loadMore()
    await settle()
    expect(readyState(store.getSnapshot()).versions.map((one) => one.version)).toEqual([3, 2, 1])
    expect(readyState(store.getSnapshot()).error).toBeNull()
  })

  /*
   * `drain` guards against this and paging by hand still has to: a Host that
   * echoes the same cursor back appends the same page for as long as someone
   * keeps pressing, and a list that grows by repeating itself looks like a Host
   * with a lot of versions rather than a bug.
   */
  it('refuses a cursor that does not advance, and stops offering more', async () => {
    const { port } = fake([
      { items: [summary(3, 'draft')], next: 'p2' },
      { items: [summary(2, 'published')], next: 'p2' },
    ])
    const store = createVersionStore(port, 'wf_morning')
    store.load()
    await settle()
    store.loadMore()
    await settle()

    const state = readyState(store.getSnapshot())
    expect(state.more).toBe(false)
    expect(state.error?.message).toMatch(/did not advance/)
    expect(state.versions.map((one) => one.version)).toEqual([3])
  })
})

describe('reloading', () => {
  it('starts again from the first page', async () => {
    const { port, calls } = fake([
      { items: [summary(3, 'draft')], next: 'p2' },
      { items: [summary(2, 'published')] },
      { items: [summary(4, 'draft')] },
    ])
    const store = createVersionStore(port, 'wf_morning')
    store.load()
    await settle()
    store.loadMore()
    await settle()

    store.reload()
    await settle()

    expect(calls).toEqual([undefined, 'p2', undefined])
    expect(readyState(store.getSnapshot()).versions.map((one) => one.version)).toEqual([4])
  })

  it('wins over a load still in flight, rather than being overwritten by it', async () => {
    // Without the generation guard a slow first response lands after a fast
    // retry and replaces fresh data with stale, with nothing on screen saying so.
    let answerFirst: (page: Cursor<VersionSummary>) => void = () => {}
    const responses: Promise<Cursor<VersionSummary>>[] = [
      new Promise((resolve) => {
        answerFirst = resolve
      }),
      Promise.resolve({ items: [summary(2, 'published')] }),
    ]
    let call = 0
    const port = {
      listVersions: () => responses[call++] ?? Promise.resolve({ items: [] }),
    } as unknown as WorkflowStore

    const store = createVersionStore(port, 'wf_morning')
    store.load()
    store.reload()
    await settle()

    answerFirst({ items: [summary(99, 'archived')] })
    await settle()

    expect(readyState(store.getSnapshot()).versions.map((one) => one.version)).toEqual([2])
  })
})

describe('getSnapshot stability', () => {
  it('returns the same object until something changes', async () => {
    // A getSnapshot that builds a fresh object every call makes
    // useSyncExternalStore re-render forever.
    const { port } = fake([{ items: [summary(1, 'published')] }])
    const store = createVersionStore(port, 'wf_morning')

    expect(store.getSnapshot()).toBe(store.getSnapshot())
    store.load()
    await settle()
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })

  it('stops notifying an unsubscribed listener', async () => {
    const { port } = fake([{ items: [summary(1, 'published')] }])
    const store = createVersionStore(port, 'wf_morning')

    let seen = 0
    const stop = store.subscribe(() => {
      seen++
    })
    stop()

    store.load()
    await settle()
    expect(seen).toBe(0)
  })
})

describe('invalidating', () => {
  it('fetches nothing when the list was never opened', async () => {
    // What a Publish calls. The history is stale either way, and going to get
    // one nobody has looked at is the request this store's laziness avoids.
    const { port, calls } = fake([{ items: [summary(1, 'published')] }])
    const store = createVersionStore(port, 'wf_morning')

    store.invalidate()
    await settle()
    expect(calls).toHaveLength(0)
    expect(store.getSnapshot()).toEqual({ status: 'loading' })
  })

  it('fetches again when it was', async () => {
    const { port, calls } = fake([
      { items: [summary(1, 'published')] },
      { items: [summary(2, 'draft'), summary(1, 'published')] },
    ])
    const store = createVersionStore(port, 'wf_morning')
    store.load()
    await settle()

    store.invalidate()
    await settle()

    expect(calls).toHaveLength(2)
    expect(readyState(store.getSnapshot()).versions.map((one) => one.version)).toEqual([2, 1])
  })
})

describe('a Host that answers with the wrong shape', () => {
  /*
   * A type is a promise the Host makes and an endpoint can break it —
   * `manifests.ts` guards its payload for the same reason. Unguarded, the page
   * reaches a region and throws inside its `map`, taking the React tree down
   * instead of rendering the failure this store has a state for.
   */
  const malformed = { total: 3 } as unknown as Cursor<VersionSummary>

  it('fails rather than publishing a page with no items', async () => {
    const { port } = fake([malformed])
    const store = createVersionStore(port, 'wf_morning')
    store.load()
    await settle()

    expect(store.getSnapshot()).toMatchObject({ status: 'failed' })
  })

  it('keeps the pages it has when a later one comes back unreadable', async () => {
    const { port } = fake([{ items: [summary(2, 'draft')], next: 'p2' }, malformed])
    const store = createVersionStore(port, 'wf_morning')
    store.load()
    await settle()
    store.loadMore()
    await settle()

    const state = readyState(store.getSnapshot())
    expect(state.versions.map((one) => one.version)).toEqual([2])
    expect(state.fetching).toBe(false)
    expect(state.error?.message).toMatch(/could not be read/)
  })
})

describe('a Host whose pages overlap', () => {
  /*
   * `advance` guards the cursor and not the items. A Host whose cursor is
   * INCLUSIVE of the last row it served hands back a fresh cursor each time and
   * an overlapping page with it, so the guard is satisfied while the list grows
   * by repeating itself — two rows for one version, which is a duplicate React
   * key and a history that reads as though something was published twice.
   */
  it('appends only what it does not already hold', async () => {
    const { port } = fake([
      { items: [summary(3, 'draft'), summary(2, 'published')], next: '2' },
      { items: [summary(2, 'published'), summary(1, 'archived')] },
    ])
    const store = createVersionStore(port, 'wf_morning')
    store.load()
    await settle()
    store.loadMore()
    await settle()

    expect(readyState(store.getSnapshot()).versions.map((one) => one.version)).toEqual([3, 2, 1])
  })
})
