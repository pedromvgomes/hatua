import type { ExecutionsSnapshot } from '@hatua/services'
import { type ComponentPropsWithRef, useEffect, useSyncExternalStore } from 'react'
import { Button } from '../primitives/Button'
import { cx } from '../primitives/classNames'
import { useExecutionStore } from '../theme/HatuaProvider'
import styles from './RunList.module.css'
import css from './RunList.module.css?inline'
import { durationOf, momentOf, RUN_STATUS_LABEL } from './runRecords'

/**
 * The **Runs** tab: this workflow's **Workflow Executions**, newest first as the
 * Host returned them, a page at a time.
 *
 * Named for what it is rather than for the tab it sits behind. `views/Runs` is
 * the whole screen and this is the list in its side panel, and two regions
 * answering to *Runs* is the name collision `layouts/README` records the canvas
 * paying for once. `<StepList>` beside `<FlowMap>` is the same pair of names.
 *
 * ## It chooses, and something above it opens
 *
 * Pressing a row emits `onOpen` and nothing else. Opening a run is two stores'
 * work — the record comes from this one, and the version it references goes on
 * screen through the editing store as a **Preview** (ADR-0025) — and a region
 * that reached across to the second would be doing what `layouts/README` keeps
 * `views/Build` for: introducing two halves that each know only their own.
 *
 * Which run is open it reads here, because that is this store's own answer and
 * not chrome a caller holds.
 *
 * ## Paged, never drained
 *
 * A workflow that runs nightly for three years has a history that is walked
 * rather than swallowed, which is why `ports.ts` pages this list and why
 * **Show more** is a control rather than a scroll that fetches. A page that
 * fails leaves everything already loaded on screen: one failure must not empty
 * a list that was answering.
 */
export interface RunListProps extends ComponentPropsWithRef<'section'> {
  /**
   * A row was pressed. Optional, so the region mounts alone and simply reports
   * to nobody — the same bargain `onInsert` and `onSelect` make.
   */
  onOpen?: (runId: string) => void
}

/**
 * What a region with no `ExecutionSource` reads instead of a store.
 *
 * A stable object, because `useSyncExternalStore` cannot tolerate a fresh
 * snapshot per call — and a state of its own rather than a `status:
 * 'unconfigured'` arm, because the STORE never has that state: "the Host wired
 * nothing" is not a phase of a load, so it is the provider's null that says it
 * and not a shape the store would have to carry.
 */
const NOTHING_WIRED: ExecutionsSnapshot = { list: { status: 'loading' }, open: { status: 'none' } }

// Module-level and therefore stable: useSyncExternalStore re-subscribes whenever
// `subscribe` changes identity.
const subscribeToNothing = () => () => {}
const readNothing = (): ExecutionsSnapshot => NOTHING_WIRED

export function RunList({ className, onOpen, ...rest }: RunListProps) {
  const store = useExecutionStore()

  const state = useSyncExternalStore<ExecutionsSnapshot>(
    store ? store.subscribe : subscribeToNothing,
    store ? store.getSnapshot : readNothing,
    // Loading on the server for every Host: the list is a fetch, and a fetch is
    // a client concern, so that is what hydration matches.
    readNothing,
  )

  // Idempotent, so mounting this beside anything else that reads runs fetches
  // once — and here rather than in the provider, so a Host whose users never
  // open this view pays for no request.
  useEffect(() => {
    store?.load()
  }, [store])

  return (
    <section
      aria-label="Runs"
      className={cx(styles.runs, className)}
      // The whole region is the stylesheet's scope, and React 19 hoists it and
      // dedupes it by href however many regions render (ADR-0003).
      {...rest}
    >
      <style href="hatua-run-list" precedence="hatua">
        {css}
      </style>
      <Body
        wired={store !== null}
        state={state}
        onOpen={onOpen}
        loadMore={() => store?.loadMore()}
      />
    </section>
  )
}

function Body({
  wired,
  state,
  onOpen,
  loadMore,
}: {
  wired: boolean
  state: ExecutionsSnapshot
  onOpen?: (runId: string) => void
  loadMore: () => void
}) {
  if (!wired) {
    // Misconfiguration copy: this can only ever reach the integrator, because a
    // shipped product has its ports wired — so it names the prop that fixes it.
    return (
      <p className={styles.said}>
        No run history is wired up. Hatua stores nothing of its own — a Host supplies runs as ports=
        {'{{ executions }}'}, and names which workflow they belong to as workflowId.
      </p>
    )
  }

  const { list, open } = state

  if (list.status === 'loading') return <p className={styles.said}>Loading runs…</p>

  if (list.status === 'failed') {
    return <p className={cx(styles.said, styles.wrong)}>{list.error.message}</p>
  }

  if (list.executions.length === 0) {
    // Runtime copy: a workflow that has never run is a correctly-wired product
    // with an empty answer, said to the person looking at it.
    return <p className={styles.said}>This workflow has not run yet.</p>
  }

  return (
    <>
      <ul className={styles.list}>
        {list.executions.map((one) => {
          const mine = open.status !== 'none' && open.runId === one.runId
          const failed = mine && open.status === 'failed' ? open.error : null
          const loading = mine && open.status === 'loading'
          return (
            <li key={one.runId}>
              <button
                type="button"
                className={styles.row}
                // A boolean rather than "page": the row does not navigate, it
                // changes what the map beside it is drawing.
                aria-current={mine && open.status === 'ready'}
                onClick={() => onOpen?.(one.runId)}
              >
                <span
                  aria-hidden="true"
                  className={cx(styles.dot, styles[one.status as keyof typeof styles])}
                />
                <span className={styles.when}>{momentOf(one.startedAt)}</span>
                <span className={styles.took}>{durationOf(one.durationMs)}</span>
                <span className={styles.what}>
                  {/* The status is said in words as well as in the dot, because
                      a colour is the one thing a reader may not have. */}
                  {RUN_STATUS_LABEL[one.status] ?? one.status}
                  {loading ? ' · opening…' : ''}
                </span>
                {/* A run whose record the Host would not serve. Said on the row
                    that asked for it, because the list is still perfectly good
                    and the failure belongs to this one row. */}
                {failed ? (
                  <span className={cx(styles.what, styles.wrong)}>{failed.message}</span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
      {list.more || list.error ? (
        <div className={styles.foot}>
          {list.error ? (
            <p className={cx(styles.said, styles.wrong)}>{list.error.message}</p>
          ) : null}
          {list.more ? (
            <Button size="sm" disabled={list.fetching} onClick={loadMore}>
              {list.fetching ? 'Loading…' : 'Show more'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
