import { type Diagnostic, indexManifests, validateDefinition } from '@hatua/model'
import { manifestsIn } from '@hatua/schema'
import type { EditingStore } from './editing'
import type { ManifestStore } from './manifests'
import type { Store } from './store'

/**
 * What is wrong with each Step, kept level with the document and the catalogue.
 *
 * It orchestrates rather than decides. Every rule lives in @hatua/model, where
 * a Host's runner can reach it and hold a definition to what the builder held
 * it to; all this does is join two stores, notice when either moves, and hand
 * the answer out in a shape `useSyncExternalStore` can subscribe to.
 *
 * More than one region reads it — the Flow tab draws a marker per Step, the
 * toolbar counts them — which is why the counting belongs in neither.
 *
 * ## Why it has no state of its own
 *
 * No listeners, no cached mutable field to invalidate, no `dispose()`. The
 * snapshot is memoised on the IDENTITY of the two source snapshots, both of
 * which are already referentially stable until something changes — so "has
 * anything moved?" is two `===` comparisons, and the answer is recomputed
 * exactly when it could differ. Subscribing forwards to both sources.
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
}

export interface ValidationStore extends Store<ValidationState> {
  /**
   * Make sure both inputs are being fetched.
   *
   * Idempotent, and it exists because validation needs the catalogue: a Host
   * that mounts the Flow tab and no Library would otherwise never load a
   * manifest, and every Step would sit silently unvalidated with nothing
   * saying why.
   */
  load(): void
}

const NONE: ReadonlyMap<string, Diagnostic[]> = new Map()
const NOTHING: readonly Diagnostic[] = []

/** Not ready, and therefore empty — one object, so an unready snapshot is stable. */
const PENDING: ValidationState = {
  byStep: NONE,
  byTrigger: NONE,
  byBlock: NONE,
  all: NOTHING,
  ready: false,
}

export function createValidationStore(
  editing: EditingStore,
  manifests: ManifestStore,
): ValidationStore {
  let lastEditing: unknown
  let lastManifests: unknown
  let cached: ValidationState = PENDING
  let computed = false

  const compute = (): ValidationState => {
    const document = editing.getSnapshot()
    const catalogue = manifests.getSnapshot()

    // A document that does not project has no Steps to attach a diagnostic to,
    // and a catalogue that has not arrived would make every Step unknown.
    // Either way the honest answer is "not yet", not "nothing is wrong".
    if (document.status !== 'ready' || !document.workflow.definition) return PENDING
    if (catalogue.status !== 'ready') return PENDING

    const validity = validateDefinition(
      document.workflow.definition,
      // Only the Component Manifests: a Run Context declares no `use`, so
      // indexing it would file it under `undefined` and make every Step whose
      // verb is missing resolve to it.
      indexManifests(manifestsIn(catalogue.manifests)),
    )
    return { ...validity, ready: true }
  }

  return {
    getSnapshot() {
      const document = editing.getSnapshot()
      const catalogue = manifests.getSnapshot()
      if (computed && document === lastEditing && catalogue === lastManifests) return cached

      lastEditing = document
      lastManifests = catalogue
      cached = compute()
      computed = true
      return cached
    },

    subscribe(listener) {
      const stopEditing = editing.subscribe(listener)
      const stopManifests = manifests.subscribe(listener)
      return () => {
        stopEditing()
        stopManifests()
      }
    },

    load() {
      editing.open()
      manifests.load()
    },
  }
}
