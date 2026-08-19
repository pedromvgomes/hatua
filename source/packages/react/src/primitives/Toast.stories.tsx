import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { Button } from './Button'
import { Toast, type ToastProps } from './Toast'

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

/**
 * Every story is dismissible and re-showable. A toast pinned permanently open
 * looks identical to a broken one, and the interesting half of this component
 * is what happens when it goes away.
 */
function Dismissible({
  children,
  ...props
}: Omit<ToastProps, 'open' | 'onDismiss'> & {
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={open}>
        Show toast
      </Button>
      <Toast {...props} open={open} onDismiss={() => setOpen(false)}>
        {children}
      </Toast>
    </>
  )
}

export const Info: Story = {
  render: (args) => <Dismissible tone="info">{args.children}</Dismissible>,
}

export const Success: Story = {
  render: () => <Dismissible tone="success">Draft published as version 4.</Dismissible>,
}

export const ErrorTone: Story = {
  render: () => (
    <Dismissible tone="error">Publish rejected: version 3 is no longer the live one.</Dismissible>
  ),
}

/**
 * The bar counts the wait down, and hovering the toast or focusing anything
 * inside it pauses both the bar and the timer — they read the same state, so
 * they cannot disagree. Ten seconds here only so there is time to try that.
 */
export const AutoDismiss: Story = {
  render: () => (
    <Dismissible tone="success" autoDismissAfter={10}>
      Draft published as version 4. This closes itself; hover to hold it.
    </Dismissible>
  ),
}
