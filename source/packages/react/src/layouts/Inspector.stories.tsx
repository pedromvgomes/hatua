import type { Manifest } from '@hatua/schema'
import type {
  ConnectionDescriber,
  ConnectionSource,
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
import { Inspector } from './Inspector'

/**
 * Every state the step editor has, against a fake WorkflowStore and a fake
 * ManifestSource.
 *
 * The selection is an argument, because it is chrome held by whatever composes
 * the regions (ADR-0020) — a Segment naming one Board and the Steps on it. The
 * document is not an argument and never is: the ports go through
 * `parameters.ports`, which the preview decorator hands to <HatuaProvider>.
 */

const SOURCE = `# The overnight triage. Comments here survive every edit.
id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft

connections:
  - id: ops_mailbox
    ref: ref_ops

triggers:
  - id: t1
    use: component.schedule.cron
    name: "Every morning"

vars:
  - key: digest_to
    t: text
    value: "ops@example.com"

steps:
  - id: s1
    use: component.email.fetch
    name: "Fetch the mail"
    with:
      # only the unread ones
      folder: "INBOX"
      mailbox: ops_mailbox
  - id: s2
    use: component.email.send
    name: "Send the digest"
    with:
      to: "{{ var.digest_to }}"
      subject: "{{ var.digest_to }} — nightly"
      body: "Hello"
      urgent: true
      retries: 2
      importance: high
      secret_key: "abc123"
  - id: s3
    use: component.unknown.verb
    name: "Something the catalogue lost"

blocks:
  - id: archive
    name: "Archive an entry"
    params:
      - { k: thread, label: "Thread", t: text }
    steps:
      - id: b1
        use: component.email.send
        name: "Acknowledge"
`

const BARE = `id: wf_new
name: "Untitled workflow"
version: 1
status: draft
steps:
  - id: s1
    use: component.email.send
`

const HALF_WRITTEN = 'name: half written\nsteps:\n  - use: component.email.send\n'

const CATALOGUE: Manifest[] = [
  {
    kind: 'trigger',
    use: 'component.schedule.cron',
    name: 'On a schedule',
    fields: [{ k: 'at', label: 'Runs at', kind: 'mono' }],
    outputs: [{ k: 'at', label: 'When it ran', t: 'datetime' }],
  },
  {
    kind: 'component',
    use: 'component.email.fetch',
    name: 'Fetch mail',
    blurb: 'Reads a mailbox.',
    fields: [
      { k: 'folder', label: 'Folder', kind: 'text', ph: 'INBOX' },
      { k: 'mailbox', label: 'Mailbox', kind: 'conn', conn_type: 'email', req: true },
    ],
    outputs: [{ k: 'messages', label: 'Messages', t: 'list' }],
  },
  {
    // Every mappable kind on one Step, which is the row-by-row look at the form.
    kind: 'component',
    use: 'component.email.send',
    name: 'Send mail',
    fields: [
      { k: 'to', label: 'To', kind: 'text', req: true },
      { k: 'subject', label: 'Subject', kind: 'text' },
      { k: 'body', label: 'Body', kind: 'textarea', hint: 'Anything worth saying.' },
      { k: 'urgent', label: 'Urgent', kind: 'bool' },
      { k: 'retries', label: 'Retries', kind: 'number' },
      {
        k: 'importance',
        label: 'Importance',
        kind: 'enum',
        options: [
          { value: 'high', label: 'High' },
          { value: 'low', label: 'Low' },
        ],
      },
      { k: 'secret_key', label: 'Signing key', kind: 'secret' },
    ],
    outputs: [],
  },
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

const ESTABLISHED = [
  { ref: 'ref_ops', type: 'email', label: 'Ops mailbox' },
  { ref: 'ref_support', type: 'email', label: 'Support inbox' },
]

const connectionPorts = (): {
  connections: ConnectionSource
  describeConnection: ConnectionDescriber
} => ({
  connections: {
    async listConnections() {
      return { items: ESTABLISHED.map(({ ref, type }) => ({ ref, type })) }
    },
  },
  describeConnection: {
    async describe(ref) {
      const found = ESTABLISHED.find((connection) => connection.ref === ref)
      if (!found) throw new Error(`no such connection "${ref}"`)
      return { type: found.type, label: found.label, status: 'ready', details: {} }
    },
  },
})

/**
 * Set per story rather than once on `meta`: Storybook merges parameters, so a
 * story cannot un-set an inherited one — the unconfigured story that tried
 * would silently inherit a workflow and show a form instead.
 */
const wired = (store: WorkflowStore, manifests: Manifest[] | null = CATALOGUE) => ({
  ports: {
    workflows: store,
    ...(manifests ? { manifests: catalogue(manifests) } : {}),
    ...connectionPorts(),
  },
  workflowId: 'wf',
})

const meta = {
  title: 'Layouts/Inspector',
  component: Inspector,
  decorators: [
    (Story) => (
      <div
        style={{ blockSize: 620, inlineSize: 404, border: '1px solid var(--hatua-border-subtle)' }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Inspector>

export default meta
type Story = StoryObj<typeof meta>

/** Every mappable field kind on one Step, which is the form row by row. */
export const EveryFieldKind: Story = {
  args: { selected: { board: null, steps: ['s2'] } },
  parameters: wired(serving(SOURCE)),
}

/** A `conn` field, offering the names this workflow declares and the Host's spare handles. */
export const WithAConnection: Story = {
  args: { selected: { board: null, steps: ['s1'] } },
  parameters: wired(serving(SOURCE)),
}

/**
 * Nothing selected. Not an error and not a fault — the ordinary state of a
 * screen nobody has clicked yet.
 */
export const NothingSelected: Story = { parameters: wired(serving(SOURCE)) }

/**
 * A Segment of several. Extraction consumes one and this cannot: the fields
 * belong to one Step, and a form over several would have to invent what a
 * shared value means.
 */
export const SeveralSelected: Story = {
  args: { selected: { board: null, steps: ['s1', 's2'] } },
  parameters: wired(serving(SOURCE)),
}

/**
 * A Step whose verb nothing declares — a hand-edited `use:`, or a Host that
 * stopped serving one. The Step stays: hiding it would leave nobody able to
 * remove the thing that is blocking Publish.
 */
export const UndeclaredVerb: Story = {
  args: { selected: { board: null, steps: ['s3'] } },
  parameters: wired(serving(SOURCE)),
}

/**
 * A Step inside a Block. Its scope is the Board's — the Block's parameters and
 * its own variables — and never the workflow's, because ids are Board-local and
 * a Block called twice starts clean both times.
 */
export const InsideABlock: Story = {
  args: { selected: { board: 'archive', steps: ['b1'] } },
  parameters: wired(serving(SOURCE)),
}

/**
 * The Data panel pointing at `var.digest_to`. Every field whose Template reads
 * it is marked, which is the only thing on screen relating a leaf in one column
 * to the fields it fills in another.
 */
export const PointedAtFromTheDataPanel: Story = {
  args: { selected: { board: null, steps: ['s2'] }, highlight: 'var.digest_to', expanded: true },
  parameters: wired(serving(SOURCE)),
}

/** A Step nobody has filled in yet. Unfinished is not the same as wrong. */
export const NothingFilledIn: Story = {
  args: { selected: { board: null, steps: ['s1'] } },
  parameters: wired(serving(BARE)),
}

/**
 * A Host that wired storage and no catalogue. The Step is still named and still
 * identified, because the document is what declares it; what its fields ARE is
 * the catalogue's to say, and only that is missing.
 */
export const NoCatalogue: Story = {
  args: { selected: { board: null, steps: ['s1'] } },
  parameters: wired(serving(SOURCE), null),
}

/**
 * Parsed, held, and not a Workflow Definition. `toJSON()` throws here, so there
 * is no Step to resolve — and the document is still open, still editable and
 * about to be fixed in Text Mode. See ADR-0001.
 */
export const NotAWorkflowYet: Story = {
  args: { selected: { board: null, steps: ['s1'] } },
  parameters: wired(serving(HALF_WRITTEN)),
}

/** Never resolves, so the state stays on screen to be looked at. */
export const Opening: Story = {
  parameters: wired(serving(SOURCE, { openDraft: () => new Promise<DraftSession>(() => {}) })),
}

export const Failed: Story = {
  parameters: wired(
    serving(SOURCE, {
      openDraft: async () => {
        throw new Error('Another session holds the draft.')
      },
    }),
  ),
}

/** No WorkflowStore at all — a wiring mistake, told apart from an empty workflow. */
export const Unconfigured: Story = {}
