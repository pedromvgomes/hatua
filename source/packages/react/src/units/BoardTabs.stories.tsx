import type { Meta, StoryObj } from '@storybook/react-vite'
import { BoardTabs } from './BoardTabs'

/**
 * The canvas's tab strip: which Boards are open, and which one is in front.
 *
 * It sits over the canvas at the top left of whatever holds it, so every story
 * gives it a positioned box to sit in. The box is sunken because the map is
 * what a tab is normally drawn against, and a strip on the page background
 * would show borders the canvas never shows.
 *
 * The root Board is always first and carries no close control: it is the one
 * Board that always exists, so it is the only fallback that cannot itself have
 * just been closed (ADR-0017).
 */
const meta = {
  title: 'Units/BoardTabs',
  component: BoardTabs,
  args: {
    tabs: [
      { id: null, label: 'The workflow' },
      { id: 'archive_entry', label: 'Archive an entry' },
    ],
    active: 'archive_entry',
    onActivate: () => {},
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          inlineSize: 520,
          blockSize: 140,
          background: 'var(--hatua-surface-sunken)',
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BoardTabs>

export default meta
type Story = StoryObj<typeof meta>

/** A Block's Board in front, which is what **Open** on a call site leaves. */
export const OnABlock: Story = {}

/** Back at the root, with the Block still open beside it. */
export const OnTheRoot: Story = { args: { active: null } }

/**
 * A working set of several. Boards are peers, so the order is the order they
 * were opened in and says nothing about what calls what.
 */
export const SeveralOpen: Story = {
  args: {
    tabs: [
      { id: null, label: 'The workflow' },
      { id: 'archive_entry', label: 'Archive an entry' },
      { id: 'notify', label: 'Tell the owner' },
      { id: 'cleanup', label: 'Tidy up afterwards' },
    ],
    active: 'notify',
  },
}

/**
 * A Block's name is whatever its author typed, so a tab truncates rather than
 * running: the strip sits over the map, and a tab as wide as its name covers
 * the cards it is meant to sit above.
 */
export const AVeryLongName: Story = {
  args: {
    tabs: [
      { id: null, label: 'The workflow' },
      { id: 'long', label: 'Archive an entry and tell everyone who ever asked about it' },
    ],
    active: 'long',
  },
}

/**
 * A Block with no `name:` is named by its id, which is what every reader falls
 * back to — the slug is what `use: block.<slug>` says, so it is never absent.
 */
export const NamedByItsSlug: Story = {
  args: {
    tabs: [
      { id: null, label: 'The workflow' },
      { id: 'block_1', label: 'block_1' },
    ],
    active: 'block_1',
  },
}
