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

/**
 * Several commands as one undoable change.
 *
 * Picking a Connection a workflow has not declared yet is two edits — bind the
 * Host's handle to a workflow-local name, then point the field at that name —
 * and they are one thing the user did. Left as two, undo puts the field back
 * and leaves a Connection nobody declared behind, which is a document state
 * nothing on screen explains.
 *
 * Still all-or-nothing, and for free: `EditingStore.apply` restores the
 * document's previous text when a command throws, so a member that fails
 * halfway takes its predecessors with it.
 */
export const sequence = (label: string, ...commands: EditCommand[]): EditCommand => ({
  label,
  apply(document) {
    for (const command of commands) command.apply(document)
  },
})
