import type { WorkflowExecution } from '@hatua/schema'
import type { Cursor, ExecutionSource, ExecutionSummary } from './ports'
import type { Store } from './store'

/**
 * A workflow's **Workflow Executions**: the list, a page at a time, and
 * whichever one is open.
 *
 * ## Why the list is paged and never drained
 *
 * `drain` throws past its limit rather than truncating, because "returning
 * would make a truncated list indistinguishable from a complete one" — and run
 * history is the case that reaches it first. `ports.ts` says every unbounded
 * list is paged and names this one: a workflow that runs nightly for three years
 * has a history that has to be walked. `createVersionStore` answers the same
 * question the same way.
 *
 * ## Why the open record is held here and the document is not
 *
 * An execution REFERENCES its definition by version, and the version is put on
 * screen by the editing store as a **Preview** (ADR-0025) — one way to have a
 * document that is not the **Draft** in front of a reader, not two. So what this
 * holds is the record, and the caller that opens one is what asks the editing
 * store for the version it names.
 *
 * ## Nothing is fetched until a reader asks
 *
 * `load()` is called by the region that lists runs, not by the provider. A Host
 * whose users never open the **Runs** view pays for no request, which is the
 * laziness `createVersionStore` is built on and `openDraft` is built on for a
 * stronger reason still.
 */

export type ExecutionsState =
  /** The first page is in flight. There is nothing to show yet. */
  | { status: 'loading' }
  | {
      status: 'ready'
      /** Every page loaded so far, in the order the Host returned them. */
      executions: readonly ExecutionSummary[]
      /** The Host has more. */
      more: boolean
      /** A further page is in flight. */
      fetching: boolean
      /**
       * A FURTHER page failed, with everything already loaded still held. One
       * failure must not empty a list that was answering, and which page failed
       * is not worth saying — the only thing to do about it is ask again.
       */
      error: Error | null
    }
  /** The FIRST page failed, so there is nothing to show and nothing to page from. */
  | { status: 'failed'; error: Error }

/**
 * Which execution is open, held beside the list rather than inside it.
 *
 * Separate states, because they fail separately: a list that arrived and a
 * record that would not load is the ordinary case for a Host that keeps
 * summaries longer than it keeps bodies, and folding the two would make one
 * failure empty the other.
 */
export type OpenExecutionState =
  /** Nothing has been opened. */
  | { status: 'none' }
  | { status: 'loading'; runId: string }
  | { status: 'ready'; runId: string; execution: WorkflowExecution }
  | { status: 'failed'; runId: string; error: Error }

export interface ExecutionsSnapshot {
  list: ExecutionsState
  open: OpenExecutionState
}

export interface ExecutionStore extends Store<ExecutionsSnapshot> {
  /** Fetch the first page, once. Idempotent: two regions mounting fetch once. */
  load(): void
  /** Fetch the next page. A no-op while one is in flight, or when the Host has no more. */
  loadMore(): void
  /** Fetch again from the start, discarding what is held. This is what a Retry does. */
  reload(): void
  /**
   * Load one execution and hold it.
   *
   * Resolves with the record so the caller can read the version it references
   * and put that version on screen. Rejects when the Host cannot serve it, and
   * the snapshot says the same thing — a caller that only draws is not obliged
   * to catch, and one that is about to move the screen has to know before it
   * does.
   */
  open(runId: string): Promise<WorkflowExecution>
  /** Close whatever is open. A no-op when nothing is. */
  close(): void
}

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))

const LOADING: ExecutionsState = { status: 'loading' }
const NONE: OpenExecutionState = { status: 'none' }

const unreadable = () => new Error('The list of runs could not be read.')

/**
 * Everything held, plus what is new in the page that just arrived.
 *
 * Deduplicated ACROSS pages and WITHIN one, because both produce the same row
 * twice — a duplicate React key and a history that reads as though something ran
 * twice. Across, because `advance` guards the cursor and not the items, so a
 * Host whose cursor is inclusive of the last row it served overlaps its pages
 * while satisfying the guard. Within, because nothing stops a Host repeating a
 * row inside one page, and the first page has no `held` to be caught by.
 *
 * A summary with no `runId` is dropped: it is the key every row is drawn and
 * identified by, and it is what `open` would be called with.
 */
const joined = (
  held: readonly ExecutionSummary[],
  page: readonly ExecutionSummary[],
): ExecutionSummary[] => {
  const known = new Set(held.map((one) => one.runId))
  const out = [...held]
  for (const one of page) {
    if (typeof one?.runId !== 'string' || one.runId === '' || known.has(one.runId)) continue
    known.add(one.runId)
    out.push(one)
  }
  return out
}

