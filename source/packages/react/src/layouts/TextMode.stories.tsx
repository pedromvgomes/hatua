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
import { useEffect } from 'react'
import { useEditingStore } from '../theme/HatuaProvider'
import { TextMode } from './TextMode'

/**
 * **Text Mode** in the three states that make it worth having.
 *
 * A document that projects, one that does not, and one nobody may edit. The
 * middle one is the whole argument: every other region reads `definition` and is
 * empty there, so this is the only surface with anything to say — and the only
 * one a broken document is repaired on (ADR-0001, ADR-0026).
 */

const SOURCE = `# Triage the overnight inbox before standup.
id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft

triggers:
  - id: t1
    use: component.schedule.cron
    name: "Every morning"
    with:
      cron: "0 7 * * 1-5"

vars:
  - key: digest_to
    t: text
    value: "ops@example.com"

steps:
  - id: s1
    use: component.email.fetch
    name: "Fetch the mail"
    with:
      folder: INBOX      # not Archive
  - id: s2
    use: component.email.send
    name: "Send the digest"
    with:
      to: "{{ var.digest_to }}"
`

/**
 * Parsed as YAML and not a **Workflow Definition**: `steps:` is a string.
 *
 * Written as a plain string rather than a template literal on purpose.
 * `stories.fixtures.test.ts` holds every backtick fixture to the schema,
 * because a story that quietly stops projecting draws the wrong screen — and
 * this one is *about* not projecting, which is the one case that guard must not
 * catch.
 */
const HALF_WRITTEN =
  '# Halfway through a rewrite.\nid: wf_morning\nname: "Morning inbox triage"\n' +
  'version: 4\nstatus: draft\nsteps: the ones from before\n'

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

const wired = (store: WorkflowStore | null) => ({
  ports: store ? { workflows: store } : {},
  workflowId: store ? 'wf' : undefined,
})

/** Ends the session, the way Publish, Release and Discard all do. */
function Ended() {
  const store = useEditingStore()
  useEffect(() => {
    // After the open, because a release before the claim exists is a no-op.
    const timer = setTimeout(() => void store?.release().catch(() => {}), 0)
    return () => clearTimeout(timer)
  }, [store])
  return null
}

const meta = {
  title: 'Layouts/TextMode',
  component: TextMode,
  decorators: [
    (Story) => (
      <div
        style={{ blockSize: 620, inlineSize: 720, border: '1px solid var(--hatua-border-subtle)' }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TextMode>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The file as the Host stored it — comments, key order and the author's quoting
 * intact, because nothing here re-serialises a typed projection (ADR-0001).
 */
export const TheDocument: Story = { parameters: wired(serving(SOURCE)) }

/**
 * Parsed, held, and not a **Workflow Definition**. The canvas, the side panel
 * and the step editor are all empty on this document; this is where it gets
 * fixed, and the line under the box says what is wrong with it.
 */
export const NotAWorkflowYet: Story = { parameters: wired(serving(HALF_WRITTEN)) }

/**
 * The session has ended. The document is intact, saved nowhere, and every action
 * on the toolbar discards it — so this is the escape: the text is still here and
 * still selectable, which is the whole of what `useReadOnly()` leaves behind.
 */
export const AfterTheSessionEnded: Story = {
  parameters: wired(serving(SOURCE)),
  render: (args) => (
    <>
      <Ended />
      <TextMode {...args} />
    </>
  ),
}

/** The Draft still opening. */
export const Opening: Story = {
  parameters: wired(serving(SOURCE, { openDraft: () => new Promise<DraftSession>(() => {}) })),
}

/** A Host that could not serve the Draft at all. There is no text to show. */
export const FailedToOpen: Story = {
  parameters: wired(
    serving(SOURCE, {
      openDraft: () => Promise.reject(new Error('That workflow could not be opened.')),
    }),
  ),
}

/** No `WorkflowStore`. Misconfiguration copy, naming the prop that fixes it. */
export const NoPort: Story = { parameters: wired(null) }
