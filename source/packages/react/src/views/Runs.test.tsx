import type { ManifestEntry } from '@hatua/schema'
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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HatuaProvider } from '../theme/HatuaProvider'
import { Hatua } from './Hatua'
import { Runs } from './Runs'

/**
 * The **Runs** view is where the two halves of opening a run meet: the record
 * comes from the execution store, and the version it references goes on screen
 * through the editing store as a **Preview** (ADR-0025).
 *
 * So what is asserted here is what neither region can assert alone — that the
 * map draws the version the run ran against and not the **Draft**, that nothing
 * on it is editable, and that the preview does not outlive the view that set it.
 */

/** The Draft. Nothing in this view should ever draw it. */
const DRAFT = `id: wf_morning
name: "Morning inbox triage"
version: 6
status: draft
steps:
  - id: s9
    use: component.email.send
    name: "A step added since"
`

/**
 * Version 4, which the run below references.
 *
 * `s7` uses a Component the catalogue no longer declares, which is the ordinary
 * fate of a three-week-old version: under **Build** that is a
 * `COMPONENT_UNKNOWN` on every render. Here it must not be.
 */
const VERSION_FOUR = `id: wf_morning
name: "Morning inbox triage"
version: 4
status: published
steps:
  - id: s1
    use: component.email.fetch
    name: "Fetch the mail"
  - id: s7
    use: component.retired.thing
    name: "Something retired"
  - id: s4
    use: core.for_each
    name: "Each message"
    steps:
      - id: s5
        use: component.email.send
        name: "Classify it"
`

const CATALOGUE: ManifestEntry[] = [
  {
    kind: 'component',
    use: 'component.email.fetch',
    name: 'Fetch mail',
    fields: [],
    outputs: [],
  },
  {
    kind: 'component',
    use: 'component.email.send',
    name: 'Send mail',
    fields: [],
    outputs: [],
  },
]

const token = 'tok_test' as EditToken
const lease: Lease = { token, expiresAt: '2099-01-01T00:00:00.000Z' }

const workflows = (): WorkflowStore => ({
  async openDraft(): Promise<DraftSession> {
    return { token, lease, yaml: DRAFT, resumed: false }
  },
  async saveDraft() {},
  async renewLease(): Promise<Lease> {
    return lease
  },
  async publish(): Promise<PublishedVersion> {
    return { version: 7, publishedAt: '2026-01-01T00:00:00.000Z' }
  },
  async releaseDraft() {},
  async discardDraft() {},
  async listVersions(): Promise<Cursor<VersionSummary>> {
    return { items: [] }
  },
  async loadVersion() {
    return VERSION_FOUR
  },
})

const SUMMARY: ExecutionSummary = {
  runId: 'run_8f2',
  status: 'succeeded',
  startedAt: '2026-08-18T07:00:00.000Z',
  durationMs: 1470,
}

const executions = (): ExecutionSource => ({
  async listExecutions(): Promise<Cursor<ExecutionSummary>> {
    return { items: [SUMMARY] }
  },
  async loadExecution() {
    return {
      run_id: 'run_8f2',
      status: 'succeeded',
      workflow: { id: 'wf_morning', version: 4 },
      started_at: '2026-08-18T07:00:00.000Z',
      duration_ms: 1470,
      steps: [
        { id: 's1', status: 'succeeded', duration_ms: 120 },
        {
          id: 's4',
          status: 'succeeded',
          iterations: [
            { index: 0, status: 'succeeded', steps: [{ id: 's5', status: 'succeeded' }] },
            { index: 1, status: 'failed', steps: [{ id: 's5', status: 'failed' }] },
          ],
        },
      ],
    } as Awaited<ReturnType<ExecutionSource['loadExecution']>>
  },
})

const catalogue = (manifests: ManifestEntry[]): ManifestSource => ({
  loadManifests: async () => manifests,
})

const mount = () =>
  render(
    <HatuaProvider
      ports={{
        workflows: workflows(),
        manifests: catalogue(CATALOGUE),
        executions: executions(),
      }}
      workflowId="wf_morning"
    >
      <Runs />
    </HatuaProvider>,
  )

const openRun = async () => {
  const row = await screen.findByRole('button', { name: /2026-08-18/ })
  fireEvent.click(row)
}

