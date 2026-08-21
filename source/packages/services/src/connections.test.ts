import { describe, expect, it, vi } from 'vitest'
import { createConnectionStore } from './connections'
import type {
  ConnectionDescriber,
  ConnectionDescription,
  ConnectionSource,
  ConnectionSummary,
  Cursor,
} from './ports'

/**
 * The Connection picker's data, against a Host's two ports.
 *
 * The shape being protected: a `conn` field must degrade rather than empty
 * itself. A Host with no describer, a describer that fails for one Connection,
 * a list that pages — none of them may leave a field with nothing to offer,
 * because the Connection the user needs is usually still in there.
 */

const settle = async () => {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve()
}

const summaries: ConnectionSummary[] = [
  { ref: 'ref_ops', type: 'email' },
  { ref: 'ref_haiku', type: 'llm' },
]

const listing = (
  pages: ConnectionSummary[][] = [summaries],
  overrides: Partial<ConnectionSource> = {},
): ConnectionSource => ({
  async listConnections(cursor?: string): Promise<Cursor<ConnectionSummary>> {
    const index = cursor ? Number(cursor) : 0
    return {
      items: pages[index] ?? [],
      next: index + 1 < pages.length ? String(index + 1) : undefined,
    }
  },
  ...overrides,
})

const description = (over: Partial<ConnectionDescription> = {}): ConnectionDescription => ({
  type: 'email',
  label: 'Ops mailbox',
  status: 'ready',
  details: {},
  ...over,
})

const describing = (by: Record<string, ConnectionDescription | Error>): ConnectionDescriber => ({
  async describe(ref) {
    const found = by[ref]
    if (!found) throw new Error(`no such connection "${ref}"`)
    if (found instanceof Error) throw found
    return found
  },
})

const ready = (store: { getSnapshot(): unknown }) => {
  const state = store.getSnapshot() as { status: string; connections?: unknown[] }
  if (state.status !== 'ready') throw new Error(`expected ready, got "${state.status}"`)
  return state.connections as { ref: string; type: string; label: string; status: string }[]
}

