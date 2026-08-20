import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from './Button'
import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog'

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

/**
 * Opens on load so the story is a review surface, but Cancel, Escape and the
 * backdrop all really close it — the dialog's whole job is the answer it
 * returns, and a story that swallows the answer shows none of it.
 */
function Answerable(props: Omit<ConfirmDialogProps, 'open' | 'onConfirm' | 'onCancel'>) {
  const [open, setOpen] = useState(true)
  const [answer, setAnswer] = useState<string | null>(null)

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={open}>
        Open dialog
      </Button>
      {answer && (
        <p style={{ color: 'var(--hatua-text-secondary)', fontSize: '0.875rem' }}>
          Answered: {answer}
        </p>
      )}
      <ConfirmDialog
        {...props}
        open={open}
        onConfirm={() => {
          setAnswer('confirmed')
          setOpen(false)
        }}
        onCancel={() => {
          setAnswer('cancelled')
          setOpen(false)
        }}
      />
    </>
  )
}

export const Default: Story = {
  render: (args) => <Answerable title={args.title} description={args.description} />,
}

export const Danger: Story = {
  render: (args) => (
    <Answerable
      title={args.title}
      description={args.description}
      tone="danger"
      confirmLabel="Discard Draft"
    />
  ),
}

export const TitleOnly: Story = {
  render: () => <Answerable title="Leave Text Mode without saving?" />,
}
