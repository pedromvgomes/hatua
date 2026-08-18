import type { ComponentSpec, WorkflowExecution } from '@hatua/schema'

/**
 * The application layer: editing commands, the undo stack, validation
 * orchestration, and the ports a Host implements.
 *
 * Framework-free by design — @hatua/react subscribes to the store via
 * useSyncExternalStore, so the whole editing engine is testable without a
 * renderer, and dragging a node does not re-render the step list.
 */

/** Everything the Host supplies. Hatua stores nothing and runs nothing. */
export interface HostPorts {
  /** Component Manifests, ideally served by the Host so new step types need no release. */
  loadManifests(): Promise<ComponentSpec[]>
  /** Persist a Workflow Definition. Hatua hands back the edited YAML text. */
  save(workflowId: string, yaml: string): Promise<void>
  /** Past runs to render as history. Optional — omit and the Runs view is hidden. */
  loadExecutions?(workflowId: string): Promise<WorkflowExecution[]>
}

export interface Store<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}
