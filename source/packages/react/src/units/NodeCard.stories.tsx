import { LAYOUT } from '@hatua/layout'
import type { Manifest, Step } from '@hatua/schema'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { NodeCard } from './NodeCard'

/**
 * One Step as a card, in every state the canvas puts it in.
 *
 * The two heights are the point: `LAYOUT.nodeHeight` is the name and the verb,
 * `nodeHeightWithMeta` also carries the chips row, and `heightOf` picks between
 * them on whether the Step has a filled **Slot** — which only a Component
 * Manifest names. That is one rule for a leaf and a container alike: a
 * `core.fork` declares `fields: []` and gets no row, while a
 * `core.for_each` declares `list` and gets one.
 */
const LEAF: Step = { id: 's1', use: 'component.email.fetch', name: 'Fetch mail', with: {} }

const FETCH: Manifest = {
  kind: 'component',
  use: 'component.email.fetch',
  name: 'Fetch mail',
  icon: '/icons/mail.svg',
  fields: [
    { k: 'connection', label: 'Mailbox', kind: 'conn' },
    { k: 'query', label: 'Query', kind: 'text' },
  ],
  outputs: [],
}

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

/** A leaf with nothing filled in: the name, the verb, and 64px. */
export const Leaf: Story = { args: { manifest: FETCH } }

/** The same Step with its Slots filled — the chips row, and the taller card. */
export const WithChips: Story = {
  args: {
    rect: tallRect,
    manifest: FETCH,
    step: { ...LEAF, with: { connection: 'mailbox', query: 'is:unread newer_than:1d' } },
    connections: new Map([['mailbox', 'mcp/gmail']]),
  },
}

/**
 * A Slot holding a bare Reference shows the path it names rather than the
 * braces. The braces are syntax, and a card is not where anyone edits it.
 */
export const Reference: Story = {
  args: {
    rect: tallRect,
    manifest: FETCH,
    step: { ...LEAF, with: { query: '{{ steps.s0.subject }}' } },
  },
}

export const Selected: Story = { args: { manifest: FETCH, selected: true } }

/**
 * A Fork: a container, and the short card.
 *
 * `core.fork` declares `fields: []`, so there is nothing to put in a row — which
 * is why "is it a container" is the wrong question and "has it anything to say"
 * is the right one.
 */
export const Container: Story = {
  args: {
    manifest: { kind: 'component', use: 'core.fork', name: 'Branch', fields: [], outputs: [] },
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
    manifest: FETCH,
    problems: [
      { code: 'FIELD_REQUIRED', blocks: 'publish', message: 'Fill in “to”.' },
      {
        code: 'COMPONENT_UNKNOWN',
        blocks: 'publish',
        message: 'Nothing declares this component.',
      },
    ],
  },
}

/**
 * A call whose Block will not run, with nothing wrong on this card at all.
 *
 * The same marker for a different reason: the distinction matters to whoever
 * fixes it and not to whoever is reading the Board, and a call that looks
 * finished on a workflow that cannot run is what this exists to end.
 */
export const CallIntoTrouble: Story = {
  args: {
    step: { id: 's5', use: 'block.archive_entry', name: 'Archive one', with: {} },
    opens: 'archive_entry',
    callsBrokenBlock: true,
  },
}

/** No manifest: the neutral coin, and no row, whatever the Step's `with:` holds. */
export const NoCatalogue: Story = {
  args: { step: { ...LEAF, with: { query: 'is:unread' } } },
}
