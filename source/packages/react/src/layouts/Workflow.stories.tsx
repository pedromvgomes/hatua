import type { Manifest } from '@hatua/schema'
import type {
  Cursor,
  DraftSession,
  EditToken,
  Lease,
  ManifestSource,
  PublishedVersion,
  VersionSummary,
  WorkflowStore,
} from '@hatua/services'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Workflow } from './Workflow'

/**
 * Every state the Workflow tab has, against a fake WorkflowStore and a fake
 * ManifestSource.
 *
 * All of them are real. This is the first region other than validation to read
 * two stores, and a Host that supplies one and not the other is a case the
 * ports explicitly allow — every field on `HostPorts` is optional — so the
 * story that wires a workflow and no catalogue is the one worth looking at
 * hardest: the Triggers a document declares are still listed and still
 * editable, and only the type picker is missing.
 *
 * The ports are set through `parameters.ports` and `parameters.workflowId`,
 * which the preview decorator hands to <HatuaProvider>. The region takes no
 * document prop in any of these stories, because it takes none anywhere.
 */

const FULL = `# The overnight triage. Comments here survive every edit.
id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft

triggers:
  - id: t1
    use: schedule.cron
    name: "Every morning"
    with:
      at: "0 6 * * 1-5"
      zone: utc
  - id: t2
    use: email.received
    name: "When mail arrives"
    with:
      folder: INBOX

vars:
  # Where the digest goes.
  - key: digest_to
    value: "ops@example.com"
  - key: subject_prefix
    value: "[triage]"
  - key: threshold
    value: 10
  - key: greeting
    value: "Morning, {{ triggers.t1.owner }}"

steps:
  - id: s1
    use: email.fetch
`

const BARE = `id: wf_new
name: "Untitled workflow"
version: 1
status: draft
steps: []
`

const HALF_WRITTEN = 'name: half written\nsteps:\n  - use: email.send\n'

const CATALOGUE: Manifest[] = [
  {
    kind: 'trigger',
    use: 'schedule.cron',
    name: 'On a schedule',
    blurb: 'Starts the workflow at a time you choose.',
    fields: [
      { k: 'at', label: 'Runs at', kind: 'mono', req: true, hint: 'A cron expression.' },
      { k: 'catch_up', label: 'Catch up on missed runs', kind: 'bool' },
      {
        k: 'zone',
        label: 'Time zone',
        kind: 'enum',
        options: [
          { value: 'utc', label: 'UTC' },
          { value: 'local', label: 'The workflow owner’s' },
        ],
      },
    ],
    outputs: [],
  },
  {
    kind: 'trigger',
    use: 'email.received',
    name: 'When mail arrives',
    blurb: 'Starts the workflow when a message arrives.',
    fields: [
      { k: 'folder', label: 'Folder', kind: 'text', ph: 'INBOX' },
      { k: 'from', label: 'Only from', kind: 'mono' },
    ],
    outputs: [],
  },
  { kind: 'component', use: 'email.fetch', name: 'Fetch mail', fields: [], outputs: [] },
]

const token = 'tok_story' as EditToken
const lease: Lease = { token, expiresAt: '2099-01-01T00:00:00.000Z' }

/**
 * A Host, in as few lines as the port allows. Everything below the seam is
 * faked; the seam itself is exactly what a real Host implements.
 */
const serving = (yaml: string, overrides: Partial<WorkflowStore> = {}): WorkflowStore => ({
  async openDraft(): Promise<DraftSession> {
    return { token, lease, yaml, resumed: false }
  },
  async saveDraft() {},
  async renewLease(): Promise<Lease> {
    return lease
  },
  async publish(): Promise<PublishedVersion> {
    return { version: 5, publishedAt: '2026-01-01T00:00:00.000Z' }
  },
  async releaseDraft() {},
  async discardDraft() {},
  async listVersions(): Promise<Cursor<VersionSummary>> {
    return { items: [] }
  },
  async loadVersion() {
    return yaml
  },
  ...overrides,
})

const catalogue = (manifests: Manifest[]): ManifestSource => ({
  loadManifests: async () => manifests,
})

/**
 * Set per story rather than once on `meta`: Storybook merges parameters, so a
 * story cannot un-set an inherited one — the unconfigured story that tried
 * would silently inherit a workflow and show the fields instead.
 */
const wired = (store: WorkflowStore, manifests: Manifest[] | null = CATALOGUE) => ({
  ports: { workflows: store, ...(manifests ? { manifests: catalogue(manifests) } : {}) },
  workflowId: 'wf',
})

const meta = {
  title: 'Layouts/Workflow',
  component: Workflow,
  decorators: [
    (Story) => (
      <div
        style={{ blockSize: 620, inlineSize: 304, border: '1px solid var(--hatua-border-subtle)' }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Workflow>

export default meta
type Story = StoryObj<typeof meta>

/** Two Triggers, four variables, and the identity fields above both. */
export const Populated: Story = { parameters: wired(serving(FULL)) }

/**
 * A workflow nobody has filled in. Nothing starts it and it keeps nothing —
 * neither is a fault, and neither may read as one.
 */
export const Bare: Story = { parameters: wired(serving(BARE)) }

/**
 * A Host that wired storage and no catalogue. Every Trigger the document
 * declares is still here and still editable, because the document is what
 * declares them; what is missing is the list of types to add, and that is the
 * only thing that says so.
 */
export const NoCatalogue: Story = { parameters: wired(serving(FULL), null) }

/**
 * A catalogue with no Trigger in it. Told apart from the one above: "the Host
 * wired nothing" and "the Host declared nothing" have different fixes.
 */
export const NoTriggerTypes: Story = {
  parameters: wired(serving(FULL), [CATALOGUE[2] as Manifest]),
}

/**
 * A Trigger whose type nothing declares — a hand-edited verb, or a Host that
 * stopped serving one. The row stays: hiding it would leave nobody able to
 * remove the thing that is blocking Publish.
 */
export const UndeclaredTrigger: Story = {
  parameters: wired(serving(FULL), [CATALOGUE[1] as Manifest, CATALOGUE[2] as Manifest]),
}

/**
 * Parsed, held, and not a Workflow Definition. `toJSON()` throws here, so there
 * are no fields to draw — and the document is still open, still editable and
 * about to be fixed in Text Mode. See ADR-0001.
 */
export const NotAWorkflowYet: Story = { parameters: wired(serving(HALF_WRITTEN)) }

/** Never resolves, so the state stays on screen to be looked at. */
export const Opening: Story = {
  parameters: wired(serving(FULL, { openDraft: () => new Promise<DraftSession>(() => {}) })),
}

export const Failed: Story = {
  parameters: wired(
    serving(FULL, {
      openDraft: async () => {
        throw new Error('Another session holds the draft.')
      },
    }),
  ),
}

/**
 * A Host that says no to every write. Rename the workflow and watch what
 * happens: ADR-0005 has autosave halt and the in-memory document kept — not
 * retried, not discarded — so the panel announces it and every field stays
 * exactly as the edit left it.
 */
export const SavingHalted: Story = {
  parameters: wired(
    serving(FULL, {
      saveDraft: async () => {
        throw new Error('Your lease expired.')
      },
    }),
  ),
}

/** No WorkflowStore at all — a wiring mistake, told apart from an empty workflow. */
export const Unconfigured: Story = {}
