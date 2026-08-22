import type { Meta, StoryObj } from '@storybook/react-vite'
import { Select } from './Select'

const meta = {
  title: 'Primitives/Select',
  component: Select,
} satisfies Meta<typeof Select>

export default meta
type Story = StoryObj<typeof meta>

// Component ids, because a Select in Hatua nearly always picks one.
const options = ['component.email.send', 'core.fork', 'core.for_each', 'core.map']

export const States: Story = {
  render: (args) => (
    <div style={{ display: 'grid', gap: 12, maxWidth: 320 }}>
      <Select {...args} aria-label="Component" defaultValue="core.fork">
        {options.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </Select>
      <Select {...args} aria-label="Disabled" disabled defaultValue="component.email.send">
        <option value="component.email.send">component.email.send</option>
      </Select>
    </div>
  ),
}
