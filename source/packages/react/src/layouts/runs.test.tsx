import type { Manifest, ManifestEntry, WorkflowExecution } from '@hatua/schema'
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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { HatuaProvider, useExecutionStore } from '../theme/HatuaProvider'
import { RunList } from './RunList'
import { RunStep } from './RunStep'

/**
 * The two regions the **Runs** view is built from, against a Host's ports.
 *
 * Nothing here is editable and nothing here writes: a **Workflow Execution** is
 * history, and Hatua never produces one. So what these assert is what the Host
 * handed over, read back — including the two things the schema exists to make
 * possible, which are a Step that ran more than once and a total nobody
 * reported.
 */

const SOURCE = `id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft

steps:
  - id: s1
    use: component.email.fetch
    name: "Fetch mail"
  - id: s4
    use: core.for_each
    name: "Each message"
    steps:
      - id: s5
        use: component.agent.classify
        name: "Classify"
`

const CATALOGUE: Manifest[] = [
  {
    kind: 'component',
    use: 'component.email.fetch',
    name: 'Fetch mail',
    fields: [],
    outputs: [],
  },
  {
    kind: 'component',
    use: 'component.agent.classify',
    name: 'Classify',
    fields: [],
    outputs: [],
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
  trigger: { id: 't1', payload: { triggered_at: '2026-08-18T07:00:00Z' } },
  started_at: '2026-08-18T07:00:00.000Z',
  duration_ms: 1470,
  steps: [
    {
      id: 's1',
      status: 'succeeded',
      duration_ms: 120,
      resolved_input: { folder: 'INBOX' },
      output: { count: 24 },
    },
    {
      id: 's4',
      status: 'failed',
      iterations: [
        {
          index: 0,
          status: 'succeeded',
          steps: [{ id: 's5', status: 'succeeded', metadata: { tokens: 1840, model: 'haiku' } }],
        },
        {
          index: 1,
          status: 'failed',
          steps: [
            {
              id: 's5',
              status: 'failed',
              error: { message: 'timed out', code: 'UPSTREAM_TIMEOUT' },
              metadata: { tokens: 60, model: 'haiku' },
            },
          ],
        },
      ],
    },
  ],
  log: [
    { at: '2026-08-18T07:00:00.000Z', message: 'Run started' },
    { at: '2026-08-18T07:00:01.000Z', step: 's5', channel: 'error', message: 'Upstream timed out' },
  ],
} as unknown as WorkflowExecution

const SUMMARIES: ExecutionSummary[] = [
  { runId: 'run_8f2', status: 'failed', startedAt: '2026-08-18T07:00:00.000Z', durationMs: 1470 },
  { runId: 'run_7a1', status: 'succeeded', startedAt: '2026-08-17T07:00:00.000Z', durationMs: 900 },
]

const token = 'tok_test' as EditToken
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

const runs = (
  options: { pages?: Cursor<ExecutionSummary>[]; failLoad?: Error } = {},
): ExecutionSource => {
  const pages = options.pages ?? [{ items: SUMMARIES }]
  let index = 0
  return {
    async listExecutions() {
      const page = pages[Math.min(index, pages.length - 1)]
      index += 1
      return page as Cursor<ExecutionSummary>
    },
    async loadExecution() {
      if (options.failLoad) throw options.failLoad
      return EXECUTION
    },
  }
}

const serving = (manifests: ManifestEntry[]): ManifestSource => ({
  loadManifests: async () => manifests,
})

const mount = (children: ReactNode, options: { executions?: ExecutionSource | null } = {}) =>
  render(
    <HatuaProvider
      ports={{
        workflows: workflows(),
        manifests: serving(CATALOGUE),
        ...(options.executions === null ? {} : { executions: options.executions ?? runs() }),
      }}
      workflowId="wf_morning"
    >
      {children}
    </HatuaProvider>,
  )

/**
 * The list, wired to the store the way `views/Runs` wires it.
 *
 * The region reports a row and opens nothing itself, which is the property the
 * test above asserts — so a pane test needs the half that view supplies.
 */
function Opening() {
  const store = useExecutionStore()
  return <RunList onOpen={(runId) => void store?.open(runId).catch(() => {})} />
}

/** Open the newest run, which is the row every test below starts from. */
const openNewest = async () => {
  await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(0))
  fireEvent.click(screen.getAllByRole('button')[0] as HTMLElement)
}

