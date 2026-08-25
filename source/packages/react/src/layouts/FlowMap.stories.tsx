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
import { FlowMap } from './FlowMap'

/**
 * The canvas against a fake WorkflowStore.
 *
 * Every number on screen comes from one `layout(board, { collapsed })` call, so
 * these stories are the geometry with something drawn on it: the cards from
 * `placements`, each region's frame and its word from `bands`, the mark where a
 * Fork's Branches converge from `joins`, and the node above the first Step from
 * `root`.
 *
 * The region takes no document prop in any of them, because it takes none
 * anywhere — the port is set through `parameters.ports`, which the preview
 * decorator hands to <HatuaProvider> alongside `workflowId`.
 */

const DEEP = `id: wf_map
name: "Everything at once"
version: 3
status: draft

triggers:
  - id: nightly
    use: core.schedule
    name: "Weekday mornings"
    with: {}

steps:
  - id: s1
    use: component.email.fetch
    name: "Fetch mail"
  - id: s2
    use: core.fork
    name: "How urgent?"
    with: { mode: condition }
    branches:
      - label: Urgent
        when: "{{ steps.s1.count > 10 }}"
        steps:
          - id: s3
            use: core.try
            name: "Publish the digest"
            with: { attempts: 2 }
            steps:
              - id: s4
                use: component.chat.post
                name: "Ping the channel"
            handler:
              - id: s5
                use: component.email.send
                name: "Mail it instead"
      - label: Quiet
        when: "{{ steps.s1.count > 0 }}"
        steps:
          - id: s6
            use: core.for_each
            name: "Each message"
            with: {}
            steps:
              - id: s7
                use: component.agent.classify
                name: "Classify"
      - label: Otherwise
        steps: []
  - id: s8
    use: block.archive_entry
    name: "Archive the digest"
    with: {}

blocks:
  - id: archive_entry
    name: "Archive an entry"
    params:
      - { k: entry, label: Entry, t: object }
      - { k: at, label: "Archived at", t: datetime }
    outputs:
      - { k: url, label: "Archive URL", t: text }
    steps:
      - id: put
        use: component.s3.upload
        name: "Upload it"
        with: {}
      - id: ret
        use: core.return
        name: "Hand back the URL"
        with: { url: "{{ steps.put.location }}" }
`

const EMPTY = `id: wf_empty
name: "Nothing yet"
version: 1
status: draft
triggers:
  - id: manual
    use: core.manual
    with: {}
steps: []
`

/**
 * No `id:`, which is what stops it projecting — and what keeps
 * `stories.fixtures.test.ts` from asserting that it does. That guard exists so a
 * fixture cannot stop satisfying the schema unnoticed; this one is not a
 * Workflow Definition on purpose.
 */
const HALF_WRITTEN = `name: mid edit\nsteps:\n  - use: component.email.fetch\n`

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
    return { version: 4, publishedAt: '2026-01-01T00:00:00.000Z' }
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

/** Set per story: Storybook merges parameters, so a story cannot un-set one. */
const wired = (store: WorkflowStore) => ({ ports: { workflows: store }, workflowId: 'wf' })

const meta = {
  title: 'Layouts/FlowMap',
  component: FlowMap,
  decorators: [
    (Story) => (
      <div
        style={{ blockSize: 720, inlineSize: 900, border: '1px solid var(--hatua-border-subtle)' }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FlowMap>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The whole vocabulary on one Board: a Fork's three Branches as dashed columns
 * over the mark where they converge, a `core.try`'s two as one solid column
 * beside a dashed one over a mark of their own, a loop's single solid body under
 * `loop` with no mark under it, an empty Branch that is still a band, and a call
 * with a doorway rather than a body drawn inline.
 *
 * Nothing distinguishes a Fork from a try structurally: what does is the edge
 * (ADR-0015).
 */
export const DeepTree: Story = { parameters: wired(serving(DEEP)) }

/**
 * One column folded shut, its siblings still drawn.
 *
 * A different relief from folding the Step: the Nest is still there, and the
 * box says how many Steps it is holding back rather than offering a `+`.
 */
export const FoldedRegion: Story = {
  parameters: wired(serving(DEEP)),
  args: { defaultCollapsedRegions: [{ board: null, id: 's3', kind: 'handler' }] },
}

/** A Step selected, which is the thing the step editor is about. */
export const Selected: Story = {
  parameters: wired(serving(DEEP)),
  args: { defaultSelected: { board: null, id: 's3' } },
}

/**
 * A container folded shut. Its children get no geometry at all, so the map's
 * totals describe the map that is on screen rather than one with hidden cards
 * counted into it.
 */
export const Collapsed: Story = {
  parameters: wired(serving(DEEP)),
  args: { defaultCollapsed: [{ board: null, id: 's2' }] },
}

/**
 * A Block's Board, reached through the call on the root.
 *
 * One Board at a time (ADR-0013): the root node is the Block's contract rather
 * than the workflow's Triggers, and the breadcrumb is the way back.
 */
export const BlockBoard: Story = {
  parameters: wired(serving(DEEP)),
  args: { defaultBoardId: 'archive_entry' },
}

/** A workflow a user has started and not filled in: the root node and nothing under it. */
export const NoSteps: Story = { parameters: wired(serving(EMPTY)) }

/**
 * Parsed, held, and not a Workflow Definition. There is no tree to lay out; the
 * document is still open, still editable and about to be fixed in Text Mode.
 * See ADR-0001.
 */
export const NotAWorkflowYet: Story = { parameters: wired(serving(HALF_WRITTEN)) }

/** Never resolves, so the state stays on screen to be looked at. */
export const Opening: Story = {
  parameters: wired(serving(DEEP, { openDraft: () => new Promise<DraftSession>(() => {}) })),
}

/** No WorkflowStore at all — a wiring mistake, told apart from an empty workflow. */
export const Unconfigured: Story = {}
