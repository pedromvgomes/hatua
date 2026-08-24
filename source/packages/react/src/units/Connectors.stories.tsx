import { LAYOUT } from '@hatua/layout'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Connectors } from './Connectors'

/**
 * The lines between the cards, on their own.
 *
 * A run is a straight drop down one spine; a Fork's divergence is a dashed S out
 * to each column; a join brings each column back to the mark. The endpoints come
 * from `@hatua/layout` — the curve between them is this component's.
 */
const spine = { x: 240, y: 0 }

const meta = {
  title: 'Units/Connectors',
  component: Connectors,
  args: {
    width: 480,
    height: 360,
    links: [
      { kind: 'run', from: spine, to: { x: 240, y: 90 } },
      { kind: 'branch', from: { x: 240, y: 90 }, to: { x: 110, y: 200 }, label: 'if' },
      { kind: 'branch', from: { x: 240, y: 90 }, to: { x: 370, y: 200 }, label: 'else' },
      { kind: 'join', from: { x: 110, y: 260 }, to: { x: 240, y: 330 } },
      { kind: 'join', from: { x: 370, y: 260 }, to: { x: 240, y: 330 } },
    ],
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', inlineSize: 480, blockSize: 360 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Connectors>

export default meta
type Story = StoryObj<typeof meta>

/** A Fork: out to two columns and back to one mark. */
export const Forking: Story = {}

/** A straight run of Steps, which is what most of a workflow is. */
export const Run: Story = {
  args: {
    links: [
      { kind: 'run', from: { x: 240, y: 0 }, to: { x: 240, y: LAYOUT.verticalGap } },
      {
        kind: 'run',
        from: { x: 240, y: LAYOUT.verticalGap },
        to: { x: 240, y: LAYOUT.verticalGap * 2 },
      },
    ],
  },
}
