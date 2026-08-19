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
 * editing state: it is not in the Workflow Definition, nothing outside this
 * component can observe it, and the editing store (PR 4) has no opinion on it.
 */
export function TabbedPanel({ tabs, defaultTabId, className, ...rest }: TabbedPanelProps) {
  const base = useId()
  const [selectedId, setSelectedId] = useState(defaultTabId)

  // Resolved rather than stored: a `tabs` array that changes — a Host swapping
  // what it mounts — must not leave this pointing at a tab that is gone.
  const active = tabs.find((tab) => tab.id === selectedId) ?? tabs[0]

  const move = (delta: number) => {
    const from = tabs.findIndex((tab) => tab.id === active?.id)
    const next = tabs[(from + delta + tabs.length) % tabs.length]
    if (next) setSelectedId(next.id)
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
                aria-controls={`${base}-panel-${tab.id}`}
                aria-selected={selected}
                // Roving tabindex: Tab reaches the tablist once and lands on the
                // open tab, then the arrow keys move within it.
                tabIndex={selected ? 0 : -1}
                className={cx(styles.tab, selected && styles.selected)}
                onClick={() => setSelectedId(tab.id)}
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
            className={styles.body}
          >
            {active.content}
          </div>
        ) : null}
      </div>
    </>
  )
}