describe('the Runs view', () => {
  it('draws no map until a run is picked, because there is no version to draw against', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('Pick a run to see it on the map.')).toBeDefined())

    // The Draft is open — the toolbar claims it — and it is deliberately not
    // what this column shows: it is not an answer to "which run am I looking
    // at".
    expect(screen.queryByRole('region', { name: 'Flow map' })).toBeNull()
  })

  it('draws the version the run references, and not the Draft', async () => {
    mount()
    await openRun()

    await waitFor(() => expect(screen.getByRole('region', { name: 'Flow map' })).toBeDefined())
    // Version 4's Step, not version 6's. An execution references its definition
    // by version precisely so a three-week-old run is not painted against
    // today's.
    expect(await screen.findByText('Fetch the mail')).toBeDefined()
    expect(screen.queryByText('A step added since')).toBeNull()
  })

  it('offers nothing to edit with, because the map is showing a Preview', async () => {
    mount()
    await openRun()
    await waitFor(() => expect(screen.getByRole('region', { name: 'Flow map' })).toBeDefined())

    // `useReadOnly()` is already true, so the canvas draws no insert points and
    // no selection actions — none of which this view had to ask for.
    expect(screen.queryByRole('button', { name: /^Add a step/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Make a block' })).toBeNull()
  })

  it('says the version and the run in the bar, and offers no version decisions', async () => {
    mount()
    await openRun()

    await waitFor(() =>
      expect(screen.getByText('You are viewing a past run of this version.')).toBeDefined(),
    )
    // Publish, Release and Discard are all about the Draft; Restore is about a
    // version the reader did not choose. The way out is the segmented control.
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Restore this version' })).toBeNull()
  })

  it('gives the Draft back on the way out, so a run does not leak into the designer', async () => {
    // Through <Hatua>, because the thing under test is the switch: this view
    // owns the **Preview** for as long as it is mounted, and what proves it is
    // what the designer draws afterwards.
    render(
      <Hatua
        ports={{
          workflows: workflows(),
          manifests: catalogue(CATALOGUE),
          executions: executions(),
        }}
        workflowId="wf_morning"
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Runs' }))
    await openRun()
    await waitFor(() => expect(screen.getAllByText('Fetch the mail').length).toBeGreaterThan(0))

    fireEvent.click(screen.getAllByRole('button', { name: 'Build' })[0] as HTMLElement)

    // Back on the Draft, with the run's version gone. A run's version left
    // standing under **Build** would be drawn with no marks on it and captioned
    // as a preview of a version nobody picked.
    await waitFor(() => expect(screen.getAllByText('A step added since').length).toBeGreaterThan(0))
    expect(screen.queryByText('You are viewing a past run of this version.')).toBeNull()
  })
})

describe('what the map says about the run', () => {
  it('marks each card with what its Step did, and how many times it did it', async () => {
    mount()
    await openRun()
    await waitFor(() => expect(screen.getByRole('region', { name: 'Flow map' })).toBeDefined())

    // The card is one shape and cannot say twenty-four things, so it says the
    // worst of them and the count. `RunStep` is where each pass is.
    // `s1` and `s4` both ran; `s5` ran twice and failed once.
    expect((await screen.findAllByText('Ran')).length).toBe(2)
    expect(screen.getByText('Failed ×2')).toBeDefined()
  })

  it('leaves a Step the run never reached unmarked', async () => {
    mount()
    await openRun()
    await waitFor(() => expect(screen.getByRole('region', { name: 'Flow map' })).toBeDefined())

    // `s7` has no record. An unmarked card is what says the Step did not run —
    // marking every card would claim one did.
    const card = (await screen.findByText('Something retired')).closest('li')
    expect(card?.textContent).not.toContain('Ran')
    expect(card?.textContent).not.toContain('Waiting')
  })

  it('reports no diagnostics, because history is not fixable', async () => {
    mount()
    await openRun()
    await waitFor(() => expect(screen.getByRole('region', { name: 'Flow map' })).toBeDefined())

    /*
     * `s7`'s Component is not in the catalogue, which under **Build** is a
     * `COMPONENT_UNKNOWN` on its card. Reported here it would be a second mark
     * beside the status in the opposite tense, about a version that cannot
     * change and a catalogue that moved after the run — so the checker narrows
     * to nothing instead (ADR-0025).
     */
    expect(screen.queryByRole('status')).toBeNull()
    const card = (await screen.findByText('Something retired')).closest('li')
    expect(card?.getAttribute('title')).toBeNull()
  })
})

describe('what the bar offers while a run is up', () => {
  it('says which version, and does not offer to go to another', async () => {
    mount()
    await openRun()
    await waitFor(() =>
      expect(screen.getByText('You are viewing a past run of this version.')).toBeDefined(),
    )

    /*
     * The readout stays and the list goes. Picking a row would replace the run's
     * version with a chosen one while the map still carried the run's marks and
     * the pane still described the run — one screen saying two things about what
     * it is showing.
     */
    expect(screen.getByText('v4 · Published')).toBeDefined()
    expect(screen.queryByRole('button', { name: /v4 · Published/ })).toBeNull()
  })
})
