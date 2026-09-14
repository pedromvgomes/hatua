import { LAYOUT } from '@hatua/layout'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { RootNode } from './RootNode'

/**
 * The node above the first Step: chrome derived from `triggers:` or from a
 * Block's declaration, and never a `steps[]` entry.
 *
 * Drawn as a pill rather than as a card so it does not read as a Step —
 * `removeStep` cannot find it, `walkSteps` does not yield it, and
 * `unknownComponents` does not flag it.
 */
const meta = {
  title: 'Units/RootNode',
  component: RootNode,
  args: {
    rect: { x: 0, y: 0, width: LAYOUT.nodeWidth, height: LAYOUT.nodeHeight },
    title: 'Triggers',
    summary: '2 triggers',
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', inlineSize: LAYOUT.nodeWidth + 40, blockSize: 100 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RootNode>

export default meta
type Story = StoryObj<typeof meta>

/** The root Board: what starts this workflow. */
export const Triggers: Story = {}

/** A Block's Board: the contract ADR-0013's table says it sees. */
export const BlockContract: Story = {
  args: { title: 'Archive an entry', summary: '2 params · 1 output' },
}
