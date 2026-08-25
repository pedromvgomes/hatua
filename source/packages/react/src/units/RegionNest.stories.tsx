import { LAYOUT } from '@hatua/layout'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { RegionBand } from './RegionBand'
import { RegionNest } from './RegionNest'

/**
 * A container's whole extent, with its regions inside it.
 *
 * Two frames and not one: a `core.try` owns two regions and only the body is
 * protected, so a single edge would claim either the handler — which is not —
 * or only the body, which leaves the handler outside the Step that owns it.
 *
 * The card is drawn astride the top edge, which is why these stories put one
 * there: nothing joins a Step to its own regions, and the overlap is the whole
 * of what says the regions are its.
 */
const meta = {
  title: 'Units/RegionNest',
  component: RegionNest,
  args: {
    nest: {
      owner: { board: null, id: 'guarded' },
      x: 0,
      y: LAYOUT.nodeLid,
      width: LAYOUT.nodeWidth + 4 * LAYOUT.regionInset,
      height: 260,
    },
  },
  decorators: [
    // Sized off the Nest itself, and the card centred over it, so a story with
    // two columns in it is the same arrangement at a different width.
    (Story, { args }) => (
      <div
        style={{
          position: 'relative',
          inlineSize: args.nest.width,
          blockSize: args.nest.y + args.nest.height + 40,
        }}
      >
        <Story />
        <div
          style={{
            position: 'absolute',
            left: (args.nest.width - LAYOUT.nodeWidth) / 2,
            top: 0,
            width: LAYOUT.nodeWidth,
            height: LAYOUT.nodeHeight,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 'var(--hatua-radius-md)',
            border: '1px solid var(--hatua-border-subtle)',
            background: 'var(--hatua-surface-card)',
          }}
        >
          Try
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof RegionNest>

export default meta
type Story = StoryObj<typeof meta>

/** The frame on its own: the card's lower half is inside it, and nothing joins them. */
export const Astride: Story = {}

/**
 * A `core.try`: two Bands side by side in one Nest, and no spine between them.
 *
 * Solid beside dashed, because the body always starts and the handler needs a
 * failure. That edge is the whole of what separates this from a two-Branch Fork
 * (ADR-0015) — the arrangement is the same one at every arity.
 */
export const TwoRegions: Story = {
  args: {
    nest: {
      owner: { board: null, id: 'guarded' },
      x: 0,
      y: LAYOUT.nodeLid,
      width:
        2 * (LAYOUT.nodeWidth + 2 * LAYOUT.regionInset) + LAYOUT.branchGap + 2 * LAYOUT.regionInset,
      height:
        LAYOUT.nodeHeight +
        LAYOUT.regionLabel +
        LAYOUT.emptyRegion +
        LAYOUT.regionInset -
        LAYOUT.nodeLid,
    },
  },
  decorators: [
    (Story) => (
      <>
        <Story />
        <RegionBand
          owner="Publish the digest"
          band={{
            kind: 'body',
            keyword: 'attempt',
            owner: { board: null, id: 'guarded' },
            always: true,
            collapsed: false,
            x: LAYOUT.regionInset,
            y: LAYOUT.nodeHeight + LAYOUT.regionLabel,
            width: LAYOUT.nodeWidth + 2 * LAYOUT.regionInset,
            height: LAYOUT.emptyRegion,
          }}
        />
        <RegionBand
          owner="Publish the digest"
          band={{
            kind: 'handler',
            keyword: 'on failure',
            owner: { board: null, id: 'guarded' },
            always: false,
            collapsed: false,
            x: LAYOUT.regionInset + LAYOUT.nodeWidth + 2 * LAYOUT.regionInset + LAYOUT.branchGap,
            y: LAYOUT.nodeHeight + LAYOUT.regionLabel,
            width: LAYOUT.nodeWidth + 2 * LAYOUT.regionInset,
            height: LAYOUT.emptyRegion,
          }}
          dashed
        />
      </>
    ),
  ],
}
