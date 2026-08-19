import type { Meta, StoryObj } from '@storybook/react-vite'
import { Toast } from './Toast'

/**
 * The toast portals into the provider's overlay layer, which spans the
 * provider's box — so in the two-mode preview each panel gets its own, in its
 * own corner. That is the ADR-0002 behaviour made visible: portal to
 * document.body instead and both toasts would land in the page's corner,
 * outside either themed subtree, rendering unthemed.
 */
const meta = {
  title: 'Primitives/Toast',
  component: Toast,
  args: { open: true, children: 'Draft published as version 4.' },
  // The overlay layer spans the provider's box, and the provider's box is only
  // as tall as its content — so give the story content a height, or the toast
  // has no corner to sit in.
  decorators: [
    (Story) => (
      <div style={{ minHeight: 220 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Toast>

export default meta
type Story = StoryObj<typeof meta>

export const Info: Story = { args: { tone: 'info' } }

export const Success: Story = {
  args: { tone: 'success', children: 'Draft published as version 4.' },
}

export const ErrorTone: Story = {
  args: {
    tone: 'error',
    children: 'Publish rejected: version 3 is no longer the live one.',
    onDismiss: () => {},
  },
}
