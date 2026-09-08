import type { ManifestEntry, WorkflowExecution } from '@hatua/schema'
import type {
  Cursor,
  DraftSession,
  EditToken,
  ExecutionSource,
  ExecutionSummary,
  Lease,
  ManifestSource,
  PublishedVersion,
  VersionSummary,
  WorkflowStore,
} from '@hatua/services'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect } from 'react'
import { useExecutionStore } from '../theme/HatuaProvider'
import { RunStep } from './RunStep'

/**
 * The pane about the run, in both of its subjects.
 *
 * The run itself when nothing is selected, and one Step when something is. The
 * pair is the point: `logEntry.step` is what ties them together, and one pane is
 * what makes carrying it worth anything.
 *
 * The totals in the first story are derived here from the per-Step values, using
 * the `measure` and `dimension` roles the manifests declare — the schema refuses
 * a run-level metadata block outright, because runners each inventing their own
 * summary shape is a pane that can render none of them generically.
 */

const SOURCE = `id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft
steps:
  - id: s1
    use: component.email.fetch
    name: "Fetch the mail"
  - id: s4
    use: core.for_each
    name: "Each message"
    with:
      list: "{{ steps.s1.messages }}"
    steps:
      - id: s5
        use: component.agent.classify
        name: "Classify it"
`

const CATALOGUE: ManifestEntry[] = [
  {
    kind: 'component',
    use: 'component.email.fetch',
    name: 'Fetch mail',
    fields: [],
    outputs: [{ k: 'messages', label: 'Messages', t: 'list' }],
  },
  {
    kind: 'component',
    use: 'component.agent.classify',
    name: 'Classify',
    fields: [],
    outputs: [{ k: 'label', label: 'Label', t: 'text' }],
    metadata: [
      { k: 'tokens', label: 'Tokens used', t: 'number', role: 'measure', unit: 'tokens' },
      { k: 'model', label: 'Model', t: 'text', role: 'dimension' },
    ],
  },
]

const EXECUTION = {
  run_id: 'run_8f2',
  status: 'failed',
  workflow: { id: 'wf_morning', version: 4 },
  trigger: { id: 't1', payload: { triggered_at: '2026-08-18T07:00:00Z', folder: 'INBOX' } },
  started_at: '2026-08-18T07:00:00.000Z',
  duration_ms: 1470,
  steps: [
    {
      id: 's1',
      status: 'succeeded',
      duration_ms: 120,
      resolved_input: { folder: 'INBOX', since: '2026-08-17T07:00:00Z' },
      output: { count: 24 },
    },
    {
      id: 's4',
      status: 'failed',
      duration_ms: 1340,
      iterations: [
        {
          index: 0,
          status: 'succeeded',
          duration_ms: 410,
          steps: [
            {
              id: 's5',
              status: 'succeeded',
              duration_ms: 400,
              output: { label: 'invoice' },
              metadata: { tokens: 1840, model: 'claude-haiku-4-5' },
            },
          ],
        },
        {
          index: 1,
          status: 'failed',
          duration_ms: 930,
          steps: [
            {
              id: 's5',
              status: 'failed',
              duration_ms: 920,
              error: { message: 'The model did not answer in time.', code: 'UPSTREAM_TIMEOUT' },
              metadata: { tokens: 60, model: 'claude-haiku-4-5' },
            },
          ],
        },
      ],
    },
  ],
  log: [
    { at: '2026-08-18T07:00:00.000Z', message: 'Run started' },
    {
      at: '2026-08-18T07:00:00.200Z',
      step: 's1',
      channel: 'email',
      message: 'Fetched 24 messages',
    },
    {
      at: '2026-08-18T07:00:01.500Z',
      step: 's5',
      channel: 'error',
      message: 'The model did not answer in time.',
    },
    { at: '2026-08-18T07:00:01.500Z', message: 'Run failed' },
  ],
} as unknown as WorkflowExecution

const token = 'tok_story' as EditToken
const lease: Lease = { token, expiresAt: '2099-01-01T00:00:00.000Z' }

