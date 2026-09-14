import { useState } from 'react'
import { ConfirmDialog } from '../primitives/ConfirmDialog'

/**
 * Asking before the screen changes under text the document has not taken.
 *
 * `<TextMode>` commits on a quiet period, so the only text it can still be
 * holding is text that will not parse — and nothing else on screen could ever
 * show it again. A region cannot refuse to be unmounted and should not try, so
 * it reports that it has some and the view asks.
 *
 * Here rather than in either view because both have two ways out — the toggle
 * back to the map, and the bar's `Build | Runs` — so the guard would otherwise
 * be written four times and drift.
 */
export function useLeavingText() {
  const [unsaved, setUnsaved] = useState(false)
  /** What the reader asked for, held while they are asked about the text. */
  const [pending, setPending] = useState<{ go: () => void } | null>(null)

  return {
    /** Hand to `<TextMode onUnsavedChange>`. */
    onUnsavedChange: setUnsaved,
    /**
     * Wrap anything that takes the text off screen.
     *
     * Passes straight through when there is nothing to lose, so the ordinary
     * case costs no dialog and no thought.
     */
    guard(showing: boolean, go: () => void) {
      if (!showing || !unsaved) {
        go()
        return
      }
      setPending({ go })
    },
    dialog: pending ? (
      <ConfirmDialog
        open
        title="Leave Text Mode without applying your changes?"
        description="What you have typed is not a workflow yet, so it has not been applied. Leaving here loses it."
        confirmLabel="Leave"
        tone="danger"
        onConfirm={() => {
          const asked = pending
          setPending(null)
          asked.go()
        }}
        onCancel={() => setPending(null)}
      />
    ) : null,
  }
}
