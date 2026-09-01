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
  - id: s_bad
    use: component.email.send
    name: "Two fields the checker refuses"
    with:
      to: "{{ steps.s1 }}"
      subject: "{{ steps.s1 }}"
      retries: 2
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
  // Never offered for an email field: `conn_type` filters the picker, which is
  // why a Step holding this one can only be a hand-edit.
  { ref: 'ref_brain', type: 'llm', label: 'A model' },
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
const wired = (
  store: WorkflowStore,
  manifests: Manifest[] | null = CATALOGUE,
  connections: object = connectionPorts(),
) => ({
  ports: {
    workflows: store,
    ...(manifests ? { manifests: catalogue(manifests) } : {}),
    ...connections,
  },
  workflowId: 'wf',
})

/*
 * One Step holding one `conn` field, over what the document says its Connection
 * is.
 *
 * Written out whole rather than interpolated from one template: `stories.fixtures`
 * reads these literals out of the source and projects each one, and a document
 * assembled at runtime is a document nothing checks.
 *
 * The four connection codes are the only rules whose answer is not in the
 * document, so what separates these stories is a pair — what the file declares,
 * and what the Host is able to say about it.
 */

const CONNECTED = `id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft
connections:
  - id: ops_mailbox
    ref: ref_ops
steps:
  - id: s1
    use: component.email.fetch
    name: "Fetch the mail"
    with:
      folder: "INBOX"
      mailbox: ops_mailbox
`

/** A handle the Host lists nothing for. */
const REVOKED = `id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft
connections:
  - id: ops_mailbox
    ref: ref_gone
steps:
  - id: s1
    use: component.email.fetch
    name: "Fetch the mail"
    with:
      folder: "INBOX"
      mailbox: ops_mailbox
`

/** An LLM handle in a field that wants email, which only a hand-edit can produce. */
const WRONG_TYPE = `id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft
connections:
  - id: ops_mailbox
    ref: ref_brain
steps:
  - id: s1
    use: component.email.fetch
    name: "Fetch the mail"
    with:
      folder: "INBOX"
      mailbox: ops_mailbox
`

/** Declared and never wired, which is how every workflow starts. */
const NEVER_ESTABLISHED = `id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft
connections:
  - id: ops_mailbox
    ref: null
steps:
  - id: s1
    use: component.email.fetch
    name: "Fetch the mail"
    with:
      folder: "INBOX"
      mailbox: ops_mailbox
`

const AT_THE_CONN_FIELD: Story['args'] = { selected: { board: null, steps: ['s1'] } }

/** A port that never answers, so the picker and the checker both stay waiting. */
const stillLoading = { connections: { listConnections: () => new Promise<never>(() => {}) } }

/** A port that answers with an error. Nothing here will make the types appear. */
const failing = {
  connections: {
    async listConnections(): Promise<never> {
      throw new Error('The connection service is unavailable.')
    },
  },
}

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
 * Two Templates the checker refuses, on one Step.
 *
 * Each message sits under the control it names. Collected above the form they
 * are two sentences both beginning "This expression expects…", and neither says
 * which field to go and fix.
 */
export const FieldsTheCheckerRefuses: Story = {
  args: { selected: { board: null, steps: ['s_bad'] } },
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

/*
 * Two of the four codes block editing, so the three stories where the Host
 * cannot answer are the ones worth looking at hardest — the form must stay
 * exactly as usable as it is when the Host answers perfectly.
 */

/** No `ConnectionSource` wired. A correct configuration, not a broken one — and no picker. */
export const NoConnectionPort: Story = {
  args: AT_THE_CONN_FIELD,
  parameters: wired(serving(CONNECTED), CATALOGUE, {}),
}

/**
 * The port has not answered yet. The field says so, and the checker says nothing
 * about a type it cannot know — "no longer resolves" here would be a lie on
 * every Connection in the workflow.
 */
export const ConnectionsStillLoading: Story = {
  args: AT_THE_CONN_FIELD,
  parameters: wired(serving(CONNECTED), CATALOGUE, stillLoading),
}

/**
 * The port answered with an error. The field carries the Host's message and a
 * Retry; the checker stays silent, because nothing it does will make a type
 * appear.
 */
export const ConnectionsFailed: Story = {
  args: AT_THE_CONN_FIELD,
  parameters: wired(serving(CONNECTED), CATALOGUE, failing),
}

/**
 * A handle the Host lists nothing for — revoked, deleted, or from another
 * environment. Blocks publish and not editing: a Connection going away outside
 * the builder is not something building did wrong.
 */
export const ConnectionTheHostDoesNotRecognise: Story = {
  args: AT_THE_CONN_FIELD,
  parameters: wired(serving(REVOKED)),
}

/**
 * An LLM Connection in a field that wants email. Blocks editing, because the
 * picker filters by `conn_type` and ordinary building cannot produce this — only
 * a hand-edit can.
 */
export const ConnectionOfTheWrongType: Story = {
  args: AT_THE_CONN_FIELD,
  parameters: wired(serving(WRONG_TYPE)),
}

/**
 * Declared and never wired. Blocks publish and not editing — laying out a whole
 * workflow before connecting anything is the ordinary way to start one.
 *
 * The diagnostic names the Connection and no Step, so no region that draws
 * Steps, Triggers or Blocks would ever find it. It reaches a screen because the
 * field pointing at the Connection looks it up by the id it holds.
 */
export const ConnectionNeverEstablished: Story = {
  args: AT_THE_CONN_FIELD,
  parameters: wired(serving(NEVER_ESTABLISHED)),
}
