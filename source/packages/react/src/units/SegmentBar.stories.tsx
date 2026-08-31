import type { Meta, StoryObj } from '@storybook/react-vite'
import { SegmentBar } from './SegmentBar'

/**
 * The bar of actions over the selected Steps.
 *
 * It floats at the lower start of whatever holds the canvas, so every story
 * gives it a positioned box to float in.
 */
const meta = {
  title: 'Units/SegmentBar',
  component: SegmentBar,
  args: {
    count: 3,
    onRemove: () => {},
  },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          inlineSize: 420,
          blockSize: 220,
          background: 'var(--hatua-surface-sunken)',
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SegmentBar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/**
 * A Segment of one is a Segment, so the bar is drawn for it — and the count
 * reads "1 step" rather than "1 steps".
 */
export const OneStep: Story = { args: { count: 1 } }

/** A selection large enough to reach past the edge of the viewport, which is
 * what the count is for. */
export const Many: Story = { args: { count: 12 } }

/** Both actions, which is what the canvas draws for an ordinary selection. */
export const WithExtract: Story = { args: { onExtract: () => {} } }

/**
 * A selection holding a **Return**, which extraction refuses (ADR-0018).
 *
 * The control stays and is announced as disabled rather than disappearing: a
 * control that vanished as the selection grew past a Return would leave the
 * reader with no way to learn what they did. The reason rides on the button as
 * its description and as a tooltip.
 */
export const ExtractRefused: Story = {
  args: { onExtract: () => {}, holdsReturn: true },
}

/**
 * The refusal on a Segment of one, where the whole selection is the Return —
 * the shape the canvas produces from a single click on a Return card.
 */
export const ExtractRefusedOneStep: Story = {
  args: { count: 1, onExtract: () => {}, holdsReturn: true },
}

/**
 * Every action absent. The bar still says how many Steps are selected, which is
 * the half of it that is not an action.
 */
export const CountOnly: Story = { args: { onRemove: undefined } }
