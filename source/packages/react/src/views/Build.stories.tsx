import type { Manifest } from '@hatua/schema'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Data } from '../layouts/Data'
import { FlowMap } from '../layouts/FlowMap'
import { Inspector } from '../layouts/Inspector'
import { Library } from '../layouts/Library'
import { TabbedPanel } from '../layouts/TabbedPanel'
import { TopBar } from '../layouts/TopBar'
import { Build } from './Build'

/**
 * Enough of a catalogue for the Library to have something to show. The shell is
 * still what is on review here; a region that renders "no manifests are wired
 * up" inside it would read as a broken shell rather than as an unwired story.
 */
const CATALOGUE: Manifest[] = [
  {
    kind: 'trigger',
    use: 'email.received',
    name: 'When mail arrives',
    group: 'Email',
    icon: 'inbox',
    blurb: 'Starts the workflow when a message arrives.',
    fields: [],
    outputs: [],
  },
  {
    kind: 'component',
    use: 'email.send',
    name: 'Send email',
    group: 'Email',
    icon: 'mail',
    blurb: 'Send a message through a connected mailbox.',
    fields: [],
    outputs: [],
  },
  {
    kind: 'component',
    use: 'agent.act',
    name: 'Run agent',
    group: 'Intelligence',
    icon: 'zap',
    blurb: "Ask a model to act on the workflow's data.",
    fields: [],
    outputs: [],
  },
]

const meta = {
  title: 'Views/Build',
  component: Build,
  parameters: {
    layout: 'fullscreen',
    ports: { manifests: { loadManifests: async () => CATALOGUE } },
  },
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
            { id: 'library', label: 'Library', content: <Library /> },
            { id: 'flow', label: 'Flow', content: <FlowMap /> },
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
