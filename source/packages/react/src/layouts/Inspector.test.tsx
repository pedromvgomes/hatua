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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HatuaProvider } from '../theme/HatuaProvider'
import { Inspector } from './Inspector'

/**
 * The step editor against a Host's ports.
 *
 * It takes no document prop and never will: Hatua has no storage and no idea
 * where a workflow lives, so the ports go into <HatuaProvider> and the region
 * subscribes to what comes out. What it does take is the selection, because a
 * Segment is chrome held by whatever composes the regions (ADR-0020).
 */

const SOURCE = `# Runs before anyone is awake.
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
      # which folder
      folder: "INBOX"
  - id: s2
    use: component.email.send
    with:
      to: "{{ var.digest_to }}"
      subject: 'Nightly'
  - id: s3
    use: core.for_each
    with:
      list: "{{ steps.s1.messages }}"
    steps:
      - id: s4
        use: component.email.send
`

const CATALOGUE: Manifest[] = [
  {
    kind: 'trigger',
    use: 'component.schedule.cron',
    name: 'On a schedule',
    fields: [{ k: 'at', label: 'Runs at', kind: 'mono' }],
    outputs: [],
  },
  {
    kind: 'component',
    use: 'component.email.fetch',
    name: 'Fetch mail',
    fields: [
      { k: 'folder', label: 'Folder', kind: 'text' },
      { k: 'mailbox', label: 'Mailbox', kind: 'conn', conn_type: 'email' },
    ],
    outputs: [{ k: 'messages', label: 'Messages', t: 'list' }],
  },
  {
    kind: 'component',
    use: 'component.email.send',
    name: 'Send mail',
    fields: [
      { k: 'to', label: 'To', kind: 'text' },
      { k: 'subject', label: 'Subject', kind: 'text' },
      { k: 'retries', label: 'Retries', kind: 'number' },
    ],
    outputs: [],
  },
  {
    kind: 'component',
    use: 'core.for_each',
    name: 'For each',
    fields: [{ k: 'list', label: 'List', kind: 'ref' }],
    outputs: [],
  },
]

const token = 'tok_test' as EditToken
const lease: Lease = { token, expiresAt: '2099-01-01T00:00:00.000Z' }

interface Host {
  port: WorkflowStore
  writes: string[]
}

function host(yaml = SOURCE): Host {
  const writes: string[] = []
  return {
    writes,
    port: {
      async openDraft(): Promise<DraftSession> {
        return { token, lease, yaml, resumed: false }
      },
      async saveDraft(_token, text) {
        writes.push(text)
      },
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
    },
  }
}

const serving = (manifests: Manifest[]): ManifestSource => ({
  loadManifests: async () => manifests,
})

const AVAILABLE = [{ ref: 'ref_support', type: 'email', label: 'Support inbox' }]

const connectionPorts = (): {
  connections: ConnectionSource
  describeConnection: ConnectionDescriber
} => ({
  connections: {
    async listConnections() {
      return { items: AVAILABLE.map(({ ref, type }) => ({ ref, type })) }
    },
  },
  describeConnection: {
    async describe(ref) {
      const found = AVAILABLE.find((connection) => connection.ref === ref)
      if (!found) throw new Error(`no such connection "${ref}"`)
      return { type: found.type, label: found.label, status: 'ready', details: {} }
    },
  },
})

const mount = (
  source?: Host,
  props: Partial<Parameters<typeof Inspector>[0]> = {},
  manifests: Manifest[] | null = CATALOGUE,
  connections = false,
) =>
  render(
    <HatuaProvider
      ports={{
        ...(source ? { workflows: source.port } : {}),
        ...(manifests ? { manifests: serving(manifests) } : {}),
        ...(connections ? connectionPorts() : {}),
      }}
      workflowId={source ? 'wf_morning' : undefined}
    >
      <Inspector {...props} />
    </HatuaProvider>,
  )

const on = (...steps: string[]) => ({ selected: { board: null, steps } })

/** Long enough for the autosave debounce plus contention on a busy machine. */
const AUTOSAVED = { timeout: 5000 }

