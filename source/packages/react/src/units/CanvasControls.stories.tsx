import type { Meta, StoryObj } from '@storybook/react-vite'
import { CanvasControls } from './CanvasControls'

/**
 * The canvas's toolbar: `−`, the current percentage, `+`, and fit.
 *
 * It floats at the lower right of whatever holds the canvas, so every story
 * gives it a positioned box to float in.
 */
const meta = {
  title: 'Units/CanvasControls',
  component: CanvasControls,
  args: {
    scale: 1,
    min: 0.1,
    max: 4,
    levels: [0.5, 1, 2],
    onZoomIn: () => {},
    onZoomOut: () => {},
    onZoomTo: () => {},
    onFit: () => {},
  },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          inlineSize: 420,
          blockSize: 220,
          background: 'var(--hatua-surface-sunken)',
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CanvasControls>

export default meta
type Story = StoryObj<typeof meta>

export const AtOneHundred: Story = {}

/** Zoom is continuous, so the label lands wherever a pinch or a step left it. */
export const BetweenLevels: Story = { args: { scale: 0.83 } }

/** The bottom of the range: `−` stays on screen and stops taking a pointer. */
export const FullyOut: Story = { args: { scale: 0.1 } }

/** And the top of it. */
export const FullyIn: Story = { args: { scale: 4 } }
