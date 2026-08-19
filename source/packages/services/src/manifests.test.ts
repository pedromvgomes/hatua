import type { Manifest } from '@hatua/schema'
import { describe, expect, it, vi } from 'vitest'
import { createManifestStore } from './manifests'
import type { ManifestSource } from './ports'

const manifest = (use: string): Manifest => ({
  kind: 'component',
  use,
  name: use,
  fields: [],
  outputs: [],
})

/** A source whose promise this test resolves by hand, so timing is explicit. */
function deferredSource() {
  const calls: {
    resolve: (manifests: Manifest[]) => void
    reject: (cause: unknown) => void
  }[] = []
  const source: ManifestSource = {
    loadManifests: () =>
      new Promise<Manifest[]>((resolve, reject) => {
        calls.push({ resolve, reject })
      }),
  }
  return { source, calls }
}

/** Waits for a resolved promise's `.then` to have run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('createManifestStore', () => {
  it('starts loading and fetches nothing until asked', () => {
    const loadManifests = vi.fn(async () => [])
    const store = createManifestStore({ loadManifests })

    expect(store.getSnapshot()).toEqual({ status: 'loading' })
    // Lazy on purpose: a Host that mounts no region reading manifests pays for
    // no request.
    expect(loadManifests).not.toHaveBeenCalled()
  })

  it('loads once however many consumers ask', async () => {
    const loadManifests = vi.fn(async () => [manifest('email.send')])
    const store = createManifestStore({ loadManifests })

    store.load()
    store.load()
    store.load()
    await settle()

    expect(loadManifests).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toEqual({
      status: 'ready',
      manifests: [manifest('email.send')],
    })
  })

  it('notifies subscribers, and stops once they unsubscribe', async () => {
    const { source, calls } = deferredSource()
    const store = createManifestStore(source)
    const listener = vi.fn()

    const unsubscribe = store.subscribe(listener)
    store.load()
    calls[0]?.resolve([])
    await settle()
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    store.reload()
    await settle()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('holds an empty catalogue as ready, not as an error', async () => {
    // A fresh Host with nothing declared is a legitimate state. Reporting it as
    // a failure would send every new Host looking for a bug that is not there.
    const store = createManifestStore({ loadManifests: async () => [] })
    store.load()
    await settle()

    expect(store.getSnapshot()).toEqual({ status: 'ready', manifests: [] })
  })

  it('reports a rejection as an Error, whatever was thrown', async () => {
    const store = createManifestStore({
      loadManifests: async () => {
        throw 'offline'
      },
    })
    store.load()
    await settle()

    const state = store.getSnapshot()
    expect(state.status).toBe('failed')
    expect(state.status === 'failed' && state.error.message).toBe('offline')
  })

  it('returns to loading on reload, and recovers', async () => {
    let attempt = 0
    const store = createManifestStore({
      loadManifests: async () => {
        attempt += 1
        if (attempt === 1) throw new Error('502')
        return [manifest('agent.act')]
      },
    })

    store.load()
    await settle()
    expect(store.getSnapshot().status).toBe('failed')

    store.reload()
    expect(store.getSnapshot()).toEqual({ status: 'loading' })
    await settle()
    expect(store.getSnapshot()).toEqual({ status: 'ready', manifests: [manifest('agent.act')] })
  })

  /*
   * The bug this prevents is invisible in a UI: a slow first request lands
   * after a retry and silently replaces the fresh catalogue with the stale one.
   */
  it('ignores a response overtaken by a later fetch', async () => {
    const { source, calls } = deferredSource()
    const store = createManifestStore(source)

    store.load()
    store.reload()
    calls[1]?.resolve([manifest('second')])
    calls[0]?.resolve([manifest('first')])
    await settle()

    expect(store.getSnapshot()).toEqual({ status: 'ready', manifests: [manifest('second')] })
  })

  it('keeps a snapshot referentially stable while nothing changes', () => {
    // useSyncExternalStore re-renders forever if this is not true, and the loop
    // surfaces in the component rather than here.
    const store = createManifestStore({ loadManifests: async () => [] })
    expect(store.getSnapshot()).toBe(store.getSnapshot())

    store.load()
    store.load()
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })
})
