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
    use: 'email.received',
    name: 'When mail arrives',
    group: 'Email',
    icon: icon(GLYPH.inbox),
    blurb: 'Starts the workflow when a message arrives.',
    fields: [],
    outputs: [],
  },
  {
    kind: 'trigger',
    use: 'schedule.cron',
    name: 'On a schedule',
    group: 'Time',
    icon: icon(GLYPH.clock),
    blurb: 'Starts the workflow at a time you choose.',
    fields: [],
    outputs: [],
  },
  {
    kind: 'component',
    use: 'email.send',
    name: 'Send email',
    group: 'Email',
    icon: icon(GLYPH.mail),
    blurb: 'Send a message through a connected mailbox.',
    fields: [],
    outputs: [],
  },
  {
    kind: 'component',
    use: 'agent.act',
    name: 'Run agent',
    group: 'Intelligence',
    icon: icon(GLYPH.zap),
    blurb: "Ask a model to act on the workflow's data.",
    fields: [],
    outputs: [],
  },
  {
    kind: 'component',
    use: 'agent.classify',
    name: 'Classify',
    group: 'Intelligence',
    icon: icon(GLYPH.tag),
    blurb: 'Sort a value into one of a set of labels.',
    fields: [],
    outputs: [],
  },
  {
    kind: 'component',
    use: 'core.fork',
    name: 'Branch',
    icon: icon(GLYPH.split),
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
      <div
        style={{ blockSize: 420, inlineSize: 300, border: '1px solid var(--hatua-border-subtle)' }}
      >
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
