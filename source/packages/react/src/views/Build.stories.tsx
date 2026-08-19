import type { Meta, StoryObj } from '@storybook/react-vite'
import { Data } from '../layouts/Data'
import { FlowMap } from '../layouts/FlowMap'
import { Inspector } from '../layouts/Inspector'
import { Library } from '../layouts/Library'
import { TabbedPanel } from '../layouts/TabbedPanel'
import { TopBar } from '../layouts/TopBar'
import { Build } from './Build'

const meta = {
  title: 'Views/Build',
  component: Build,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Build>

export default meta
type Story = StoryObj<typeof meta>

/** Every region is a stub until its own PR; what is on review here is the shell. */
export const Shell: Story = {
  render: () => (
    <div style={{ blockSize: 420 }}>
      <Build />
    </div>
  ),
}

/**
 * The same regions, arranged by hand — the Inspector on the left, the toolbar
 * at the bottom, no Data tab. This is what a Host does instead of `<Build>`,
 * and it is here rather than only in the playground because the difference
 * between "movable" and "movable in theory" is worth being able to look at.
 */
export const ComposedByAHost: Story = {
  render: () => (
    <div
      style={{
        blockSize: 420,
        display: 'grid',
        gridTemplateColumns: 'minmax(180px, 240px) minmax(0, 1fr)',
        gridTemplateRows: 'minmax(0, 1fr) auto',
      }}
    >
      <div style={{ gridColumn: 1, gridRow: 1 }}>
        <Inspector />
      </div>
      <div style={{ gridColumn: 2, gridRow: 1, minInlineSize: 0 }}>
        <TabbedPanel
          tabs={[
            { id: 'flow', label: 'Flow', content: <FlowMap /> },
            { id: 'library', label: 'Library', content: <Library /> },
          ]}
        />
      </div>
      <div style={{ gridColumn: '1 / -1', gridRow: 2 }}>
        <TopBar />
      </div>
    </div>
  ),
}

/**
 * One region, alone. A Host that wants only the Data browser gets no tab strip
 * and no shell — the case the whole export shape exists for.
 */
export const OneRegionAlone: Story = {
  render: () => (
    <div style={{ blockSize: 240 }}>
      <Data />
    </div>
  ),
}
