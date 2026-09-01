import {
  type ConnectionTypes,
  type Diagnostic,
  indexManifests,
  validateDefinition,
} from '@hatua/model'
import { contextKeysIn, manifestsIn } from '@hatua/schema'
import type { ConnectionStore } from './connections'
import { type EditingStore, PublishBlocked } from './editing'
import type { ManifestStore } from './manifests'
import type { Store } from './store'

/**
 * What is wrong with each Step, kept level with the document and the catalogue.
 *
 * It orchestrates rather than decides. Every rule lives in @hatua/model, where
 * a Host's runner can reach it and hold a definition to what the builder held
 * it to; all this does is join the stores it reads, notice when any of them
 * moves, and hand the answer out in a shape `useSyncExternalStore` can subscribe
 * to.
 *
 * More than one region reads it — the Flow tab draws a marker per Step, the
 * toolbar counts them — which is why the counting belongs in neither.
 *
 * ## Three sources, and only two of them gate the answer
 *
 * The document and the catalogue decide whether ANY rule can run: a document
 * that does not project has no Steps to attach a diagnostic to, and every Step
 * looks like an unknown component until the manifests land. The Host's
 * Connections decide only whether TWO codes can run, so their absence narrows
 * this pass instead of stopping it. Folding them into `ready` would leave a Host
 * that wires no `ConnectionSource` — a correct configuration, not a broken one —
 * with no validation at all, silently, including every rule that has nothing to
 * do with Connections. See ADR-0022.
 *
 * ## Why it has no state of its own
 *
 * No listeners, no cached mutable field to invalidate, no `dispose()`. The
 * snapshot is memoised on the IDENTITY of the source snapshots, each of which is
 * already referentially stable until something changes — so "has anything
 * moved?" is three `===` comparisons, and the answer is recomputed exactly when
 * it could differ. Subscribing forwards to every source.
 *
 * Subscribing eagerly in the factory and publishing into a held field would
 * need the same disposal the editing store needs, for a value that is a pure
 * function of its inputs.
 */

export interface ValidationState {
  /** Diagnostics for each Step that has any. A Step with none is absent. */
  byStep: ReadonlyMap<string, Diagnostic[]>
  /**
   * The same, per Trigger. Separate because a Trigger is not a Step: the Flow
   * tab draws one map and the Workflow tab draws the other, and a Trigger id
   * filed under a Step's would be painted on whichever row happened to match.
   */
  byTrigger: ReadonlyMap<string, Diagnostic[]>
  /**
   * The same, per Block, for what belongs to the Block rather than to any Step
   * on its Board — a duplicate id, a duplicate key in its contract, recursion,
   * a Board that promises outputs and has a path off the end.
   *
   * A third map for the same reason the second exists: the surface that lists
   * the Blocks a document declares is not the one that draws its Steps, and a
   * Block id filed under a Step's key would be painted on whichever row
   * happened to match.
   */
  byBlock: ReadonlyMap<string, Diagnostic[]>
  /**
   * The same, per Connection, for what belongs to the Connection rather than to
   * any Step using it — a name the workflow declares and nothing ever wired.
   *
   * A fourth map for the reason the second and third exist. What draws it is not
   * a Connections region, because there is none — it is the `conn` field
   * pointing at the Connection, which looks it up by the id it holds. Filed once
   * here rather than raised at every such field, so a count in the toolbar does
   * not report one Connection five times because five Steps use it.
   */
  byConnection: ReadonlyMap<string, Diagnostic[]>
  /** Everything — what a count in the toolbar is drawn from. */
  all: readonly Diagnostic[]
  /**
   * Whether the answer means anything yet.
   *
   * False while the document or the catalogue is still arriving, and it is not
   * the same as "nothing is wrong": every Step looks like an unknown component
   * until the manifests land, so a reader that painted `byStep` without
   * checking this would flash an error on every Step of a valid workflow on
   * every load. It is a fact about the inputs rather than a phase of a load,
   * which is why it is a field and not a status — the same argument
   * `manifests.ts` makes about "empty".
   */
  ready: boolean
  /**
   * Whether the two codes that need a Connection's type were actually decided.
   *
   * Deliberately not folded into `ready`, and deliberately three values rather
   * than two, because a reader waiting for an answer needs to know whether one
   * is coming:
   *
   * - `checked` — the Host's Connections are known, and all four connection
   *   codes ran. An empty list still counts: a Host that has established none is
   *   answering, not silent.
   * - `pending` — the port has not replied yet. It will, so a Publish gate may
   *   wait.
   * - `undescribed` — nobody can say. No `ConnectionSource` is wired, or the one
   *   that is would not answer. Waiting on this never ends, and the two codes go
   *   unreported for as long as it holds.
   *
   * A failed fetch is `undescribed` rather than a fourth value because it is the
   * same fact to a reader of this store: no types, and nothing here will change
   * that. The surface that owns the Retry is the `conn` field, which reads the
   * connection store directly and renders the Host's error.
   */
  connections: 'checked' | 'pending' | 'undescribed'
}

