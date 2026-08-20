/**
 * The shape every store in this package exposes.
 *
 * It is `useSyncExternalStore`'s contract minus React: `getSnapshot` returns a
 * value that is referentially stable until something actually changes, and
 * `subscribe` returns its own unsubscribe. Nothing here imports React, which is
 * the point — the editing engine is testable without a renderer.
 *
 * The stability rule is not decorative. A `getSnapshot` that builds a fresh
 * object every call makes React re-render forever, and the failure surfaces in
 * the component rather than in the store that caused it.
 */
export interface Store<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}
