import type { Manifest } from '@hatua/schema'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Components } from '../layouts/Components'
import { Data } from '../layouts/Data'
import { FlowMap } from '../layouts/FlowMap'
import { Inspector } from '../layouts/Inspector'
import { StepList } from '../layouts/StepList'
import { TabbedPanel } from '../layouts/TabbedPanel'
import { TopBar } from '../layouts/TopBar'
import { Build } from './Build'

/**
 * Enough of a catalogue for the Components tab to have something to show. The shell is
 * still what is on review here; a region that renders "no manifests are wired
 * up" inside it would read as a broken shell rather than as an unwired story.
 */
/**
 * Stand-in artwork. `icon` is a URL the Host serves, so a story needs one that
 * resolves with no server behind it — `data:` URIs are the third form the field
 * accepts, alongside absolute and root-relative.
 *
 * The stroke colour is baked into the file because an <img> cannot inherit
 * `currentColor`. That is the Host's problem to own, not Hatua's: this mid
 * slate is legible on both the light and the dark card, which is exactly the
 * judgement a Host serving brand icons has to make for itself.
 */
const icon = (path: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#7c86a3" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`,
  )}`

const GLYPH = {
  inbox:
    '<path d="M2.5 13.5h5l1.5 2.5h6l1.5-2.5h5"/><path d="M5.2 5h13.6l2.7 8.5v3a2 2 0 0 1-2 2H4.5a2 2 0 0 1-2-2v-3z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.4 2"/>',
  mail: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M3 7l8.4 5.6a1.5 1.5 0 0 0 1.2 0L21 7"/>',
  zap: '<path d="M13.5 2.5 4 13.5h6.5L10 21.5 20 10.5h-6.5z"/>',
  tag: '<path d="M3 11.2V4a1 1 0 0 1 1-1h7.2a2 2 0 0 1 1.4.6l7.4 7.4a2 2 0 0 1 0 2.8l-6.2 6.2a2 2 0 0 1-2.8 0L3.6 12.6a2 2 0 0 1-.6-1.4z"/><circle cx="7.8" cy="7.8" r="1.4"/>',
  split:
    '<path d="M12 21V9"/><path d="M12 9 6.5 3.5"/><path d="M12 9l5.5-5.5"/><circle cx="12" cy="21" r="1.5"/>',
} as const

const CATALOGUE: Manifest[] = [
  {
    kind: 'trigger',
    use: 'component.email.received',
    name: 'When mail arrives',
    group: 'Email',
    icon: icon(GLYPH.inbox),
    blurb: 'Starts the workflow when a message arrives.',
    fields: [],
    outputs: [],
  },
  {
    kind: 'component',
    use: 'component.email.send',
    name: 'Send email',
    group: 'Email',
    icon: icon(GLYPH.mail),
    blurb: 'Send a message through a connected mailbox.',
    fields: [],
    outputs: [],
  },
  {
    kind: 'component',
    use: 'component.agent.act',
    name: 'Run agent',
    group: 'Intelligence',
    icon: icon(GLYPH.zap),
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

/**
 * Every region but the Components and Workflow tabs is a stub until its own PR; what is on review
 * here is the shell — and specifically that all three columns are on screen at
 * once, with the canvas in the middle rather than behind a tab.
 *
 * Tall and wide on purpose: <Build> has a 1240px floor and scrolls sideways
 * below it, so a story in a narrow frame would be showing the scroll rather
 * than the layout.
 */
export const Shell: Story = {
  render: () => (
    <div style={{ blockSize: 560, inlineSize: 1280, maxInlineSize: '100%' }}>
      <Build />
    </div>
  ),
}

/**
 * The same regions, arranged by hand — the Inspector on the left, the toolbar
 * at the bottom, no Data tab, and no 1240px floor. This is what a Host does
 * instead of `<Build>`, and it is here rather than only in the playground
 * because the difference between "movable" and "movable in theory" is worth
 * being able to look at.
 */
export const ComposedByAHost: Story = {
  render: () => (
    <div
      style={{
        blockSize: 480,
        display: 'grid',
        gridTemplateColumns: 'minmax(180px, 240px) minmax(200px, 260px) minmax(0, 1fr)',
        gridTemplateRows: 'minmax(0, 1fr) auto',
      }}
    >
      <div style={{ gridColumn: 1, gridRow: 1 }}>
        <Inspector />
      </div>
      <div style={{ gridColumn: 2, gridRow: 1, minInlineSize: 0 }}>
        <TabbedPanel
          tabs={[
            { id: 'flow', label: 'Flow', content: <StepList /> },
            { id: 'components', label: 'Components', content: <Components /> },
          ]}
        />
      </div>
      {/* The canvas keeps a column here too. A Host may move it, drop it, or
          size it differently — but it is not something the tab strip holds. */}
      <div style={{ gridColumn: 3, gridRow: 1, minInlineSize: 0 }}>
        <FlowMap />
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