export interface ValidationStore extends Store<ValidationState> {
  /**
   * Make sure every input is being fetched.
   *
   * Idempotent, and it exists because validation needs what the other regions
   * happen to ask for: a Host that mounts the Flow tab and no Library would
   * otherwise never load a manifest, and one that never opens a form would never
   * load a Connection — so every Step would sit silently unvalidated with
   * nothing saying why.
   */
  load(): void
}

/**
 * How long a Publish waits for an answer that is still coming.
 *
 * Generous, because the normal case is a catalogue landing in well under a
 * second and the cost of waiting is nothing; bounded, because a Host whose
 * fetch hangs would otherwise leave the press unanswered for ever.
 */
const GATE_DEADLINE_MS = 10_000

const NONE: ReadonlyMap<string, Diagnostic[]> = new Map()
const NOTHING: readonly Diagnostic[] = []

/**
 * Not ready, and therefore empty — one object, so an unready snapshot is stable.
 *
 * Every other field here is a placeholder, `connections` included: `ready` is
 * what says whether any of them means anything, and a reader that paints one
 * without checking it flashes an error on every Step of a valid workflow on
 * every load.
 */
const UNCHECKED: ValidationState = {
  byStep: NONE,
  byTrigger: NONE,
  byBlock: NONE,
  byConnection: NONE,
  all: NOTHING,
  ready: false,
  connections: 'undescribed',
}

/**
 * What the Host says its Connections are, and whether it has said anything.
 *
 * `undefined` and an empty map are different answers and must stay so: an empty
 * map is a Host with no Connections established, while `undefined` is a Host
 * nobody has asked or that would not reply. Collapsing the two makes every
 * Connection in the workflow unresolvable on first paint.
 */
const typesFrom = (
  connections: ConnectionStore | null | undefined,
): { types?: ConnectionTypes; status: ValidationState['connections'] } => {
  if (!connections) return { status: 'undescribed' }
  const state = connections.getSnapshot()
  if (state.status === 'loading') return { status: 'pending' }
  if (state.status === 'failed') return { status: 'undescribed' }
  return {
    types: new Map(state.connections.map((one) => [one.ref, one.type])),
    status: 'checked',
  }
}

/**
 * The snapshot to render when there is no validation store to read — a Host that
 * wired no `WorkflowStore` has none.
 *
 * A function rather than the value, because that is the shape
 * `useSyncExternalStore` wants for its `getSnapshot` fallback, and because it
 * must return the SAME object every time: a fresh one per call is a new snapshot
 * on every render, which is the one thing that hook cannot tolerate.
 *
 * Here rather than beside each region that subscribes, because five copies of
 * this object are five things to keep level with `ValidationState`.
 */
export const unchecked = (): ValidationState => UNCHECKED

/**
 * What blocks a **Publish**, once anything that is going to answer has.
 *
 * This is `PublishGate.blockers` — the async half ADR-0023 describes, kept here
 * rather than in the composition root because deciding *when an answer has
 * arrived* is a question about these stores and not about React.
 *
 * ## What it waits for, and what it refuses to wait for
 *
 * An answer is still coming while the catalogue is loading or the Host's
 * Connections are `pending`. It is never coming when the catalogue **failed**,
 * when the Connections are `undescribed`, or when there is no validation store
 * at all — and each of those narrows the check instead of stopping it, which is
 * ADR-0022's rule.
 *
 * The failed catalogue is the case worth naming. `ValidationState.ready` is
 * false both while the manifests are arriving and forever after they fail to,
 * so waiting on `ready` alone would hang **Publish** permanently for a Host
 * whose manifest endpoint is down — and a Publish button that never answers is
 * a worse failure than one that publishes unchecked. That is why the catalogue
 * is read here directly rather than through `ready`.
 *
 * Nothing here needs to wait for the document: `publish()` has already refused
 * a document that does not project before this is ever called.
 */
