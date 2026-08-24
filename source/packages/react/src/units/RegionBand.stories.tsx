import { LAYOUT } from '@hatua/layout'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { RegionBand } from './RegionBand'

/**
 * The band is what tells regions apart.
 *
 * A `core.try`'s body, its handler and a loop's body are the same shape stacked
 * under the card that owns them, so the word over each is the difference — and
 * every one of these words comes from `regionsOf`, which is also where
 * `<StepList>`'s chips come from.
 */
const meta = {
  title: 'Units/RegionBand',
  component: RegionBand,
  args: {
    band: {
      kind: 'body',
      keyword: 'loop',
      owner: { board: null, id: 'each' },
      x: 0,
      y: 0,
      width: LAYOUT.nodeWidth + 40,
      height: LAYOUT.regionLabel + 90,
    },
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', inlineSize: LAYOUT.nodeWidth + 80, blockSize: 160 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RegionBand>

export default meta
type Story = StoryObj<typeof meta>

export const Loop: Story = {}

/** `try`, not `loop`: `steps:` holds a loop's children and a try's body alike. */
export const TryBody: Story = { args: { band: { ...meta.args.band, keyword: 'try' } } }

export const Handler: Story = {
  args: { band: { ...meta.args.band, kind: 'handler', keyword: 'on failure' } },
}

/** A Branch: the keyword the fork's shape decides, then the label a user wrote. */
export const Branch: Story = {
  args: {
    band: { ...meta.args.band, kind: 'branch', keyword: 'else if' },
    label: 'Quiet',
    when: '{{ steps.fetch.count }} == 0',
  },
}

/**
 * A region with nothing in it: a card's width and a label's height.
 *
 * The one place the band is the only thing on screen, which is why the geometry
 * hands it over rather than leaving a canvas to infer it from the cards inside.
 */
export const Empty: Story = {
  args: { band: { ...meta.args.band, keyword: 'on failure', height: LAYOUT.regionLabel } },
}
