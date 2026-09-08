import { type ComponentPropsWithRef, useState } from 'react'
import { TextMode } from '../layouts/TextMode'
import type { BarView } from '../layouts/TopBar'
import { TopBar } from '../layouts/TopBar'
import { ConfirmDialog } from '../primitives/ConfirmDialog'
import { cx } from '../primitives/classNames'
import styles from './Text.module.css'
import css from './Text.module.css?inline'

/**
 * **Text Mode**: the toolbar, and the document as YAML filling everything under
 * it.
 *
 * Whole-screen, because a document that is not a **Workflow Definition** yet
 * empties the side panel, the canvas and the step editor at once — every one of
 * them reads `definition`. This is the only surface with anything to say in that
 * state, and it would be saying it between two blank columns anywhere else
 * (ADR-0026).
 *
 * ## It asks before the screen changes under unapplied text
 *
 * `<TextMode>` commits on a quiet period, so the only text it can still be
 * holding is text that will not parse — and nothing else on screen could ever
 * show it again. The region reports that it has some; this intercepts the
 * segmented control and asks, because a region cannot refuse to be unmounted and
 * should not try.
 */
export interface TextProps extends ComponentPropsWithRef<'div'> {
  /** Which view is on screen, forwarded to the bar's segmented control. */
  view?: BarView
  onViewChange?: (view: BarView) => void
}

export function Text({ className, view = 'text', onViewChange, ...rest }: TextProps) {
  const [unsaved, setUnsaved] = useState(false)
  /** Where the reader asked to go, held while they are asked about the text. */
  const [leaving, setLeaving] = useState<BarView | null>(null)

  return (
    <>
      <style href="hatua-text-view" precedence="hatua">
        {css}
      </style>
      <div className={cx(styles.scroller, className)} {...rest}>
        <div className={styles.text}>
          <div className={styles.bar}>
            <TopBar
              view={view}
              onViewChange={
                onViewChange
                  ? (next) => {
                      // Nothing to lose, or nowhere to go: the press is passed
                      // straight through. A dialog asked on the way to the view
                      // already on screen would be one nobody could have meant.
                      if (!unsaved || next === view) {
                        onViewChange(next)
                        return
                      }
                      setLeaving(next)
                    }
                  : undefined
              }
            />
          </div>
          <div className={styles.body}>
            <TextMode onUnsavedChange={setUnsaved} />
          </div>
        </div>
      </div>

      {leaving ? (
        <ConfirmDialog
          open
          title="Leave Text Mode without applying your changes?"
          description="What you have typed is not a workflow yet, so it has not been applied. Leaving here loses it."
          confirmLabel="Leave"
          tone="danger"
          onConfirm={() => {
            const next = leaving
            setLeaving(null)
            onViewChange?.(next)
          }}
          onCancel={() => setLeaving(null)}
        />
      ) : null}
    </>
  )
}
