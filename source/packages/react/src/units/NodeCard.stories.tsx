import { LAYOUT } from '@hatua/layout'
import type { Step } from '@hatua/schema'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { NodeCard } from './NodeCard'

/**
 * One Step as a card, in every state the canvas puts it in.
 *
 * The two heights are the point: `LAYOUT.nodeHeight` is a name and nothing
 * else, `nodeHeightWithMeta` also carries the summary row, and `heightOf` picks
 * between them on `isContainer` — so the summary is on exactly the taller cards
 * and a leaf has nowhere to put one.
 */
const LEAF: Step = { id: 's1', use: 'component.email.fetch', name: 'Fetch mail', with: {} }

const leafRect = { x: 0, y: 0, width: LAYOUT.nodeWidth, height: LAYOUT.nodeHeight }
const tallRect = { x: 0, y: 0, width: LAYOUT.nodeWidth, height: LAYOUT.nodeHeightWithMeta }

const meta = {
  title: 'Units/NodeCard',
  component: NodeCard,
  args: { step: LEAF, rect: leafRect, onSelect: () => {} },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', inlineSize: LAYOUT.nodeWidth + 40, blockSize: 140 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NodeCard>

export default meta
type Story = StoryObj<typeof meta>

/** A leaf: a name and nothing else, which is what 64px is for. */
export const Leaf: Story = {}

export const Selected: Story = { args: { selected: true } }

/** A container, and the summary row the taller card exists to carry. */
export const Container: Story = {
  args: {
    rect: tallRect,
    step: {
      id: 's2',
      use: 'core.fork',
      name: 'How urgent?',
      with: { mode: 'condition' },
      branches: [
        { label: 'Urgent', when: '{{ var.x }}', steps: [] },
        { label: 'Otherwise', steps: [] },
      ],
    },
  },
}

/**
 * A `core.try` carrying only a handler.
 *
 * The summary is enumerated off `regionsOf`, so it says `handler` here. Read off
 * `steps:` alone it would say `core.try` and nothing more — a card with a
 * chevron and an `on failure` region under it, describing itself as a leaf.
 */
export const HandlerOnly: Story = {
  args: {
    rect: tallRect,
    step: {
      id: 's3',
      use: 'core.try',
      name: 'Publish the digest',
      with: {},
      handler: [{ id: 's4', use: 'core.end' }],
    },
  },
}

export const Collapsed: Story = { args: { ...Container.args, expanded: false } }

/**
 * A call site. A Block is a doorway into another Board rather than a body drawn
 * inline (ADR-0013), so this opens rather than expands.
 */
export const Call: Story = {
  args: {
    step: { id: 's5', use: 'block.archive_entry', name: 'Archive one', with: {} },
    opens: 'archive_entry',
  },
}

/** The marker is colour; the reasons are text, for everyone it does not reach. */
export const Invalid: Story = {
  args: {
    problems: [
      { code: 'FIELD_REQUIRED', blocks: 'publish', message: 'Fill in “to”.' },
      { code: 'COMPONENT_UNKNOWN', blocks: 'publish', message: 'Nothing declares this component.' },
    ],
  },
}
