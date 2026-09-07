import { useSyncExternalStore } from 'react'
import { useEditingStore } from './HatuaProvider'

/**
 * Whether the document on screen may still be changed.
 *
 * False while a Draft is claimed, true once **Publish**, **Release** or
 * **Discard** has ended the session — at which point the store refuses commands
 * outright, because there is no claim to write them under and, after a discard,
 * no Draft on the Host to write them to.
 *
 * Everything stays on screen either way. A Step is mostly what its fields say,
 * so a panel that emptied itself would answer "what is this workflow" with
 * nothing; what goes is the writing. A form that still looked editable would be
 * one whose every keystroke was dropped without a word, which is the half of
 * this the store cannot fix on its own.
 *
 * A hook rather than a prop because it is a fact about the store, not chrome —
 * the rule `layouts/README` draws — and because the controls that need it are
 * five layers inside a region. Reading it where it is used keeps the answer one
 * subscription away from the store rather than a parameter on every component
 * between.
 */
export function useReadOnly(): boolean {
  const store = useEditingStore()

  return useSyncExternalStore(
    store ? store.subscribe : subscribeToNothing,
    store ? () => refuses(store.getSnapshot()) : editable,
    // Editable on the server, matching every region's own hydration answer:
    // claiming the edit is a client concern, so nothing is known here yet.
    editable,
  )
}

type Snapshot = ReturnType<NonNullable<ReturnType<typeof useEditingStore>>['getSnapshot']>

const refuses = (state: Snapshot): boolean => state.status === 'ready' && !state.workflow.claimed

// Module-level and therefore stable: `useSyncExternalStore` re-subscribes
// whenever `subscribe` changes identity.
const subscribeToNothing = () => () => {}
const editable = () => false