export function publishBlockers(
  validation: ValidationStore | null | undefined,
  manifests: ManifestStore | null | undefined,
  { deadlineMs = GATE_DEADLINE_MS }: { deadlineMs?: number } = {},
): Promise<readonly Diagnostic[]> {
  if (!validation || !manifests) return Promise.resolve(NOTHING)

  /*
   * Ask, before waiting to be told.
   *
   * A manifest store nobody has called `load()` on sits at `loading` for ever —
   * that is not a fetch in flight, it is a fetch that has not been started. So a
   * gate that only waited would never answer for a Host that drives publish
   * without mounting a region, and the Publish it belongs to would hang. This is
   * exactly what `ValidationStore.load` exists for: "validation needs what the
   * other regions happen to ask for", and it is idempotent, so a catalogue
   * already on its way is not fetched twice.
   */
  validation.load()

  const decided = () =>
    manifests.getSnapshot().status !== 'loading' &&
    validation.getSnapshot().connections !== 'pending'

  // Whatever it holds when nothing more is coming. An unready snapshot's `all`
  // is empty, which is the honest answer for a catalogue that failed: nothing
  // could be checked, so nothing is being reported.
  const answer = () => validation.getSnapshot().all

  if (decided()) return Promise.resolve(answer())

  return new Promise((resolve, reject) => {
    let stop = () => {}

    const settle = () => {
      clearTimeout(timer)
      stop()
      resolve(answer())
    }

    /*
     * The deadline REFUSES; it does not answer.
     *
     * An unready snapshot's `all` is empty, and an empty list means "nothing is
     * wrong" to the only caller there is — so falling through to it would
     * publish a workflow against which no rule has run, which is the guarantee
     * ADR-0023 exists to make. A Host that is merely slow is the reachable case:
     * the catalogue fetch starts when the bar mounts, so a cold endpoint and a
     * user who presses Publish inside the window is all it takes.
     *
     * "Could not be checked" and "checked, and fine" are different answers, and
     * only one of them may publish. The narrowing this file does elsewhere is
     * for a question nobody can EVER answer; a wait that ran out is a question
     * that has not been answered yet, and asking again is the way through.
     */
    const giveUp = () => {
      stop()
      /*
       * `ready`, not `decided()`. The catalogue having arrived is what says the
       * rules RAN, and a wait that ran out with only the Connections still
       * outstanding leaves exactly the two codes `undescribed` leaves — which
       * ADR-0022 already settles in favour of narrowing. A catalogue that never
       * arrived leaves an empty list that ran nothing, and that is the one that
       * must not be mistaken for a clean workflow.
       */
      if (validation.getSnapshot().ready) {
        resolve(answer())
        return
      }
      reject(
        new PublishBlocked(
          NOTHING,
          'This workflow could not be checked just now, so it has not been published. Try again in a moment.',
        ),
      )
    }

    /*
     * The wait is bounded, and only this half of it is.
     *
     * "It will reply" is true of a Host that replies. One whose manifest fetch
     * hangs — no timeout on the request — leaves the catalogue at `loading` for
     * the life of the page, and a gate waiting on that never answers: `publish()`
     * never settles, and the control that pressed it never hears back.
     *
     * That is worth a deadline where the Host's own `publish` is not, and the
     * difference is what a wait costs. Nothing has been spent here — no claim,
     * no version, no call to the port — so giving up and checking what IS known
     * is exactly ADR-0022's narrowing, arrived at by clock instead of by a
     * port's answer. Waiting on `port.publish` is different in kind: the write
     * is in the Host's hands, and no local timer can un-make it.
     */
    const timer = setTimeout(giveUp, deadlineMs)

    stop = validation.subscribe(() => {
      if (!decided()) return
      settle()
    })

    // Subscribing can be the thing that makes it decidable — `load()` above may
    // have resolved between the check and here — so ask once more rather than
    // waiting out the deadline for an answer already sitting there.
    if (decided()) settle()
  })
}

export function createValidationStore(
  editing: EditingStore,
  manifests: ManifestStore,
  connections?: ConnectionStore | null,
): ValidationStore {
  let lastEditing: unknown
  let lastManifests: unknown
  let lastConnections: unknown
  let cached: ValidationState = UNCHECKED
  let computed = false

  const compute = (): ValidationState => {
    const document = editing.getSnapshot()
    const catalogue = manifests.getSnapshot()

    // A document that does not project has no Steps to attach a diagnostic to,
    // and a catalogue that has not arrived would make every Step unknown.
    // Either way the honest answer is "not yet", not "nothing is wrong".
    if (document.status !== 'ready' || !document.workflow.definition) return UNCHECKED
    if (catalogue.status !== 'ready') return UNCHECKED

    const { types, status } = typesFrom(connections)
    const validity = validateDefinition(
      document.workflow.definition,
      // Only the Component Manifests: a Run Context declares no `use`, so
      // indexing it would file it under `undefined` and make every Step whose
      // verb is missing resolve to it.
      indexManifests(manifestsIn(catalogue.manifests)),
      // The Run Context separately, because it is scope rather than a verb:
      // `run.*` is on every Board, and a checker that was not given the keys
      // would report every one of them as naming nothing.
      contextKeysIn(catalogue.manifests),
      // Absent while the port is loading, has failed, or was never wired. The
      // two codes that need a type are then unreported, and every other family
      // still runs.
      types,
    )
    return { ...validity, ready: true, connections: status }
  }

  return {
    getSnapshot() {
      const document = editing.getSnapshot()
      const catalogue = manifests.getSnapshot()
      const established = connections?.getSnapshot()
      if (
        computed &&
        document === lastEditing &&
        catalogue === lastManifests &&
        established === lastConnections
      ) {
        return cached
      }

      lastEditing = document
      lastManifests = catalogue
      lastConnections = established
      cached = compute()
      computed = true
      return cached
    },

    subscribe(listener) {
      const stopEditing = editing.subscribe(listener)
      const stopManifests = manifests.subscribe(listener)
      const stopConnections = connections?.subscribe(listener)
      return () => {
        stopEditing()
        stopManifests()
        stopConnections?.()
      }
    },

    load() {
      editing.open()
      manifests.load()
      // The manifests argument, one seam over: a Host that mounts the Flow tab
      // and never opens a form renders no `conn` field, so nothing else would
      // ever ask — and the two type-dependent codes would sit permanently
      // unreported with nothing saying why.
      connections?.load()
    },
  }
}
