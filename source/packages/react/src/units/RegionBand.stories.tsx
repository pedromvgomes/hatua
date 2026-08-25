import { LAYOUT } from '@hatua/layout'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { RegionBand } from './RegionBand'

/**
 * The band is one region's extent, and the word over its top edge is what tells
 * regions apart.
 *
 * A `core.try`'s body, its handler and a loop's body are the same shape, so the
 * word over each is what separates them — and every one of these words comes
 * from `regionsOf`, which is also where `<StepList>`'s chips come from.
 *
 * The legend sits above the frame's top edge rather than on it: a word
 * straddling a border has to mask the line behind it, and a translucent fill
 * has no one colour to mask with. It is also the control that folds the column,
 * because it is the one mark on screen naming this region and nothing else.
 */
const meta = {
  title: 'Units/RegionBand',
  component: RegionBand,
  args: {
    owner: 'Each attachment',
    band: {
      kind: 'body',
      keyword: 'loop',
      owner: { board: null, id: 'each' },
      always: false,
      collapsed: false,
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

export const Loop: Story = { args: { count: 2 } }

/**
 * `attempt`, not `loop`: `steps:` holds a loop's children and a try's body alike.
 *
 * Solid, because it always starts — and it is a solid edge beside a dashed one
 * that tells a `core.try` from a two-Branch Fork (ADR-0015).
 */
export const TryBody: Story = {
  args: { count: 2, band: { ...meta.args.band, keyword: 'attempt', always: true } },
}

/** Dashed: a handler runs only on failure, and it has a solid sibling to be read against. */
export const Handler: Story = {
  args: {
    count: 2,
    band: { ...meta.args.band, kind: 'handler', keyword: 'on failure' },
    dashed: true,
  },
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
    count: 2,
    band: { ...meta.args.band, kind: 'branch', keyword: 'else if', branchIndex: 1 },
    label: 'Has new mail',
    when: '{{ steps.fetch.count }} > 0',
    dashed: true,
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
 *
 * **Its word is not a control**, because there is nothing behind it to fold:
 * folded, it would be a box reading "0 steps" with the `+` gone, which is
 * neither of the two states the count exists to separate. The chevron's box is
 * still reserved, so the word sits the same distance from the frame's left edge
 * as a foldable sibling's.
 */
export const Empty: Story = {
  args: {
    band: { ...meta.args.band, kind: 'handler', keyword: 'on failure', height: LAYOUT.emptyRegion },
    count: 0,
  },
}

/**
 * A column folded shut: a box the height of an empty one, carrying how many
 * Steps it is holding back.
 *
 * Without the count a folded box and an empty one are the same rect, and they
 * mean opposite things — one is somewhere to add a Step, the other is Steps out
 * of sight.
 */
export const Folded: Story = {
  args: {
    band: { ...meta.args.band, collapsed: true, height: LAYOUT.emptyRegion },
    count: 3,
  },
}