describe('the list of runs', () => {
  it('says the port is missing rather than showing an empty history', () => {
    // "The Host wired nothing" and "this workflow has not run" are different
    // problems with different fixes, and only one of them is the user's.
    mount(<RunList />, { executions: null })
    expect(screen.getByText(/No run history is wired up/)).toBeDefined()
  })

  it('says a workflow has not run in the words of somebody looking at it', async () => {
    mount(<RunList />, { executions: runs({ pages: [{ items: [] }] }) })
    await waitFor(() => expect(screen.getByText('This workflow has not run yet.')).toBeDefined())
  })

  it('draws a row per run, with what happened in words and not only in colour', async () => {
    mount(<RunList />)
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2))

    const rows = screen.getAllByRole('button').map((row) => row.textContent ?? '')
    expect(rows[0]).toContain('2026-08-18 07:00')
    expect(rows[0]).toContain('Failed')
    expect(rows[1]).toContain('Succeeded')
  })

  it('reports a row that was pressed and opens nothing itself', async () => {
    const opened: string[] = []
    mount(<RunList onOpen={(id) => opened.push(id)} />)
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2))

    // Opening a run is two stores' work — the record here, and the version it
    // references on the editing store — so this region chooses and something
    // above it opens.
    fireEvent.click(screen.getAllByRole('button')[0] as HTMLElement)
    expect(opened).toEqual(['run_8f2'])
  })

  it('pages rather than draining, because a nightly workflow has years of history', async () => {
    mount(<RunList />, {
      executions: runs({
        pages: [
          { items: [SUMMARIES[0] as ExecutionSummary], next: 'p2' },
          { items: [SUMMARIES[1] as ExecutionSummary] },
        ],
      }),
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show more' })).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull())
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })
})

describe('the pane about the run', () => {
  it('says what to do before a run is picked', () => {
    mount(<RunStep />)
    expect(screen.getByText('Pick a run to see what happened.')).toBeDefined()
  })

  it('draws the run itself when no Step is selected, with totals nobody reported', async () => {
    mount(
      <>
        <Opening />
        <RunStep />
      </>,
    )
    await openNewest()

    await waitFor(() => expect(screen.getByText('This run')).toBeDefined())
    // The schema refuses a run-level metadata block outright: 1840 + 60 is
    // derived here from the per-Step values, using the roles the manifest
    // declares.
    expect(screen.getByText('1900 tokens')).toBeDefined()
    expect(screen.getByText('Run started')).toBeDefined()
  })

  it('draws one Step, with the values that reached it and the values it produced', async () => {
    mount(
      <>
        <Opening />
        <RunStep selected={{ board: null, steps: ['s1'] }} />
      </>,
    )
    await openNewest()

    await waitFor(() => expect(screen.getByText('Fetch mail')).toBeDefined())
    // Scoped to the pane: the row that opened this run says `Succeeded` too, and
    // about a different thing.
    const pane = screen.getByRole('region', { name: 'Run' })
    expect(within(pane).getByText('Succeeded')).toBeDefined()
    // `resolved_input` is the one thing the definition cannot show: a Template
    // says where a value comes from, this says what arrived.
    //
    // Read off the pane's text rather than matched as one node: a payload is
    // drawn as coloured spans, so the string a reader sees is assembled from
    // several — which is also the property worth holding, since a highlighter
    // that drops a character renders text nobody typed.
    expect(pane.textContent).toContain('"folder": "INBOX"')
    expect(pane.textContent).toContain('"count": 24')
  })

  it('lists a loop Step once per pass, which a flat status list could not express', async () => {
    mount(
      <>
        <Opening />
        <RunStep selected={{ board: null, steps: ['s5'] }} />
      </>,
    )
    await openNewest()

    await waitFor(() => expect(screen.getByText('Classify')).toBeDefined())
    expect(screen.getByText('2 passes')).toBeDefined()
    expect(screen.getByText('#0')).toBeDefined()
    expect(screen.getByText('timed out')).toBeDefined()
    // The head shows the worst of them, which is the same answer the card on the
    // map shows.
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0)
  })

  it('narrows the log to the Step being read, which is what logEntry.step is for', async () => {
    mount(
      <>
        <Opening />
        <RunStep selected={{ board: null, steps: ['s5'] }} />
      </>,
    )
    await openNewest()

    await waitFor(() => expect(screen.getByText('Upstream timed out')).toBeDefined())
    expect(screen.queryByText('Run started')).toBeNull()
  })

  it('refuses to describe a Segment of several rather than describing the first', async () => {
    mount(
      <>
        <Opening />
        <RunStep selected={{ board: null, steps: ['s1', 's4'] }} />
      </>,
    )
    await openNewest()

    await waitFor(() =>
      expect(screen.getByText('Pick a single step to see what it did.')).toBeDefined(),
    )
  })

  it('reports a record the Host would not serve, and leaves the list answering', async () => {
    mount(
      <>
        <Opening />
        <RunStep />
      </>,
      { executions: runs({ failLoad: new Error('That run has expired.') }) },
    )
    await openNewest()

    await waitFor(() => expect(screen.getAllByText('That run has expired.').length).toBe(2))
    // A Host that keeps summaries longer than it keeps bodies is ordinary, and
    // one failure must not empty a list that was answering.
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })
})