/** Commit the way the user does: type, then leave the field. */
const type = (field: HTMLElement, value: string) => {
  fireEvent.change(field, { target: { value } })
  fireEvent.blur(field)
}

describe('what it shows before there is a Step to edit', () => {
  it('says so when the Host wired no storage, rather than showing an empty form', () => {
    render(<Inspector />)
    expect(screen.getByText(/No workflow is wired up/)).toBeDefined()
  })

  it('asks for a selection when nothing is selected', async () => {
    mount(host())
    expect(await screen.findByText('Select a step to fill it in.')).toBeDefined()
  })

  /*
   * A Segment of several is a legitimate selection — extraction consumes one —
   * and there is nothing to edit for it: the fields belong to one Step, and a
   * form over several would have to invent what a shared value means.
   */
  it('refuses to draw a form over a Segment of several, and says why', async () => {
    mount(host(), on('s1', 's2'))
    expect(await screen.findByText(/2 steps are selected/)).toBeDefined()
    expect(screen.queryByLabelText('Folder')).toBeNull()
  })

  it('says a selected Step is not there, rather than showing an empty form', async () => {
    mount(host(), on('gone'))
    expect(await screen.findByText('That step is not in this workflow.')).toBeDefined()
  })

  /*
   * Parsed, held, and not a Workflow Definition — the state ADR-0001 forces on
   * every region. The document is still open and still editable, and Text Mode
   * is where it gets fixed.
   */
  it('says a document that does not project has nothing to edit, and keeps the text', async () => {
    mount(host('name: half written\nsteps:\n  - use: a\n'), on('s1'))
    expect(await screen.findByText(/not a valid Workflow Definition yet/)).toBeDefined()
    expect(screen.getByText(/nothing has been discarded/)).toBeDefined()
  })
})

describe('the form it draws', () => {
  it('draws the selected Step’s fields, its verb and its id', async () => {
    mount(host(), on('s1'))
    expect(await screen.findByDisplayValue('INBOX')).toBeDefined()
    expect(screen.getByText('component.email.fetch · s1')).toBeDefined()
    expect(screen.getByDisplayValue('Fetch the mail')).toBeDefined()
  })

  /*
   * The checker already says it, so this region does not say it twice. What it
   * must not do is draw a name box and nothing else with no account of why —
   * one sentence about the verb, from whichever of the two can give one.
   */
  it('draws no form for a verb nothing declares, and lets the checker say why', async () => {
    mount(host(), on('s1'), [CATALOGUE[2] as Manifest])
    expect(await screen.findByText(/Nothing declares "component.email.fetch"/)).toBeDefined()
    expect(screen.queryByLabelText('Folder')).toBeNull()
    expect(screen.queryByText(/Nothing declares this step type/)).toBeNull()
  })

  /*
   * A Host that wired storage and no catalogue is a real case: every field on
   * HostPorts is optional. The Step is still resolved and still named — what is
   * missing is what its fields ARE, and that is the only thing that says so.
   */
  it('names the Step with no catalogue wired, and says why it has no fields', async () => {
    // Without a catalogue there is no checker either, so the sentence this
    // region keeps for itself is the only account of an empty form.
    mount(host(), on('s1'), null)
    expect(await screen.findByDisplayValue('Fetch the mail')).toBeDefined()
    expect(screen.queryByLabelText('Folder')).toBeNull()
    expect(screen.getByText(/Nothing declares this step type/)).toBeDefined()
  })

  it('offers what the Step can read, and never what it cannot', async () => {
    mount(host(), on('s2'))
    // s1 runs before s2, so its outputs are readable; s2's own are not, and
    // neither is anything inside the loop that follows.
    await screen.findByDisplayValue('Nightly')
    const field = screen.getByLabelText('To')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '{{ steps.' } })
    const offered = await screen.findAllByRole('option')
    const labels = offered.map((option) => option.textContent)
    expect(labels.some((label) => label?.includes('steps.s1'))).toBe(true)
    expect(labels.some((label) => label?.includes('steps.s4'))).toBe(false)
  })
})

