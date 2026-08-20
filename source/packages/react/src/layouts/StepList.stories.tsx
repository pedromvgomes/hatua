import type {
  Cursor,
  DraftSession,
  EditToken,
  Lease,
  PublishedVersion,
  VersionSummary,
  WorkflowStore,
} from '@hatua/services'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { StepList } from './StepList'

/**
 * Every state the Flow tab has, against a fake WorkflowStore.
 *
 * All of them are real. Hatua has no storage of its own — the Host supplies the
 * Workflow Definition through this port — so a Host reading a workflow over the
 * network shows the opening state and can show a failure, and a Host handing
 * over a half-written file shows the one that says so. That last one is the
 * state ADR-0001 forces this region to have and the one most likely to be
 * mistaken for a bug, which is why it says what it says.
 *
 * The port is set through `parameters.ports`, which the preview decorator hands
 * to <HatuaProvider> alongside `workflowId`. The region takes no document prop
 * in any of these stories, because it takes none anywhere.
 */

const SIMPLE = `# The overnight triage. Comments here survive every edit.
id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft

steps:
  - id: s1
    use: email.fetch
    name: "Fetch mail"
  - id: s2
    use: agent.classify
    name: "Sort by urgency"
  - id: s3
    use: email.send
    name: "Send digest"
`

const DEEP = `id: wf_deep
name: "Everything at once"
version: 2
status: draft

steps:
  - id: s1
    use: email.fetch
    name: "Fetch mail"
  - id: s2
    use: core.fork
    name: "How urgent?"
    branches:
      - label: Urgent
        when: "{{ s1.count > 10 }}"
        steps:
          - id: s3
            use: chat.post
            name: "Ping the channel"
          - id: s4
            use: core.for_each
            name: "Each message"
            steps:
              - id: s5
                use: agent.classify
                name: "Classify"
      - label: Quiet
        when: "{{ s1.count > 0 }}"
        steps:
          - id: s6
            use: email.send
            name: "Send digest"
      - label: Otherwise
        steps: []
  - id: s7
    use: core.fork
    name: "Notify everyone"
    branches:
      - label: Email
        steps:
          - id: s8
            use: email.send
            name: "Mail the team"
      - label: Chat
        steps:
          - id: s9
            use: chat.post
            name: "Post to chat"
  - id: s10
    use: core.for_each
    name: "Archive each"
    steps:
      - id: s11
        use: email.archive
        name: "Archive"
`

const EMPTY = `id: wf_empty\nname: "Nothing yet"\nversion: 1\nstatus: draft\nsteps: []\n`

const HALF_WRITTEN = `name: half written\nsteps:\n  - use: email.send\n`

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

/**
 * Set per story rather than once on `meta`: Storybook merges parameters, so a
 * story cannot un-set an inherited one — the unconfigured story that tried
 * would silently inherit a workflow and show the tree instead.
 */
const wired = (store: WorkflowStore) => ({ ports: { workflows: store }, workflowId: 'wf' })

const meta = {
  title: 'Layouts/StepList',
  component: StepList,
  decorators: [
    (Story) => (
      <div
        style={{ blockSize: 520, inlineSize: 304, border: '1px solid var(--hatua-border-subtle)' }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StepList>

export default meta
type Story = StoryObj<typeof meta>

/** A flat workflow: three Steps and the insert points between them. */
export const Flat: Story = { parameters: wired(serving(SIMPLE)) }

/**
 * Forks, a fallback Branch, a nested loop and an empty Branch — the whole
 * vocabulary in one document. `if` / `else if` / `else` for a condition fork
 * and `and` for a parallel one, read from whether any Branch carries `when`,
 * because the schema has no mode field.
 */
export const DeepTree: Story = { parameters: wired(serving(DEEP)) }

/**
 * With a handler, every insert point becomes a `+` — and an empty Branch
 * becomes the control that fills it rather than a label describing a drop
 * nothing on this screen can perform.
 */
export const Insertable: Story = {
  parameters: wired(serving(DEEP)),
  args: {
    onInsert: (at) => console.info('insert at', at),
    onSelect: (id) => console.info('selected', id),
  },
}

export const Selected: Story = {
  parameters: wired(serving(DEEP)),
  args: { defaultSelectedId: 's3' },
}

/**
 * A workflow a user has started and not filled in. Not a fault — and with no
 * `onInsert` it is a drop target rather than a control, because moving an
 * existing Step in needs no catalogue while adding a new one does.
 */
export const NoSteps: Story = { parameters: wired(serving(EMPTY)) }

/** The same, given somewhere to send the insert point. */
export const NoStepsInsertable: Story = {
  parameters: wired(serving(EMPTY)),
  args: { onInsert: (at) => console.info('insert at', at) },
}

/**
 * Parsed, held, and not a Workflow Definition. `toJSON()` throws here, so there
 * is no tree — and the document is still open, still editable and about to be
 * fixed in Text Mode. See ADR-0001.
 */
export const NotAWorkflowYet: Story = { parameters: wired(serving(HALF_WRITTEN)) }

/** Never resolves, so the state stays on screen to be looked at. */
export const Opening: Story = {
  parameters: wired(serving(SIMPLE, { openDraft: () => new Promise<DraftSession>(() => {}) })),
}

export const Failed: Story = {
  parameters: wired(
    serving(SIMPLE, {
      openDraft: async () => {
        throw new Error('Another session holds the draft.')
      },
    }),
  ),
}

/**
 * A Host that says no to every write. Remove a Step with the × and watch what
 * happens: ADR-0005 has autosave halt and the in-memory document kept — not
 * retried, not discarded — so the panel announces it and the tree stays exactly
 * as the edit left it, still editable and still undoable.
 */
export const SavingHalted: Story = {
  parameters: wired(
    serving(SIMPLE, {
      saveDraft: async () => {
        throw new Error('Your lease expired.')
      },
    }),
  ),
  args: { onSelect: (id) => console.info('selected', id) },
}

/** No WorkflowStore at all — a wiring mistake, told apart from an empty workflow. */
export const Unconfigured: Story = {}
