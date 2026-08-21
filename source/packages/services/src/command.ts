import type { WorkflowDocument } from '@hatua/document'

/**
 * One undoable change.
 *
 * `apply` mutates and returns nothing: there is no inverse to write, because
 * undo restores the document's previous TEXT rather than replaying an opposite
 * command. See `createEditingStore` for why that is the cheaper correctness.
 *
 * Throwing aborts the command. The store catches it, leaves the document alone
 * and records nothing on the undo stack, so a command that cannot find what it
 * addresses is a no-op rather than half an edit. Every command therefore does
 * its lookups before its first mutation.
 */
export interface EditCommand {
  /** What an undo control says it will undo. */
  readonly label: string
  apply(document: WorkflowDocument): void
}