const workflows = (yaml = SOURCE): WorkflowStore => ({
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
})

const catalogue = (manifests: ManifestEntry[]): ManifestSource => ({
  loadManifests: async () => manifests,
})

const runs = (options: { hang?: boolean; fail?: Error } = {}): ExecutionSource => ({
  listExecutions(): Promise<Cursor<ExecutionSummary>> {
    return Promise.resolve({ items: [] })
  },
  loadExecution() {
    if (options.hang) return new Promise<WorkflowExecution>(() => {})
    if (options.fail) return Promise.reject(options.fail)
    return Promise.resolve(EXECUTION)
  },
})

const wired = (executions: ExecutionSource | null) => ({
  ports: {
    workflows: workflows(),
    manifests: catalogue(CATALOGUE),
    ...(executions ? { executions } : {}),
  },
  workflowId: 'wf_morning',
})

/**
 * Opens the run, the way `views/Runs` does when a row is pressed.
 *
 * The pane reads what is open and opens nothing itself, so a story showing one
 * has to supply the half the view supplies. It draws nothing.
 */
function Opened({ runId = 'run_8f2' }: { runId?: string }) {
  const store = useExecutionStore()
  useEffect(() => {
    void store?.open(runId).catch(() => {})
  }, [store, runId])
  return null
}

const meta = {
  title: 'Layouts/RunStep',
  component: RunStep,
  decorators: [
    (Story) => (
      <div
        style={{ blockSize: 620, inlineSize: 404, border: '1px solid var(--hatua-border-subtle)' }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RunStep>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Nothing selected, so the subject is the run: what happened, what fired it, and
 * the totals summed from every Step's metadata — 1,900 tokens across two passes
 * that nobody reported as a total.
 */
export const TheWholeRun: Story = {
  parameters: wired(runs()),
  render: (args) => (
    <>
      <Opened />
      <RunStep {...args} />
    </>
  ),
}

/** One Step: the values that reached it, and the values it produced. */
export const OneStep: Story = {
  args: { selected: { board: null, steps: ['s1'] } },
  parameters: wired(runs()),
  render: (args) => (
    <>
      <Opened />
      <RunStep {...args} />
    </>
  ),
}

/**
 * A Step inside a loop. `iterations` exists because a flat `stepId -> status`
 * list cannot say "succeeded once and failed once" — the head shows the worst of
 * them, which is what the card on the map shows too, and the passes are here.
 */
export const EveryPassOfALoop: Story = {
  args: { selected: { board: null, steps: ['s5'] } },
  parameters: wired(runs()),
  render: (args) => (
    <>
      <Opened />
      <RunStep {...args} />
    </>
  ),
}

/**
 * Several Steps selected. A run reports per Step, so a Segment of several is a
 * question with several answers — said, rather than resolved by describing the
 * first, which would describe something other than what is highlighted.
 */
export const SeveralSelected: Story = {
  args: { selected: { board: null, steps: ['s1', 's4'] } },
  parameters: wired(runs()),
  render: (args) => (
    <>
      <Opened />
      <RunStep {...args} />
    </>
  ),
}

/** Nothing opened yet, which is where this pane starts. */
export const NoRunOpen: Story = { parameters: wired(runs()) }

/** The record in flight. */
export const Loading: Story = {
  parameters: wired(runs({ hang: true })),
  render: (args) => (
    <>
      <Opened />
      <RunStep {...args} />
    </>
  ),
}

/**
 * A record the Host would not serve. Ordinary for a Host that keeps summaries
 * longer than it keeps bodies, which is why the list beside this one goes on
 * answering.
 */
export const Unreadable: Story = {
  parameters: wired(runs({ fail: new Error('That run is no longer available.') })),
  render: (args) => (
    <>
      <Opened />
      <RunStep {...args} />
    </>
  ),
}

/** No `ExecutionSource`. Misconfiguration copy, naming the prop that fixes it. */
export const NoPort: Story = { parameters: wired(null) }
