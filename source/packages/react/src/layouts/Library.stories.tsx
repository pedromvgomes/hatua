import type { Manifest } from '@hatua/schema'
import type { ManifestSource } from '@hatua/services'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Library } from './Library'

/**
 * Every state the Library has, against a fake ManifestSource.
 *
 * All of them are real. A Host fetching its catalogue over the network shows
 * loading and can show a failure; a Host on a fresh install, with no manifests
 * declared yet, shows the empty one — and that is the state most likely to be
 * mistaken for a bug, which is why it says what it says.
 *
 * The source is set through `parameters.ports`, which the preview decorator
 * hands to <HatuaProvider>. The region takes no manifests prop in any of these
 * stories, because it takes none anywhere: both embeddings mount it bare.
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
    kind: 'trigger',
    use: 'schedule.cron',
    name: 'On a schedule',
    group: 'Time',
    icon: 'clock',
    blurb: 'Starts the workflow at a time you choose.',
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
  {
    kind: 'component',
    use: 'agent.classify',
    name: 'Classify',
    group: 'Intelligence',
    icon: 'tag',
    blurb: 'Sort a value into one of a set of labels.',
    fields: [],
    outputs: [],
  },
  {
    kind: 'component',
    use: 'core.fork',
    name: 'Branch',
    icon: 'split',
    blurb: 'Take one path or several, on a condition.',
    fields: [],
    outputs: [],
  },
]

const serving = (manifests: Manifest[]): ManifestSource => ({
  loadManifests: async () => manifests,
})

/**
 * Set per story rather than once on `meta`: Storybook merges parameters, so a
 * story cannot un-set an inherited one — an unconfigured story that tried would
 * silently inherit the catalogue and show the populated state instead.
 */
const READY = { ports: { manifests: serving(CATALOGUE) } }

const meta = {
  title: 'Layouts/Library',
  component: Library,
  decorators: [
    (Story) => (
      <div style={{ blockSize: 420, inlineSize: 300, border: '1px solid var(--border-subtle)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Library>

export default meta
type Story = StoryObj<typeof meta>

/** Triggers and Components under separate headings, grouped by `group`. */
export const Populated: Story = { parameters: READY }

/** With a handler, every card becomes a control. Without one, none does. */
export const Selectable: Story = {
  parameters: READY,
  args: { onSelect: (manifest) => console.info('selected', manifest.use) },
}

export const Filtered: Story = {
  parameters: READY,
  args: { defaultQuery: 'mail' },
}

export const NothingMatches: Story = {
  parameters: READY,
  args: { defaultQuery: 'nothing here' },
}

/** A Host on a fresh install. Not a fault, and it must not read as one. */
export const Empty: Story = {
  parameters: { ports: { manifests: serving([]) } },
}

/** Never resolves, so the state stays on screen to be looked at. */
export const Loading: Story = {
  parameters: {
    ports: { manifests: { loadManifests: () => new Promise<Manifest[]>(() => {}) } },
  },
}

export const Failed: Story = {
  parameters: {
    ports: {
      manifests: {
        loadManifests: async () => {
          throw new Error('The catalogue endpoint returned 503.')
        },
      },
    },
  },
}

/** No ManifestSource at all — a wiring mistake, told apart from an empty one. */
export const Unconfigured: Story = {}
