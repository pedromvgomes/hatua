import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { Toggle } from './Toggle'

const meta = {
  title: 'Primitives/Toggle',
  component: Toggle,
} satisfies Meta<typeof Toggle>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The switch is controlled, so something has to hold its value. Every story
 * uses this rather than a no-op handler: a switch that does not move when you
 * press it is indistinguishable from a broken one, which is exactly the wrong
 * thing for a review surface to teach.
 */
function StatefulToggle({
  initial = false,
  label,
  disabled,
}: {
  initial?: boolean
  label: ReactNode
  disabled?: boolean
}) {
  const [checked, setChecked] = useState(initial)
  return <Toggle checked={checked} onCheckedChange={setChecked} label={label} disabled={disabled} />
}

export const States: Story = {
  args: { checked: false, onCheckedChange: () => {}, label: 'Run branches in parallel' },
  render: (args) => (
    <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
      <StatefulToggle label={args.label} />
      <StatefulToggle label={args.label} initial />
      {/* The disabled pair is the one that correctly does nothing. */}
      <StatefulToggle label="Disabled, off" disabled />
      <StatefulToggle label="Disabled, on" initial disabled />
    </div>
  ),
}

/**
 * The bare switch is the point, not an omission: `label` is optional, for rows
 * dense enough that a column heading already says what the switch means. The
 * name still has to exist, so `aria-label` becomes required — a switch with
 * neither is one a screen reader announces as nothing at all.
 */
export const WithoutVisibleLabel: Story = {
  args: { checked: false, onCheckedChange: () => {} },
  render: () => (
    <div style={{ display: 'grid', gap: 10, justifyItems: 'start', maxWidth: 280 }}>
      <AriaOnlyToggle />
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
        Nothing is missing. This switch is named <code>aria-label="Run branches in parallel"</code>,
        which is announced but not drawn — inspect it, or listen to it.
      </p>
    </div>
  ),
}

function AriaOnlyToggle() {
  const [checked, setChecked] = useState(false)
  return (
    <Toggle checked={checked} onCheckedChange={setChecked} aria-label="Run branches in parallel" />
  )
}
