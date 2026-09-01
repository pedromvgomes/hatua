import type { Cursor, VersionSummary, WorkflowStore } from './ports'
import type { Store } from './store'

/**
 * The workflow's versions, a page at a time.
 *
 * ## Why not `drain`
 *
 * Every other list in this package is drained, and this one must not be.
 * `drain` throws past its limit rather than truncating — deliberately, because
 * "returning would make a truncated list indistinguishable from a complete one"
 * — and a workflow published every day for three years is precisely the case
 * that reaches it. A history that gets longer the longer a workflow is useful
 * is one that has to be walked, not swallowed.
 *
 * ## Why it is a store of its own
 *
 * It reads the same `WorkflowStore` the editing store does and shares nothing
 * else with it. The readout in the top bar — `v5 · Draft` — comes from the open
 * document, whose `version` and `status` the schema makes required; this list is
 * about the WORKFLOW, and it answers even while the document on screen does not
 * project. Two questions, two sources, two failure modes.
 *
 * ## Nothing is fetched until the list is opened
 *
 * `load()` is called when someone opens the list, not when the bar mounts. The
 * same laziness `openDraft` is justified by, for a weaker reason: no claim is
 * taken here, but a toolbar that costs a request per mount is one a Host pays
 * for on every screen that carries it.
 */

export type VersionsState =
  /** The first page is in flight. There is nothing to show yet. */
  | { status: 'loading' }
  | {
      status: 'ready'
      /** Every page loaded so far, newest first, in the order the Host returned them. */
      versions: readonly VersionSummary[]
      /** The Host has more. */
      more: boolean
      /** A further page is in flight. */
      fetching: boolean
      /**
       * A FURTHER page failed, with everything already loaded still held.
       *
       * The same call `connections.ts` makes about a failed `describe`: one
       * failure must not empty a list that was answering. Which page failed is
       * not worth saying — the only thing to do about it is ask again.
       */
      error: Error | null
    }
  /** The FIRST page failed, so there is nothing to show and nothing to page from. */
  | { status: 'failed'; error: Error }

export interface VersionStore extends Store<VersionsState> {
  /** Fetch the first page, once. Idempotent: opening the list twice fetches once. */
  load(): void
  /** Fetch the next page. A no-op while one is in flight, or when the Host has no more. */
  loadMore(): void
  /** Fetch again from the start, discarding what is held. This is what a Retry does. */
  reload(): void
}

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))

const LOADING: VersionsState = { status: 'loading' }

export function createVersionStore(port: WorkflowStore, workflowId: string): VersionStore {
  let state: VersionsState = LOADING
  const listeners = new Set<() => void>()

  // Bumped per fetch, so a reload that overtakes an in-flight load wins — the
  // guard every store in this package carries. Without it a slow first response
  // lands after a fast retry and replaces fresh data with stale.
  let generation = 0
  let started = false

  /** The cursor for the next page, or undefined when the Host is exhausted. */
  let cursor: string | undefined

  /*
   * `drain`'s guard, kept because paging incrementally does not make it
   * unnecessary — it makes it harder to see. A Host that echoes the same cursor
   * back appends the same page for as long as someone keeps pressing, and a list
   * that grows by repeating itself looks like a Host with a lot of versions
   * rather than a bug.
   */
  let seen = new Set<string>()

  const publish = (next: VersionsState) => {
    state = next
    // Copied: a listener may unsubscribe while being notified, which React does
    // when a subscribed component unmounts during a render this notification
    // triggered.
    for (const listener of [...listeners]) listener()
  }

  /**
   * Take a page's cursor, or refuse one that does not advance.
   *
   * Only `loadMore` can be refused: the first page's cursor is matched against
   * an empty set, so it always advances, and a guard there would be a path
   * nothing can reach.
   */
  const advance = (next: string | undefined): boolean => {
    if (next === undefined) {
      cursor = undefined
      return true
    }
    if (seen.has(next)) return false
    seen.add(next)
    cursor = next
    return true
  }

  const fetch = () => {
    started = true
    const mine = ++generation
    cursor = undefined
    seen = new Set()
    // Guarded: re-publishing LOADING while already loading hands getSnapshot a
    // new object for no change, which is the one thing useSyncExternalStore
    // cannot tolerate.
    if (state.status !== 'loading') publish(LOADING)

    const settle = (next: VersionsState) => {
      if (mine === generation) publish(next)
    }

    const received = (page: Cursor<VersionSummary>) => {
      if (mine !== generation) return
      advance(page.next)
      publish({
        status: 'ready',
        versions: page.items,
        more: cursor !== undefined,
        fetching: false,
        error: null,
      })
    }

    // The try/catch is not redundant with the rejection handler: `listVersions`
    // is a plain method on the Host's object and nothing obliges it to be
    // `async`, so one that throws synchronously would throw straight back out of
    // `load()` — which a click handler calls. `manifests.ts` spells out the same
    // reasoning; `connections.ts` needs no such guard only because it calls the
    // port from inside `drain`, which is already async.
    try {
      port.listVersions(workflowId).then(received, (cause) => {
        settle({ status: 'failed', error: asError(cause) })
      })
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

    loadMore() {
      const held = state
      // Nothing to continue: still loading, already failed, exhausted, or a
      // page is already on its way. Pressing twice asks once.
      if (held.status !== 'ready' || !held.more || held.fetching) return
      const from = cursor
      if (from === undefined) return

      const mine = generation
      publish({ ...held, fetching: true, error: null })

      /** Put the list back as it was, carrying why the page did not arrive. */
      const failed = (error: Error) => {
        if (mine !== generation) return
        publish({ ...held, fetching: false, error })
      }

      const received = (page: Cursor<VersionSummary>) => {
        if (mine !== generation) return
        if (!advance(page.next)) {
          // Offered no further pages, not merely reported: a cursor that
          // repeats will repeat again, so leaving "Show more" on screen invites
          // the user to build a list out of one page said over and over.
          publish({
            ...held,
            more: false,
            fetching: false,
            error: new Error('The list of versions did not advance.'),
          })
          return
        }
        publish({
          status: 'ready',
          // Appended to what was held when the request went out, not to
          // whatever is on screen now: a reload during the flight has bumped
          // the generation and this never runs, and nothing else can have
          // changed the list underneath it.
          versions: [...held.versions, ...page.items],
          more: cursor !== undefined,
          fetching: false,
          error: null,
        })
      }

      try {
        port.listVersions(workflowId, from).then(received, (cause) => {
          failed(asError(cause))
        })
      } catch (cause) {
        failed(asError(cause))
      }
    },
  }
}
