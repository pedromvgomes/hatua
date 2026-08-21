import { drain } from './paging'
import type { ConnectionDescriber, ConnectionSource, ConnectionSummary } from './ports'
import type { Store } from './store'

/**
 * The Connections a Host has already established, read once and held.
 *
 * Hatua never establishes one. It has no server, so it can hold no client
 * secret and receive no redirect (ADR-0007) — every Connection is set up
 * outside, and this store's whole job is to let a `conn` field offer what the
 * Host says exists.
 *
 * ## Two ports, and the second is optional
 *
 * `ConnectionSource.listConnections` returns `{ref, type}` and nothing a person
 * would recognise. That is deliberate: a Workflow Definition stores an opaque
 * handle, and everything shown about a Connection comes from asking the Host to
 * describe it — so nothing cached in the file can go stale when a Connection is
 * renamed.
 *
 * The consequence is that a usable picker needs both ports: one to know what
 * exists, one to know what to call it. A Host that supplies only the first gets
 * a picker labelled by ref, which is worse than a label and better than an
 * empty list; a Host that supplies neither has no `conn` picker at all, and the
 * field says so. `ConnectionDescriber` stays separate because the run viewer
 * describes the Connections a run used and never lists or creates any.
 *
 * ## Why the descriptions are fetched here
 *
 * `describe(ref)` is one call per Connection, and the alternative — each field
 * describing what it is showing — would issue the same call once per `conn`
 * field on the screen, refetch every one on re-render, and give two fields
 * looking at the same Connection two independent loading states.
 */

/** One Connection the Host has established, as far as anything on screen needs. */
export interface KnownConnection {
  /** The opaque handle a Workflow Definition stores. */
  ref: string
  /** Matched against a `conn` field's `conn_type`. */
  type: string
  /** What the user sees. The ref itself when no describer was supplied. */
  label: string
  hint?: string
  /** `unknown` when no describer was supplied — never a guess that it is fine. */
  status: 'ready' | 'expired' | 'revoked' | 'unknown'
}

/**
 * Empty is not a status, the same argument `manifests.ts` makes: a Host with no
 * Connections established yet is `ready` with an empty list, which is a fact
 * about the data rather than a phase of the load.
 */
export type ConnectionState =
  | { status: 'loading' }
  | { status: 'ready'; connections: KnownConnection[] }
  | { status: 'failed'; error: Error }

export interface ConnectionStore extends Store<ConnectionState> {
  /** Fetch, once. Idempotent: every `conn` field calls it and only the first fetches. */
  load(): void
  /** Fetch again, discarding whatever is held. This is what a Retry does. */
  reload(): void
}

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))

const LOADING: ConnectionState = { status: 'loading' }

/**
 * A Connection the Host listed but would not describe.
 *
 * One failed `describe` must not empty the picker: the ref and the type came
 * from `listConnections` and are enough to offer it and to match its
 * `conn_type`. What is lost is the label, and a ref is a poor label rather than
 * no Connection.
 */
const undescribed = ({ ref, type }: ConnectionSummary): KnownConnection => ({
  ref,
  type,
  label: ref,
  status: 'unknown',
})

export function createConnectionStore(
  source: ConnectionSource,
  describer?: ConnectionDescriber,
): ConnectionStore {
  let state: ConnectionState = LOADING
  const listeners = new Set<() => void>()

  // Bumped per fetch, so a reload that overtakes an in-flight load wins.
  // Without it a slow first response lands after a fast retry and replaces
  // fresh data with stale, with nothing on screen saying so.
  let generation = 0
  let started = false

  const publish = (next: ConnectionState) => {
    state = next
    // Copied: a listener may unsubscribe while being notified, which React does
    // when a subscribed component unmounts during a render this notification
    // triggered.
    for (const listener of [...listeners]) listener()
  }

  /**
   * Describe every Connection, and let each one fail on its own.
   *
   * `allSettled` rather than `all`: one revoked Connection the Host cannot
   * describe would otherwise reject the whole batch and empty a picker that
   * should have been offering the other five.
   */
  const describeAll = async (summaries: ConnectionSummary[]): Promise<KnownConnection[]> => {
    if (!describer) return summaries.map(undescribed)

    const described = await Promise.allSettled(
      summaries.map((summary) => describer.describe(summary.ref)),
    )

    return summaries.map((summary, index) => {
      const result = described[index]
      if (result?.status !== 'fulfilled' || !result.value) return undescribed(summary)
      const { label, hint, status, type } = result.value
      return {
        ref: summary.ref,
        // The description's type wins where it has one. `listConnections` and
        // `describe` are two answers from the same Host, and the one that
        // carries the label is the one a person is looking at.
        type: type || summary.type,
        label: label || summary.ref,
        hint,
        status: status ?? 'unknown',
      }
    })
  }

  const fetch = () => {
    started = true
    const mine = ++generation
    // Guarded: re-publishing LOADING while already loading hands getSnapshot a
    // new object for no change, which is the one thing useSyncExternalStore
    // cannot tolerate.
    if (state.status !== 'loading') publish(LOADING)

    const settle = (next: ConnectionState) => {
      if (mine === generation) publish(next)
    }

    // No try/catch around this, unlike `manifests.ts`, and the difference is
    // `drain`. `listConnections` is a plain method on the Host's object and
    // nothing obliges it to be `async`, so one that throws synchronously is a
    // real case — but it is called from inside `drain`, which IS `async`, so
    // the throw is already a rejected promise by the time anything here sees
    // it. `manifests.ts` calls the Host's method directly and needs the guard;
    // a second one here would be unreachable, and an unreachable guard reads as
    // a path somebody has thought about.
    drain((cursor) => source.listConnections(cursor))
      .then(describeAll)
      .then(
        (connections) => settle({ status: 'ready', connections }),
        (cause) => settle({ status: 'failed', error: asError(cause) }),
      )
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
