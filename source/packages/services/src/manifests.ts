import type { Manifest } from '@hatua/schema'
import type { ManifestSource } from './ports'
import type { Store } from './store'

/**
 * The Host's Component Manifests, read once and held.
 *
 * A store rather than an effect inside the region. The region that renders the
 * catalogue is not the only thing that reads it — the Inspector renders a
 * Step's form from the same manifest, and the reference tree reads the same
 * `outputs` — so the fetch cannot belong to whichever component happened to
 * need it first. Keeping it here also keeps the rule this package states about
 * itself: framework-free, testable without a renderer, and subscribed to from
 * React through `useSyncExternalStore` rather than mirrored into component
 * state.
 *
 * `ManifestSource.loadManifests()` returns a flat `Manifest[]` and is
 * deliberately not paged, so there is nothing to drain and no cursor to hold.
 */

/**
 * Note what is NOT a status: empty. A Host with no manifests declared is
 * `ready` with an empty list, because "the catalogue loaded and holds nothing"
 * is a fact about the data and not a phase of the load. Making it a fourth
 * status would let a caller forget it and render an empty grid, and would mean
 * the store had to decide that an empty catalogue is exceptional. It is not —
 * a fresh Host is exactly that.
 */
export type ManifestState =
  | { status: 'loading' }
  | { status: 'ready'; manifests: Manifest[] }
  | { status: 'failed'; error: Error }

export interface ManifestStore extends Store<ManifestState> {
  /**
   * Fetch, once. Idempotent by design: every consumer calls it on mount
   * without coordinating, and the second caller must not restart the load.
   *
   * The load is lazy rather than started in the factory because a Host that
   * mounts no region reading manifests should pay for no request — the same
   * claim ADR-0003 makes about CSS.
   */
  load(): void
  /** Fetch again, discarding whatever is held. This is what a Retry does. */
  reload(): void
}

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))

const LOADING: ManifestState = { status: 'loading' }

export function createManifestStore(source: ManifestSource): ManifestStore {
  let state: ManifestState = LOADING
  const listeners = new Set<() => void>()

  // Bumped per fetch, so a reload that overtakes an in-flight load wins. Without
  // it, a slow first response can land after a fast retry and replace fresh
  // data with stale — and the UI shows no sign that anything went wrong.
  let generation = 0
  let started = false

  const publish = (next: ManifestState) => {
    state = next
    // Copied, because a listener may unsubscribe while being notified — React
    // does exactly that when a subscribed component unmounts during a render
    // triggered by this very notification.
    for (const listener of [...listeners]) listener()
  }

  const fetch = () => {
    started = true
    const mine = ++generation
    // Guarded: re-publishing LOADING while already loading would hand
    // getSnapshot a new object for no change, which is the one thing
    // useSyncExternalStore cannot tolerate.
    if (state.status !== 'loading') publish(LOADING)

    const settle = (next: ManifestState) => {
      if (mine === generation) publish(next)
    }

    // The try/catch is not redundant with the rejection handler. `.then` only
    // sees a rejected promise, and `loadManifests` is a plain method on a
    // Host's object — nothing obliges it to be `async`. One that throws
    // synchronously (a TypeError reading an unconfigured base URL, say) would
    // otherwise throw straight back out of `load()`, which the region calls
    // inside an effect and the Retry button calls from a click handler: the
    // React tree comes down instead of the panel rendering the failed state,
    // and the store is left in `loading` with `started` already true, so
    // nothing will ever retry it.
    //
    // Everything else here goes out of its way to normalise whatever a Host
    // throws, down to a bare string. This is the same promise for the one path
    // that skipped it.
    try {
      source.loadManifests().then(
        (manifests) => settle({ status: 'ready', manifests }),
        (cause) => settle({ status: 'failed', error: asError(cause) }),
      )
    } catch (cause) {
      settle({ status: 'failed', error: asError(cause) })
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    load() {
      if (!started) fetch()
    },
    reload: fetch,
  }
}
