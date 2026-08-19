import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { Button } from './Button'

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Publish' },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

const Row = ({ children }: { children: ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>{children}</div>
)

export const Variants: Story = {
  render: (args) => (
    <Row>
      <Button {...args} variant="primary" />
      <Button {...args} variant="secondary" />
      <Button {...args} variant="ghost" />
      <Button {...args} variant="danger">
        Discard
      </Button>
    </Row>
  ),
}

export const Sizes: Story = {
  render: (args) => (
    <Row>
      <Button {...args} variant="primary" size="sm" />
      <Button {...args} variant="primary" size="md" />
      <Button {...args} variant="secondary" size="sm" />
      <Button {...args} variant="secondary" size="md" />
    </Row>
  ),
}

export const Disabled: Story = {
  args: { disabled: true },
  render: (args) => (
    <Row>
      <Button {...args} variant="primary" />
      <Button {...args} variant="secondary" />
      <Button {...args} variant="ghost" />
      <Button {...args} variant="danger" />
    </Row>
  ),
}
