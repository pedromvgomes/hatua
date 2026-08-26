import type { Meta, StoryObj } from '@storybook/react-vite'
import { RemoveButton } from './RemoveButton'

/**
 * The bin every row that can be taken out of the document carries.
 *
 * It has no visible text, so the label is the whole of its name: hover and
 * focus are where the control says it is destructive, and `aria-label` is where
 * it says what it removes.
 */
const meta = {
  title: 'Units/RemoveButton',
  component: RemoveButton,
  args: { label: 'Remove digest_to', onClick: () => {} },
} satisfies Meta<typeof RemoveButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Beside the caption it belongs to, which is where every row puts it. */
export const InARow: Story = {
  render: (args) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: 8,
        inlineSize: 240,
      }}
    >
      <span
        style={{
          fontSize: '0.6875rem',
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        Name
      </span>
      <RemoveButton {...args} />
    </div>
  ),
}
