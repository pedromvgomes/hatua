import { type ComponentPropsWithRef, type ReactNode, useId, useState } from 'react'
import { cx } from '../primitives/classNames'
import styles from './TabbedPanel.module.css'
import css from './TabbedPanel.module.css?inline'

export interface PanelTab {
  /** Stable across renders; used for the panel's id and for selection. */
  id: string
  label: string
  content: ReactNode
}

export interface TabbedPanelProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  tabs: PanelTab[]
  /** Which tab opens first. Defaults to the first one given. */
  defaultTabId?: string
  /**
   * Which tab is open, when the caller wants to say. Pass it and this becomes
   * controlled — `onTabChange` is then the only thing that opens another tab.
   *
   * Added because one screen genuinely needs it: clicking an insert point in
   * the Flow tab has to open the Library with that point pending, and the two
   * regions are siblings inside this panel with no other way to reach each
   * other. Uncontrolled is still the default, because that is what every other
   * caller wants and what `regions.test.tsx` mounts.
   */
  tabId?: string
  onTabChange?: (tabId: string) => void
}

/**
 * Tab chrome that arranges regions it is handed, and owns none of them.
 *
 * This is the shape the three-tab plan forces. Every tab is separately
 * mountable — a Host that wants only the Library mounts <Library> and gets no
 * tab bar at all — so a panel that rendered <Library>, <FlowMap> and <Data>
 * itself would be the one component standing between that Host and the region
 * it asked for. Regions in, chrome around them, nothing else.
 *
 * The only state here is which tab is showing. That is chrome state, not
 * editing state: it is not in the Workflow Definition and the editing store has
 * no opinion on it — which is exactly why `tabId` can lift it out into a caller
 * without any of it reaching the document.
 */
export function TabbedPanel({
  tabs,
  defaultTabId,
  tabId,
  onTabChange,
  className,
  ...rest
}: TabbedPanelProps) {
  const base = useId()
  const [ownId, setOwnId] = useState(defaultTabId)
  const selectedId = tabId ?? ownId

  const open = (next: string) => {
    // The internal state is kept in step even while controlled, so a caller
    // that stops passing `tabId` does not snap the panel back to whatever was
    // open before it started.
    setOwnId(next)
    onTabChange?.(next)
  }

  // Resolved rather than stored: a `tabs` array that changes — a Host swapping
  // what it mounts — must not leave this pointing at a tab that is gone.
  const active = tabs.find((tab) => tab.id === selectedId) ?? tabs[0]

  const move = (delta: number) => {
    const from = tabs.findIndex((tab) => tab.id === active?.id)
    const next = tabs[(from + delta + tabs.length) % tabs.length]
    if (!next) return
    open(next.id)
    // Focus follows selection, or the roving tabindex desynchronises: the old
    // button keeps DOM focus while being re-rendered with tabIndex={-1}, so the
    // next Enter fires ITS onClick and the selection snaps back. A screen
    // reader also announces nothing, because nothing moved.
    document.getElementById(`${base}-tab-${next.id}`)?.focus()
  }

  return (
    <>
      <style href="hatua-tabbed-panel" precedence="hatua">
        {css}
      </style>
      <div className={cx(styles.panel, className)} {...rest}>
        <div
          role="tablist"
          className={styles.tabs}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') move(1)
            else if (event.key === 'ArrowLeft') move(-1)
            else return
            // Arrow keys inside a tablist select; letting them also scroll the
            // panel underneath would move two things at once.
            event.preventDefault()
          }}
        >
          {tabs.map((tab) => {
            const selected = tab.id === active?.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`${base}-tab-${tab.id}`}
                // Only the open tab's panel is rendered, so only the open tab
                // may claim one. Pointing every tab at an id that does not
                // exist gives a screen reader a panel it cannot navigate to.
                aria-controls={selected ? `${base}-panel-${tab.id}` : undefined}
                aria-selected={selected}
                // Roving tabindex: Tab reaches the tablist once and lands on the
                // open tab, then the arrow keys move within it.
                tabIndex={selected ? 0 : -1}
                className={cx(styles.tab, selected && styles.selected)}
                onClick={() => open(tab.id)}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
        {active ? (
          <div
            role="tabpanel"
            id={`${base}-panel-${active.id}`}
            aria-labelledby={`${base}-tab-${active.id}`}
            // The regions scroll and, until their own PRs fill them, hold
            // nothing focusable — so without a tab stop here a keyboard-only
            // user tabs off the strip and past a panel they can never scroll.
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a tabpanel whose content has no focusable descendant is the documented exception (APG), not an oversight.
            tabIndex={0}
            className={styles.body}
          >
            {active.content}
          </div>
        ) : null}
      </div>
    </>
  )
}
