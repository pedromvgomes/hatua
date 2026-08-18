/**
 * The application layer: editing commands, the undo stack, validation
 * orchestration, and the ports a Host implements.
 *
 * Framework-free by design — @hatua/react subscribes to the store via
 * useSyncExternalStore, so the whole editing engine is testable without a
 * renderer, and dragging a node does not re-render the step list.
 */

export * from './paging'
export * from './ports'

export interface Store<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}
