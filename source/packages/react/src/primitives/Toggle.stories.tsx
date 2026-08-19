import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Toggle } from './Toggle'

const meta = {
  title: 'Primitives/Toggle',
  component: Toggle,
} satisfies Meta<typeof Toggle>

export default meta
type Story = StoryObj<typeof meta>

export const States: Story = {
  args: { checked: false, onCheckedChange: () => {}, label: 'Run branches in parallel' },
  render: (args) => (
    <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
      <Toggle {...args} checked={false} />
      <Toggle {...args} checked />
      <Toggle {...args} checked={false} disabled label="Disabled, off" />
      <Toggle {...args} checked disabled label="Disabled, on" />
    </div>
  ),
}

/** The only story that holds state — the switch is controlled, so something must. */
function ControlledToggle({ label }: { label: string }) {
  const [checked, setChecked] = useState(false)
  return <Toggle checked={checked} onCheckedChange={setChecked} label={label} />
}

export const Interactive: Story = {
  args: { checked: false, onCheckedChange: () => {}, label: 'Run branches in parallel' },
  render: (args) => <ControlledToggle label={String(args.label)} />,
}
