import type { Meta, StoryObj } from '@storybook/react-vite'
import { InsertDot } from './InsertDot'

/**
 * The `+` on a link: where a Step is added, and where one is dropped.
 *
 * A real button, because it is the only unambiguous way to say "here and not
 * there" on a map whose gaps are 96px of nothing — and because a drop target
 * nobody can reach from the keyboard needs a sibling that can.
 */
const meta = {
  title: 'Units/InsertDot',
  component: InsertDot,
  args: { at: { x: 60, y: 40 }, label: 'Insert a Step after Fetch mail' },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', inlineSize: 140, blockSize: 90 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InsertDot>

export default meta
type Story = StoryObj<typeof meta>

export const Insertable: Story = { args: { onInsert: () => {} } }

/** A drag is in progress, so every gap says it is a target before the pointer arrives. */
export const Live: Story = { args: { onInsert: () => {}, onDrop: () => {}, active: true } }

/**
 * No handler for adding one. The dot is a drop target and nothing else — the
 * state `apps/playground/src/host.tsx` mounts, where moving an existing Step
 * needs no catalogue while adding a new one does.
 */
export const DropOnly: Story = { args: { onDrop: () => {} } }
