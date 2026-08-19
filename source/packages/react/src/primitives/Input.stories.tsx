import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { Input } from './Input'

const meta = {
  title: 'Primitives/Input',
  component: Input,
  args: { placeholder: '{{ var.digest_to }}' },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

const Stack = ({ children }: { children: ReactNode }) => (
  <div style={{ display: 'grid', gap: 12, maxWidth: 320 }}>{children}</div>
)

export const States: Story = {
  render: (args) => (
    <Stack>
      <Input {...args} aria-label="Empty" />
      <Input {...args} aria-label="Filled" defaultValue="digest@example.com" />
      <Input {...args} aria-label="Invalid" defaultValue="{{ s1." invalid />
      <Input {...args} aria-label="Disabled" defaultValue="read-only" disabled />
    </Stack>
  ),
}
