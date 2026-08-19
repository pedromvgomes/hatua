import type { Meta, StoryObj } from '@storybook/react-vite'
import { ConfirmDialog } from './ConfirmDialog'

const meta = {
  title: 'Primitives/ConfirmDialog',
  component: ConfirmDialog,
  args: {
    open: true,
    title: 'Discard this Draft?',
    description: 'Its version number goes back into the pool and the edits are lost.',
    onConfirm: () => {},
    onCancel: () => {},
  },
  // The backdrop covers the provider's box rather than the viewport, so the
  // story content is what gives it something to cover.
  decorators: [
    (Story) => (
      <div style={{ minHeight: 320 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConfirmDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Danger: Story = {
  args: { tone: 'danger', confirmLabel: 'Discard Draft' },
}

export const TitleOnly: Story = {
  args: { description: undefined, title: 'Leave Text Mode without saving?' },
}
