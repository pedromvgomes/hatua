import { LAYOUT } from '@hatua/layout'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { RegionBand } from './RegionBand'

/**
 * The band is one region's extent, and the word over its top edge is what tells
 * regions apart.
 *
 * A `core.try`'s body, its handler and a loop's body are the same shape stacked
 * under the card that owns them, so the word over each is the difference — and
 * every one of these words comes from `regionsOf`, which is also where
 * `<StepList>`'s chips come from.
 *
 * The legend sits above the frame's top edge rather than on it: a word
 * straddling a border has to mask the line behind it, and a translucent fill
 * has no one colour to mask with.
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
      width: LAYOUT.nodeWidth + 2 * LAYOUT.regionInset,
      height: 90,
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          inlineSize: LAYOUT.nodeWidth + 80,
          blockSize: 160,
          // The room `regionLabel` reserves above the band for its legend.
          paddingBlockStart: LAYOUT.regionLabel,
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RegionBand>

export default meta
type Story = StoryObj<typeof meta>

export const Loop: Story = {}

/** `attempt`, not `loop`: `steps:` holds a loop's children and a try's body alike. */
export const TryBody: Story = { args: { band: { ...meta.args.band, keyword: 'attempt' } } }

export const Handler: Story = {
  args: { band: { ...meta.args.band, kind: 'handler', keyword: 'on failure' } },
}

/**
 * A Branch: one column among alternatives, dashed because which one runs is a
 * question the document answers at run time.
 *
 * Its legend carries the Branch's own label and its condition beside the
 * keyword, which is everything `<StepList>`'s chip says about the same region.
 */
export const Branch: Story = {
  args: {
    band: { ...meta.args.band, kind: 'branch', keyword: 'else if', branchIndex: 1 },
    label: 'Has new mail',
    when: '{{ steps.fetch.count }} > 0',
  },
}

/**
 * A region with nothing in it: a card's width, and tall enough to hold the `+`
 * that is the only way to fill it.
 *
 * The one place the band is the only thing on screen, which is why the geometry
 * hands it over rather than leaving a canvas to infer it from the cards inside.
 * At a label strip's height the `+` inside it was a target to aim at rather
 * than a drop target, which is what `emptyRegion` sizes.
 */
export const Empty: Story = {
  args: {
    band: { ...meta.args.band, kind: 'handler', keyword: 'on failure', height: LAYOUT.emptyRegion },
  },
}