export function createExecutionStore(port: ExecutionSource, workflowId: string): ExecutionStore {
  let list: ExecutionsState = LOADING
  let open: OpenExecutionState = NONE
  let snapshot: ExecutionsSnapshot = { list, open }
  const listeners = new Set<() => void>()

  // Bumped per fetch of the LIST, so a reload that overtakes an in-flight load
  // wins — the guard every store in this package carries.
  let generation = 0
  let started = false

  /*
   * And a second one for the open record, because the two move independently: a
   * reload of the list is no reason to abandon the run being read, and opening
   * another run is no reason to refetch the list.
   */
  let opening = 0

  /** The cursor for the next page, or undefined when the Host is exhausted. */
  let cursor: string | undefined

  /*
   * `drain`'s guard, kept because paging incrementally does not make it
   * unnecessary — it makes it harder to see. A Host that echoes the same cursor
   * back appends the same page for as long as someone keeps pressing, and a list
   * that grows by repeating itself looks like a Host with a lot of history
   * rather than a bug.
   */
  let seen = new Set<string>()

  const publish = () => {
    snapshot = { list, open }
    // Copied: a listener may unsubscribe while being notified, which React does
    // when a subscribed component unmounts during a render this notification
    // triggered.
    for (const listener of [...listeners]) listener()
  }

  const setList = (next: ExecutionsState) => {
    list = next
    publish()
  }

  const setOpen = (next: OpenExecutionState) => {
    open = next
    publish()
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
    if (list.status !== 'loading') setList(LOADING)

    const received = (page: Cursor<ExecutionSummary>) => {
      if (mine !== generation) return
      // A type is a promise the Host makes and an endpoint can break it.
      // Unguarded, a page with no `items` reaches a region and throws inside its
      // `map`, taking the React tree down instead of rendering the failure this
      // store has a state for.
      if (!Array.isArray(page?.items)) {
        setList({ status: 'failed', error: unreadable() })
        return
      }
      advance(page.next)
      setList({
        status: 'ready',
        executions: joined([], page.items),
        more: cursor !== undefined,
        fetching: false,
        error: null,
      })
    }

    // The try/catch is not redundant with the rejection handler: `listExecutions`
    // is a plain method on the Host's object and nothing obliges it to be
    // `async`, so one that throws synchronously would throw straight back out of
    // `load()` — which a region calls inside an effect.
    try {
      port.listExecutions(workflowId).then(received, (cause) => {
        if (mine === generation) setList({ status: 'failed', error: asError(cause) })
      })
    } catch (cause) {
      if (mine === generation) setList({ status: 'failed', error: asError(cause) })
    }
  }

  return {
    getSnapshot: () => snapshot,
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
      const held = list
      // Nothing to continue: still loading, already failed, exhausted, or a page
      // is already on its way. Pressing twice asks once.
      if (held.status !== 'ready' || !held.more || held.fetching) return
      const from = cursor
      if (from === undefined) return

      const mine = generation
      setList({ ...held, fetching: true, error: null })

      /** Put the list back as it was, carrying why the page did not arrive. */
      const failed = (error: Error) => {
        if (mine !== generation) return
        setList({ ...held, fetching: false, error })
      }

      const received = (page: Cursor<ExecutionSummary>) => {
        if (mine !== generation) return
        if (!Array.isArray(page?.items)) {
          failed(unreadable())
          return
        }
        if (!advance(page.next)) {
          // Offered no further pages, not merely reported: a cursor that repeats
          // will repeat again, so leaving "Show more" on screen invites the user
          // to build a list out of one page said over and over.
          setList({
            ...held,
            more: false,
            fetching: false,
            error: new Error('The list of runs did not advance.'),
          })
          return
        }
        setList({
          status: 'ready',
          executions: joined(held.executions, page.items),
          more: cursor !== undefined,
          fetching: false,
          error: null,
        })
      }

      try {
        port.listExecutions(workflowId, from).then(received, (cause) => {
          failed(asError(cause))
        })
      } catch (cause) {
        failed(asError(cause))
      }
    },

    open(runId) {
      const mine = ++opening
      setOpen({ status: 'loading', runId })

      const settle = (cause: unknown): never => {
        const error = asError(cause)
        if (mine === opening) setOpen({ status: 'failed', runId, error })
        throw error
      }

      // Wrapped so a `loadExecution` that throws synchronously is reported as a
      // rejection rather than escaping into the click handler that opened the
      // row — the same reasoning the list's fetch gives.
      return (async () => {
        let execution: WorkflowExecution
        try {
          execution = await port.loadExecution(runId)
        } catch (cause) {
          return settle(cause)
        }
        /*
         * A type is a promise the Host makes. The version is what the caller
         * goes on to put on screen, so a record without one cannot be drawn at
         * all — and reporting that here is what stops the caller asking
         * `loadVersion` for `undefined` and rendering the Host's parse error
         * instead of the fact that the run is unreadable.
         */
        if (typeof execution?.workflow?.version !== 'number') {
          return settle(new Error('This run does not say which version it ran against.'))
        }
        // Another run opened while this one was in flight. The later ask wins,
        // and the loser reports nothing: the screen already belongs to it.
        if (mine !== opening) return execution
        setOpen({ status: 'ready', runId, execution })
        return execution
      })()
    },

    close() {
      if (open.status === 'none') return
      // Bumped, so a load still in flight cannot publish over the close.
      opening++
      setOpen(NONE)
    },
  }
}
