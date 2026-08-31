import type { Manifest, ManifestEntry } from '@hatua/schema'
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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HatuaProvider } from '../theme/HatuaProvider'
import { Data } from './Data'

/**
 * The Data panel against a Host's ports.
 *
 * Nothing here is edited, so what these assert is what a Template may read from
 * a given position — which is `@hatua/model`'s answer, drawn. The panel adds
 * two things over the picker's Reference tab: which leaves the selected Step
 * already reads, and reporting the one being pointed at.
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

steps:
  - id: s1
    use: component.email.fetch
  - id: s2
    use: component.email.send
    with:
      to: "{{ var.digest_to }}"
      subject: "Nothing here reads a message"

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
`

const CATALOGUE: Manifest[] = [
  {
    kind: 'trigger',
    use: 'component.schedule.cron',
    name: 'On a schedule',
    fields: [],
    outputs: [{ k: 'at', label: 'When it ran', t: 'datetime' }],
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
    outputs: [],
  },
]

const token = 'tok_test' as EditToken
const lease: Lease = { token, expiresAt: '2099-01-01T00:00:00.000Z' }

const host = (yaml = SOURCE): WorkflowStore => ({
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

const serving = (manifests: ManifestEntry[]): ManifestSource => ({
  loadManifests: async () => manifests,
})

const mount = (
  props: Partial<Parameters<typeof Data>[0]> = {},
  manifests: ManifestEntry[] | null = CATALOGUE,
  store: WorkflowStore | null = host(),
) =>
  render(
    <HatuaProvider
      ports={{
        ...(store ? { workflows: store } : {}),
        ...(manifests ? { manifests: serving(manifests) } : {}),
      }}
      workflowId={store ? 'wf_morning' : undefined}
    >
      <Data {...props} />
    </HatuaProvider>,
  )

/** The rows on screen, by the mono path each one carries. */
const rows = () => screen.getAllByRole('button').map((row) => row.textContent ?? '')

describe('the ports it needs', () => {
  it('says so when the Host wired no storage, rather than showing an empty tree', () => {
    render(<Data />)
    expect(screen.getByText(/No workflow is wired up/)).toBeDefined()
  })

  /*
   * A Host that wired storage and no catalogue is a real case: every field on
   * HostPorts is optional. What a Step's outputs ARE comes from the catalogue,
   * so without one the tree still holds the variables the document declares.
   */
  it('shows what the document declares when no catalogue is wired', async () => {
    mount({}, null)
    await waitFor(() => expect(rows().some((row) => row.includes('var.digest_to'))).toBe(true))
  })
})

describe('what is in scope', () => {
  /*
   * A position in the tree is what says which Steps are guaranteed to have run,
   * so with nothing selected there is no Step output to offer — and saying so
   * is better than an empty column.
   */
  it('shows the Board’s scope with nothing selected, and says that is what it is', async () => {
    mount()
    expect(await screen.findByText(/Nothing is selected/)).toBeDefined()
    await waitFor(() => expect(rows().some((row) => row.includes('var.digest_to'))).toBe(true))
    expect(rows().some((row) => row.includes('triggers.t1'))).toBe(true)
    expect(rows().some((row) => row.includes('steps.s1'))).toBe(false)
  })

  it('shows an upstream Step’s outputs once a Step is selected', async () => {
    mount({ selected: { board: null, steps: ['s2'] } })
    await waitFor(() => expect(rows().some((row) => row.includes('steps.s1.messages'))).toBe(true))
    expect(screen.getByText('What s2 can read')).toBeDefined()
  })

  it('never offers a Step that has not run by the time this one does', async () => {
    mount({ selected: { board: null, steps: ['s1'] } })
    await waitFor(() => expect(rows().some((row) => row.includes('triggers.t1'))).toBe(true))
    expect(rows().some((row) => row.includes('steps.s2'))).toBe(false)
  })

  /*
   * A Block's Board has its own contract and its own variables, and the
   * workflow's are not among them: ids are Board-local and a Block called twice
   * starts clean both times.
   */
  it('shows the Board’s own scope inside a Block, not the workflow’s', async () => {
    mount({ selected: { board: 'archive', steps: ['b1'] } })
    await waitFor(() => expect(rows().some((row) => row.includes('params.thread'))).toBe(true))
    expect(rows().some((row) => row.includes('var.attempts'))).toBe(true)
    expect(rows().some((row) => row.includes('var.digest_to'))).toBe(false)
  })

  it('falls back to the Board it is told about when nothing is selected', async () => {
    mount({ board: 'archive' })
    await waitFor(() => expect(rows().some((row) => row.includes('var.attempts'))).toBe(true))
    expect(rows().some((row) => row.includes('var.digest_to'))).toBe(false)
  })

  /*
   * A Segment of several has no single scope — a later Step reads more than an
   * earlier one — so what every Step in it can read is the honest answer.
   */
  it('shows the Board’s scope for a Segment of several, and says why', async () => {
    mount({ selected: { board: null, steps: ['s1', 's2'] } })
    expect(await screen.findByText(/Several steps are selected/)).toBeDefined()
    await waitFor(() => expect(rows().some((row) => row.includes('var.digest_to'))).toBe(true))
    expect(rows().some((row) => row.includes('steps.s1.messages'))).toBe(false)
  })

  it('says a document that does not project has nothing to resolve against', async () => {
    mount({}, CATALOGUE, host('name: half written\nsteps:\n  - use: a\n'))
    expect(await screen.findByText(/not a valid Workflow Definition yet/)).toBeDefined()
  })
})

