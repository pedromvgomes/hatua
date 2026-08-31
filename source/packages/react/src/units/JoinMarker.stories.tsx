import { LAYOUT } from '@hatua/layout'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { JoinMarker } from './JoinMarker'

/**
 * Where a Fork's Branches come back together — the one region drawn side by
 * side, and so the one that needs saying where the alternatives stop.
 *
 * Not a connector. There is no edge here and no Step it joins *to*.
 */
const meta = {
  title: 'Units/JoinMarker',
  component: JoinMarker,
  args: {
    join: {
      owner: { board: null, id: 'sort' },
      x: 0,
      y: 0,
      width: 2 * LAYOUT.nodeWidth + LAYOUT.branchGap,
      height: LAYOUT.joinMarker,
    },
    name: 'How urgent?',
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', inlineSize: 560, blockSize: 60 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof JoinMarker>

export default meta
type Story = StoryObj<typeof meta>

export const Converging: Story = {}
