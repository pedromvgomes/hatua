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
    const loadManifests = vi.fn(async () => [manifest('component.email.send')])
    const store = createManifestStore({ loadManifests })

    store.load()
    store.load()
    store.load()
    await settle()

    expect(loadManifests).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toEqual({
      status: 'ready',
      manifests: [manifest('component.email.send')],
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

  /*
   * A type is a promise the Host makes; an endpoint can break it. ports.ts
   * warns by name about the `components:` catalogue, and it is the shape half
   * of conformance/manifest is written in — so a Host serving a manifest file
   * straight down the wire resolves an object here. The Library reached
   * `.filter` on it during render, and a TypeError thrown from render takes
   * down the Host's tree.
   */
  it('refuses a resolved value that is not an array, rather than passing it on', async () => {
    const store = createManifestStore({
      loadManifests: async () =>
        ({ components: [manifest('component.email.send')] }) as unknown as Manifest[],
    })
    store.load()
    await settle()

    const state = store.getSnapshot()
    expect(state.status).toBe('failed')
    expect(state.status === 'failed' && state.error.message).toContain('flat array')
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

  /*
   * `.then` sees a rejected promise and nothing else. A Host's `loadManifests`
   * is a plain method, so one that is not `async` and throws would otherwise
   * throw back out of `load()` — which React calls inside an effect and the
   * Retry button calls from a click handler — bringing the tree down and
   * leaving the store in `loading` with `started` already true.
   */
  it('survives a source that throws synchronously instead of rejecting', async () => {
    const store = createManifestStore({
      loadManifests: (): Promise<Manifest[]> => {
        throw new TypeError('Cannot read properties of undefined (reading baseUrl)')
      },
    })

    expect(() => store.load()).not.toThrow()
    await settle()

    const state = store.getSnapshot()
    expect(state.status).toBe('failed')
    expect(state.status === 'failed' && state.error.message).toContain('baseUrl')
  })

  it('recovers from a synchronous throw when the Host fixes it and retries', async () => {
    // The half that matters: `started` must not strand the store, and reload
    // must not throw out of the click handler that called it.
    let configured = false
    const store = createManifestStore({
      loadManifests: (): Promise<Manifest[]> => {
        if (!configured) throw new TypeError('not configured')
        return Promise.resolve([manifest('component.email.send')])
      },
    })

    store.load()
    await settle()
    expect(store.getSnapshot().status).toBe('failed')

    configured = true
    expect(() => store.reload()).not.toThrow()
    await settle()
    expect(store.getSnapshot()).toEqual({
      status: 'ready',
      manifests: [manifest('component.email.send')],
    })
  })

  it('returns to loading on reload, and recovers', async () => {
    let attempt = 0
    const store = createManifestStore({
      loadManifests: async () => {
        attempt += 1
        if (attempt === 1) throw new Error('502')
        return [manifest('component.agent.act')]
      },
    })

    store.load()
    await settle()
    expect(store.getSnapshot().status).toBe('failed')

    store.reload()
    expect(store.getSnapshot()).toEqual({ status: 'loading' })
    await settle()
    expect(store.getSnapshot()).toEqual({
      status: 'ready',
      manifests: [manifest('component.agent.act')],
    })
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
