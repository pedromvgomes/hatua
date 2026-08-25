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
    (Story) => (
      <div
        style={{
          position: 'relative',
          inlineSize: LAYOUT.nodeWidth + 4 * LAYOUT.regionInset,
          blockSize: 320,
        }}
      >
        <Story />
        <div
          style={{
            position: 'absolute',
            left: 2 * LAYOUT.regionInset,
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

/** A `core.try`: two Bands stacked in one Nest, and no spine between them. */
export const TwoRegions: Story = {
  decorators: [
    (Story) => (
      <>
        <Story />
        <RegionBand
          band={{
            kind: 'body',
            keyword: 'attempt',
            owner: { board: null, id: 'guarded' },
            x: LAYOUT.regionInset,
            y: LAYOUT.nodeHeight + LAYOUT.regionLabel,
            width: LAYOUT.nodeWidth + 2 * LAYOUT.regionInset,
            height: LAYOUT.emptyRegion,
          }}
        />
        <RegionBand
          band={{
            kind: 'handler',
            keyword: 'on failure',
            owner: { board: null, id: 'guarded' },
            x: LAYOUT.regionInset,
            y: LAYOUT.nodeHeight + 2 * LAYOUT.regionLabel + LAYOUT.emptyRegion,
            width: LAYOUT.nodeWidth + 2 * LAYOUT.regionInset,
            height: LAYOUT.emptyRegion,
          }}
        />
      </>
    ),
  ],
}