describe('createConnectionStore', () => {
  it('starts loading and does not fetch until somebody reads', async () => {
    // Lazy for the same reason the manifest store is: a Host that mounts no
    // region with a `conn` field in it should pay for no request.
    const listConnections = vi.fn(async () => ({ items: summaries }))
    const store = createConnectionStore({ listConnections })

    await settle()
    expect(listConnections).not.toHaveBeenCalled()
    expect(store.getSnapshot()).toEqual({ status: 'loading' })

    store.load()
    await settle()
    expect(listConnections).toHaveBeenCalledTimes(1)
  })

  it('fetches once however many fields ask', async () => {
    const listConnections = vi.fn(async () => ({ items: summaries }))
    const store = createConnectionStore({ listConnections })

    store.load()
    store.load()
    store.load()
    await settle()

    expect(listConnections).toHaveBeenCalledTimes(1)
  })

  it('labels each Connection from the Host’s description', async () => {
    const store = createConnectionStore(
      listing(),
      describing({
        ref_ops: description(),
        ref_haiku: description({ type: 'llm', label: 'Claude Code · Haiku 4.5' }),
      }),
    )
    store.load()
    await settle()

    expect(ready(store).map((c) => c.label)).toEqual(['Ops mailbox', 'Claude Code · Haiku 4.5'])
  })

  it('falls back to the ref when the Host wired no describer', async () => {
    // A ref is a poor label and better than an empty picker: the run viewer
    // needs the describer and an editor-only Host may not implement it.
    const store = createConnectionStore(listing())
    store.load()
    await settle()

    expect(ready(store).map((c) => c.label)).toEqual(['ref_ops', 'ref_haiku'])
    // Never a guess that an undescribed Connection is fine.
    expect(ready(store).every((c) => c.status === 'unknown')).toBe(true)
  })

  it('keeps the rest when one description fails', async () => {
    // A revoked Connection the Host cannot describe must not empty a picker
    // that should have been offering the other one.
    const store = createConnectionStore(
      listing(),
      describing({
        ref_ops: new Error('revoked'),
        ref_haiku: description({ type: 'llm', label: 'Claude Code · Haiku 4.5' }),
      }),
    )
    store.load()
    await settle()

    const connections = ready(store)
    expect(connections).toHaveLength(2)
    expect(connections[0]).toMatchObject({ ref: 'ref_ops', type: 'email', status: 'unknown' })
    expect(connections[1]?.label).toBe('Claude Code · Haiku 4.5')
  })

  it('keeps the listed type when a description carries none', async () => {
    const store = createConnectionStore(
      listing(),
      describing({
        ref_ops: { ...description(), type: '' },
        ref_haiku: description({ type: 'llm' }),
      }),
    )
    store.load()
    await settle()

    // The type is what `conn_type` is matched against, so losing it would make
    // the Connection unofferable in the field that needs it.
    expect(ready(store).map((c) => c.type)).toEqual(['email', 'llm'])
  })

  it('drains every page, because a picker showing page one is showing a lie', async () => {
    const store = createConnectionStore(
      listing([[summaries[0] as ConnectionSummary], [summaries[1] as ConnectionSummary]]),
    )
    store.load()
    await settle()

    expect(ready(store).map((c) => c.ref)).toEqual(['ref_ops', 'ref_haiku'])
  })

  it('treats no Connections as ready and empty, not as a failure', async () => {
    // A Host that has established none yet is exactly this, and a `conn` field
    // says so rather than reading as broken.
    const store = createConnectionStore(listing([[]]))
    store.load()
    await settle()

    expect(store.getSnapshot()).toEqual({ status: 'ready', connections: [] })
  })

  it('reports a rejected list, and a retry that actually refetches', async () => {
    let attempt = 0
    const store = createConnectionStore({
      async listConnections() {
        attempt += 1
        if (attempt === 1) throw new Error('the connections endpoint returned 503')
        return { items: summaries }
      },
    })

    store.load()
    await settle()
    expect(store.getSnapshot()).toMatchObject({ status: 'failed' })

    store.reload()
    await settle()
    expect(ready(store)).toHaveLength(2)
  })

  it('survives a port that throws synchronously', async () => {
    // `listConnections` is a plain method on the Host's object and nothing
    // obliges it to be `async`. One that throws would otherwise throw straight
    // back out of `load()`, which a field calls inside an effect.
    const store = createConnectionStore({
      listConnections() {
        throw new Error('base URL is not configured')
      },
    })

    expect(() => store.load()).not.toThrow()
    await settle()
    expect(store.getSnapshot()).toMatchObject({ status: 'failed' })
  })

  it('lets a reload that overtakes a slow load win', async () => {
    // Without the generation guard a slow first response lands after a fast
    // retry and replaces fresh data with stale, with nothing saying so.
    let resolveFirst: (page: Cursor<ConnectionSummary>) => void = () => {}
    let call = 0

    const store = createConnectionStore({
      listConnections() {
        call += 1
        if (call === 1) return new Promise<Cursor<ConnectionSummary>>((r) => (resolveFirst = r))
        return Promise.resolve({ items: [{ ref: 'ref_new', type: 'email' }] })
      },
    })

    store.load()
    await settle()
    store.reload()
    await settle()

    resolveFirst({ items: summaries })
    await settle()

    expect(ready(store).map((c) => c.ref)).toEqual(['ref_new'])
  })

  it('notifies subscribers and stops once they unsubscribe', async () => {
    const store = createConnectionStore(listing())
    const seen = vi.fn()
    const stop = store.subscribe(seen)

    store.load()
    await settle()
    expect(seen).toHaveBeenCalled()

    stop()
    const before = seen.mock.calls.length
    store.reload()
    await settle()
    expect(seen.mock.calls.length).toBe(before)
  })
})
