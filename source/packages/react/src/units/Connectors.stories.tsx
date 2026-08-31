import { LAYOUT } from '@hatua/layout'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Connectors } from './Connectors'

/**
 * The lines between the cards, on their own.
 *
 * A run is a straight drop down one spine and a join is a dashed S bringing one
 * Branch's frame back to the mark where the columns converge. The gaps at a
 * region's two ends are not lines at all — containment is drawn as overlap, so
 * a line keeps meaning only "then". The endpoints come from `@hatua/layout`;
 * the curve between them is this component's.
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
      // Neither of these is drawn: a gap at a region's edge has no line.
      { kind: 'enter', from: { x: 110, y: 150 }, to: { x: 110, y: 200 } },
      { kind: 'leave', from: { x: 370, y: 200 }, to: { x: 370, y: 260 } },
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

/** A Fork: two columns back to one mark, and the gaps that draw nothing. */
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
