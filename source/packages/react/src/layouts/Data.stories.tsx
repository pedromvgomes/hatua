import type { ManifestEntry } from '@hatua/schema'
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
import { Data } from './Data'

/**
 * Every state the Data panel has, against a fake WorkflowStore and a fake
 * ManifestSource.
 *
 * What each story is really showing is `scopeFor` and `boardScope` drawn: the
 * rows are the model's answer about what a Template at that position may read,
 * and nothing here decides it.
 */

const SOURCE = `id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft

triggers:
  - id: t1
    use: component.schedule.cron
    name: "Every morning"

vars:
  - key: digest_to
    t: text
    value: "ops@example.com"
  - key: subject_prefix
    t: text
    value: "[triage]"

steps:
  - id: s1
    use: component.email.fetch
    name: "Fetch the mail"
  - id: s2
    use: core.for_each
    with:
      list: "{{ steps.s1.messages }}"
    steps:
      - id: s3
        use: component.email.send
        name: "Send the digest"
        with:
          to: "{{ var.digest_to }}"
          subject: "{{ var.digest_to }}"

blocks:
  - id: archive
    name: "Archive an entry"
    params:
      - { k: thread, label: "Thread", t: text }
    vars:
      - key: attempts
        t: number
        value: 0
    steps:
      - id: b1
        use: component.email.send
        name: "Acknowledge"
`

/** A new workflow: one Trigger, no variables, and nothing has run. */
const BARE = `id: wf_new
name: "Untitled workflow"
version: 1
status: draft
steps:
  - id: s1
    use: component.email.send
`

const HALF_WRITTEN = 'name: half written\nsteps:\n  - use: component.email.send\n'

const CATALOGUE: ManifestEntry[] = [
  {
    kind: 'trigger',
    use: 'component.schedule.cron',
    name: 'On a schedule',
    fields: [],
    outputs: [
      { k: 'at', label: 'When it ran', t: 'datetime' },
      { k: 'owner', label: 'Who owns it', t: 'text' },
    ],
  },
  {
    kind: 'component',
    use: 'component.email.fetch',
    name: 'Fetch mail',
    fields: [],
    outputs: [{ k: 'messages', label: 'Messages', t: 'list' }],
  },
  {
    kind: 'component',
    use: 'component.email.send',
    name: 'Send mail',
    fields: [
      { k: 'to', label: 'To', kind: 'text' },
      { k: 'subject', label: 'Subject', kind: 'text' },
    ],
    outputs: [{ k: 'message_id', label: 'Message id', t: 'text' }],
  },
  {
    kind: 'component',
    use: 'core.for_each',
    name: 'For each',
    fields: [{ k: 'list', label: 'List', kind: 'ref' }],
    outputs: [],
  },
  {
    // The Host's ambient values. Nothing in the document declares them, and
    // unlike a variable they cannot be edited from the builder at all.
    kind: 'context',
    keys: [
      { k: 'tenant', label: 'Tenant', t: 'text', description: 'Who the run belongs to.' },
      { k: 'now', label: 'Started at', t: 'datetime' },
    ],
  },
]

const token = 'tok_story' as EditToken
const lease: Lease = { token, expiresAt: '2099-01-01T00:00:00.000Z' }

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

const catalogue = (manifests: ManifestEntry[]): ManifestSource => ({
  loadManifests: async () => manifests,
})

const wired = (store: WorkflowStore, manifests: ManifestEntry[] | null = CATALOGUE) => ({
  ports: {
    workflows: store,
    ...(manifests ? { manifests: catalogue(manifests) } : {}),
  },
  workflowId: 'wf',
})

const meta = {
  title: 'Layouts/Data',
  component: Data,
  decorators: [
    (Story) => (
      <div
        style={{ blockSize: 620, inlineSize: 304, border: '1px solid var(--hatua-border-subtle)' }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Data>

export default meta
type Story = StoryObj<typeof meta>

/**
 * A Step deep inside a loop: the Trigger's outputs, Run Context, the variables,
 * the upstream Step's outputs and the loop's own `item`. The two leaves its
 * Templates already read are marked.
 */
export const ForASelectedStep: Story = {
  args: { selected: { board: null, steps: ['s3'] } },
  parameters: wired(serving(SOURCE)),
}

/**
 * Nothing selected. A position in the tree is what says which Steps are
 * guaranteed to have run, so there is no Step output to offer — and the panel
 * says which question it is answering rather than showing an empty column.
 */
export const NothingSelected: Story = { parameters: wired(serving(SOURCE)) }

/**
 * A Segment of several. A later Step reads more than an earlier one, so the
 * Board's scope — what every Step in the Segment can read — is the honest
 * answer.
 */
export const SeveralSelected: Story = {
  args: { selected: { board: null, steps: ['s1', 's2'] } },
  parameters: wired(serving(SOURCE)),
}

/**
 * A Step inside a Block. The Board's contract and its own variables are in
 * scope; the workflow's are not, because a Block called twice starts clean both
 * times.
 */
export const InsideABlock: Story = {
  args: { selected: { board: 'archive', steps: ['b1'] } },
  parameters: wired(serving(SOURCE)),
}

/** A Board with almost nothing upstream: one Trigger declaring nothing, and no variables. */
export const AlmostNothingInScope: Story = {
  args: { selected: { board: null, steps: ['s1'] } },
  parameters: wired(serving(BARE), []),
}

/**
 * A Host that wired storage and no catalogue. What a Step's outputs ARE is the
 * catalogue's to say, so the tree holds what the document itself declares.
 */
export const NoCatalogue: Story = {
  args: { selected: { board: null, steps: ['s3'] } },
  parameters: wired(serving(SOURCE), null),
}

/**
 * Parsed, held, and not a Workflow Definition. There is nothing to resolve
 * against — and the document is still open, still editable and about to be
 * fixed in Text Mode. See ADR-0001.
 */
export const NotAWorkflowYet: Story = { parameters: wired(serving(HALF_WRITTEN)) }

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