describe('the edits it writes', () => {
  it('writes a field into the Step’s `with:`, keeping comments, key order and quoting', async () => {
    const source = host()
    mount(source, on('s2'))

    type(await screen.findByLabelText('Subject'), 'Morning')

    await waitFor(() => expect(source.writes.length).toBeGreaterThan(0), AUTOSAVED)
    const written = source.writes.at(-1) as string
    expect(written).toContain("subject: 'Morning'")
    expect(written).toContain('# Runs before anyone is awake.')
    expect(written).toContain('# which folder')
    expect(written).toContain('name: "Morning inbox triage"')
    expect(written.indexOf('to:')).toBeLessThan(written.indexOf('subject:'))
  })

  /*
   * A Step added from the catalogue carries no `with:` at all, so the first
   * field edited on it is the one that creates the key.
   */
  it('creates `with:` on a Step that has none', async () => {
    const source = host()
    mount(source, { selected: { board: null, steps: ['s4'] } })

    type(await screen.findByLabelText('To'), 'ops@example.com')

    await waitFor(() => expect(source.writes.length).toBeGreaterThan(0), AUTOSAVED)
    expect(source.writes.at(-1)).toContain('to: ops@example.com')
  })

  it('renames the Step, and leaves its id alone because a Reference points at it', async () => {
    const source = host()
    mount(source, on('s1'))

    type(await screen.findByDisplayValue('Fetch the mail'), 'Collect the mail')

    await waitFor(() => expect(source.writes.length).toBeGreaterThan(0), AUTOSAVED)
    const written = source.writes.at(-1) as string
    expect(written).toContain('name: "Collect the mail"')
    expect(written).toContain('id: s1')
  })

  /*
   * Binding the Host's handle and pointing the field at it are two edits and
   * one thing the user did. Left as two, an undo puts the field back and leaves
   * a Connection nobody declared behind.
   */
  it('declares a Connection and points the field at it as one change', async () => {
    const source = host()
    mount(source, on('s1'), CATALOGUE, true)

    const picker = await screen.findByLabelText('Mailbox')
    await waitFor(() => expect(picker.querySelectorAll('option').length).toBeGreaterThan(1))
    fireEvent.change(picker, { target: { value: '+ref_support' } })

    await waitFor(() => expect(source.writes.length).toBeGreaterThan(0), AUTOSAVED)
    const written = source.writes.at(-1) as string
    expect(written).toContain('ref: ref_support')
    expect(written).toContain('mailbox: support_inbox')
  })
})

describe('the relationship with the Data panel beside it', () => {
  it('marks every field reading the path being pointed at, and nothing else', async () => {
    const { rerender } = render(
      <HatuaProvider
        ports={{ workflows: host().port, manifests: serving(CATALOGUE) }}
        workflowId="wf_morning"
      >
        <Inspector selected={{ board: null, steps: ['s2'] }} highlight="var.digest_to" />
      </HatuaProvider>,
    )

    const to = await screen.findByLabelText('To')
    const marked = (field: HTMLElement) => field.closest('[data-highlighted]') !== null
    expect(marked(to)).toBe(true)
    expect(marked(screen.getByLabelText('Subject'))).toBe(false)

    rerender(
      <HatuaProvider
        ports={{ workflows: host().port, manifests: serving(CATALOGUE) }}
        workflowId="wf_morning"
      >
        <Inspector selected={{ board: null, steps: ['s2'] }} highlight={null} />
      </HatuaProvider>,
    )
    await waitFor(() => expect(marked(screen.getByLabelText('To'))).toBe(false))
  })

  it('offers the panel only when somebody is listening for it', async () => {
    const { unmount } = mount(host(), on('s1'))
    expect(await screen.findByDisplayValue('INBOX')).toBeDefined()
    expect(screen.queryByRole('button', { name: /data/i })).toBeNull()
    unmount()

    mount(host(), { ...on('s1'), onExpandedChange: () => {} })
    expect(await screen.findByRole('button', { name: 'Show data' })).toBeDefined()
  })
})