describe('the marks it draws and the events it sends', () => {
  it('marks the leaves the selected Step already reads', async () => {
    mount({ selected: { board: null, steps: ['s2'] } })

    const used = await screen.findByRole('button', { name: /var\.digest_to/ })
    expect(within(used).getByText('used')).toBeDefined()

    const unused = screen.getByRole('button', { name: /triggers\.t1\.at/ })
    expect(within(unused).queryByText('used')).toBeNull()
  })

  it('reports the leaf being pointed at, and that it has been left', async () => {
    const pointed: (string | null)[] = []
    mount({ selected: { board: null, steps: ['s2'] }, onHighlight: (p) => pointed.push(p) })

    const row = await screen.findByRole('button', { name: /var\.digest_to/ })
    fireEvent.mouseEnter(row)
    fireEvent.mouseLeave(row)
    expect(pointed).toEqual(['var.digest_to', null])
  })

  /*
   * Focus as well as hover: drag is the gesture this panel is built around and
   * it has no keyboard equivalent, so the highlight has to be reachable without
   * a pointer.
   */
  it('reports it from the keyboard too', async () => {
    const pointed: (string | null)[] = []
    mount({ selected: { board: null, steps: ['s2'] }, onHighlight: (p) => pointed.push(p) })

    const row = await screen.findByRole('button', { name: /var\.digest_to/ })
    fireEvent.focus(row)
    expect(pointed).toEqual(['var.digest_to'])
  })

  it('carries both MIME types a drop target reads', async () => {
    mount({ selected: { board: null, steps: ['s2'] } })
    const row = await screen.findByRole('button', { name: /var\.digest_to/ })

    const written = new Map<string, string>()
    fireEvent.dragStart(row, {
      dataTransfer: { setData: (mime: string, data: string) => written.set(mime, data) },
    })

    // The bare path for a Hatua field, which decides its own delimiters; the
    // wrapped Template for any other editor on the page.
    expect(written.get('application/x-hatua-reference')).toBe('var.digest_to')
    expect(written.get('text/plain')).toBe('{{ var.digest_to }}')
  })

  it('copies the token on click, because drag has no keyboard equivalent', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

    mount({ selected: { board: null, steps: ['s2'] } })
    fireEvent.click(await screen.findByRole('button', { name: /var\.digest_to/ }))

    expect(writeText).toHaveBeenCalledWith('{{ var.digest_to }}')
    expect(await screen.findByText('Copied {{ var.digest_to }}')).toBeDefined()
    vi.unstubAllGlobals()
  })

  /*
   * An insecure origin, or a permission the user has refused. Silence would
   * read as a control that did nothing.
   */
  it('says so when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: () => Promise.reject(new Error('no')) },
    })

    mount({ selected: { board: null, steps: ['s2'] } })
    fireEvent.click(await screen.findByRole('button', { name: /var\.digest_to/ }))

    expect(await screen.findByText(/could not be copied/)).toBeDefined()
    vi.unstubAllGlobals()
  })
})
