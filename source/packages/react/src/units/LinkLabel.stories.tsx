import type { Meta, StoryObj } from '@storybook/react-vite'
import { LinkLabel } from './LinkLabel'

/**
 * The word on the line entering a region — **what tells regions apart.**
 *
 * A `core.try`'s body, its handler and a loop's body are all stacked under the
 * card that owns them in the same shape. The geometry does not distinguish them
 * and is not meant to; the word does, and it comes from `regionsOf` so the chip
 * here and `<StepList>`'s are one string from one function.
 */
const meta = {
  title: 'Units/LinkLabel',
  component: LinkLabel,
  args: { at: { x: 170, y: 40 }, keyword: 'loop' },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', inlineSize: 360, blockSize: 90 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LinkLabel>

export default meta
type Story = StoryObj<typeof meta>

export const Loop: Story = {}

/** `try`, not `loop`: `steps:` holds a loop's children and a try's body alike. */
export const TryBody: Story = { args: { keyword: 'try' } }

export const Handler: Story = { args: { keyword: 'on failure' } }

/** A Branch: the keyword the fork's shape decides, then the label a user wrote. */
export const Branch: Story = {
  args: { keyword: 'else if', label: 'Quiet', when: '{{ steps.fetch.count }} == 0' },
}
