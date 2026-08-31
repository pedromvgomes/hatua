import type { BoardId } from '@hatua/model'
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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HatuaProvider } from '../theme/HatuaProvider'
import { boardTabLabel, Workflow } from './Workflow'

/**
 * The Workflow tab against a Host's ports.
 *
 * Everything here mounts <Workflow /> with no document prop, because it takes
 * none: Hatua has no storage and no idea where a workflow lives, so the ports
 * go into <HatuaProvider> and the region subscribes to what comes out.
 *
 * It is the first region other than validation to read two stores, and either
 * may be absent — so a fair share of what follows is about a Host that wired
 * one and not the other.
 */

const SOURCE = `# Runs before anyone is awake.
id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft

triggers:
  - id: t1
    use: component.schedule.cron
    name: "Every morning"
    with:
      at: "0 6 * * 1-5"

vars:
  # Where the digest goes.
  - key: digest_to
    t: text
    value: "ops@example.com"
  - key: threshold
    t: number
    value: 10

steps:
  - id: s1
    use: component.email.fetch
`

const CATALOGUE: Manifest[] = [
  {
    kind: 'trigger',
    use: 'component.schedule.cron',
    name: 'On a schedule',
    fields: [
      { k: 'at', label: 'Runs at', kind: 'mono', req: true, hint: 'A cron expression.' },
      {
        k: 'catch_up',
        label: 'Catch up on missed runs',
        kind: 'bool',
      },
      {
        k: 'zone',
        label: 'Time zone',
        kind: 'enum',
        options: [
          { value: 'utc', label: 'UTC' },
          { value: 'local', label: 'The workflow owner’s' },
        ],
      },
    ],
    outputs: [],
  },
  {
    kind: 'trigger',
    use: 'component.email.received',
    name: 'When mail arrives',
    fields: [
      { k: 'folder', label: 'Folder', kind: 'text' },
      { k: 'connection', label: 'Mailbox', kind: 'conn', conn_type: 'email', req: true },
      { k: 'notes', label: 'Notes', kind: 'textarea' },
      { k: 'retries', label: 'Retries', kind: 'number' },
    ],
    outputs: [],
  },
  { kind: 'component', use: 'component.email.fetch', name: 'Fetch mail', fields: [], outputs: [] },
]

const token = 'tok_test' as EditToken
const lease: Lease = { token, expiresAt: '2099-01-01T00:00:00.000Z' }

interface Host {
  port: WorkflowStore
  writes: string[]
}

function host(yaml = SOURCE, overrides: Partial<WorkflowStore> = {}): Host {
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
    ...overrides,
  }
}

const serving = (manifests: Manifest[]): ManifestSource => ({
  loadManifests: async () => manifests,
})

/** The Host's established Connections: `{ref, type}` from one port, a label from the other. */
const connectionPorts = (
  available: { ref: string; type: string; label: string }[],
): { connections: ConnectionSource; describeConnection: ConnectionDescriber } => ({
  connections: {
    async listConnections() {
      return { items: available.map(({ ref, type }) => ({ ref, type })) }
    },
  },
  describeConnection: {
    async describe(ref) {
      const found = available.find((connection) => connection.ref === ref)
      if (!found) throw new Error(`no such connection "${ref}"`)
      return { type: found.type, label: found.label, status: 'ready', details: {} }
    },
  },
})

const mount = (
  source?: Host,
  manifests: Manifest[] | null = CATALOGUE,
  available?: { ref: string; type: string; label: string }[],
) =>
  render(
    <HatuaProvider
      ports={{
        ...(source ? { workflows: source.port } : {}),
        ...(manifests ? { manifests: serving(manifests) } : {}),
        ...(available ? connectionPorts(available) : {}),
      }}
      workflowId={source ? 'wf_morning' : undefined}
    >
      <Workflow />
    </HatuaProvider>,
  )

const AVAILABLE = [
  { ref: 'ref_ops', type: 'email', label: 'Ops mailbox' },
  { ref: 'ref_haiku', type: 'llm', label: 'Claude Code · Haiku 4.5' },
]

/** A workflow whose Trigger has a `conn` field to fill in. */
const WITH_MAILBOX = SOURCE.replace(
  '  - id: t1\n    use: component.schedule.cron\n    name: "Every morning"\n    with:\n      at: "0 6 * * 1-5"\n',
  '  - id: t1\n    use: component.email.received\n    name: "Every morning"\n',
)

/**
 * Long enough for the autosave debounce plus contention.
 *
 * Autosave waits 800ms of quiet before it writes, and `waitFor` defaults to a
 * 1000ms timeout — 200ms of headroom, which a machine running the whole
 * monorepo's suites in parallel does not reliably have.
 */
const AUTOSAVED = { timeout: 5000 }

/** Commit the way the user does: type, then leave the field. */
const type = (field: HTMLElement, value: string) => {
  fireEvent.change(field, { target: { value } })
  fireEvent.blur(field)
}

describe('the ports it needs', () => {
  it('says so when the Host wired no storage, rather than showing an empty workflow', () => {
    // "The Host wired nothing" and "the workflow has nothing in it" are
    // different problems with different fixes, so they are different states.
    render(<Workflow />)
    expect(screen.getByText(/No workflow is wired up/)).toBeDefined()
  })

  it('opens the Draft and draws all three sections', async () => {
    mount(host())
    expect(await screen.findByRole('region', { name: 'Identity' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Triggers' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Variables' })).toBeDefined()
  })

  it('edits a workflow with no catalogue wired, and says why nothing can be added', async () => {
    // A Host supplying a WorkflowStore and no ManifestSource is a real case:
    // every field on HostPorts is optional. The document still says which
    // Triggers exist, so they are still listed and still editable — only the
    // type picker needs the catalogue, and only the type picker says so.
    mount(host(), null)

    expect(await screen.findByDisplayValue('Every morning')).toBeDefined()
    expect(screen.getByText(/No Component Manifests are wired up/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Add trigger' })).toBeNull()
    // The variables have nothing to do with the catalogue and are untouched.
    expect(screen.getByDisplayValue('digest_to')).toBeDefined()
  })

  it('tells a catalogue with no Triggers in it apart from no catalogue at all', async () => {
    mount(host(), [CATALOGUE[2] as Manifest])

    expect(await screen.findByText('No Trigger types are available yet.')).toBeDefined()
    expect(screen.queryByText(/ManifestSource|ports=/)).toBeNull()
  })

  it('reports a failure to open and offers a retry', async () => {
    const failing = host()
    failing.port.openDraft = async () => {
      throw new Error('Another session holds the draft.')
    }
    mount(failing)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Another session holds the draft.')
  })

  it('says the document is not a Workflow Definition yet, and keeps it open', async () => {
    // The state ADR-0001 forces on this region: `toJSON()` throws, so there are
    // no fields to draw — and the text is intact and fixed in Text Mode.
    mount(host('name: half written\nsteps:\n  - use: a\n'))
    expect(await screen.findByText(/not a valid Workflow Definition yet/)).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Identity' })).toBeNull()
  })
})

describe('what it says while the catalogue is still arriving', () => {
  it('says the Trigger types are loading rather than that there are none', async () => {
    // "Not here yet" and "there are none" are different answers, and only one
    // of them is worth acting on.
    render(
      <HatuaProvider
        ports={{
          workflows: host().port,
          manifests: { loadManifests: () => new Promise<Manifest[]>(() => {}) },
        }}
        workflowId="wf_morning"
      >
        <Workflow />
      </HatuaProvider>,
    )

    expect(await screen.findByText('Loading Trigger types…')).toBeDefined()
    expect(screen.queryByText('No Trigger types are available yet.')).toBeNull()
  })

  it('reports a catalogue that failed to load, where the type picker would be', async () => {
    render(
      <HatuaProvider
        ports={{
          workflows: host().port,
          manifests: {
            loadManifests: async () => {
              throw new Error('The catalogue endpoint returned 503.')
            },
          },
        }}
        workflowId="wf_morning"
      >
        <Workflow />
      </HatuaProvider>,
    )

    expect(await screen.findByText(/The catalogue endpoint returned 503/)).toBeDefined()
  })

  it('announces that saving stopped, and keeps every edit on screen', async () => {
    // ADR-0005: a rejected write halts autosave and keeps the in-memory
    // document — not retried, not discarded.
    const refusing = host()
    refusing.port.saveDraft = async () => {
      throw new Error('Your lease expired.')
    }
    mount(refusing)

    type(await screen.findByLabelText('Name'), 'Overnight triage')

    await waitFor(
      () =>
        expect(screen.getByRole('status').textContent).toBe(
          'Saving stopped. Your changes are still here.',
        ),
      AUTOSAVED,
    )
    // The edit is still there, which is the half that matters.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Overnight triage')
  })

  it('renders a variable whose value the user has not written yet', async () => {
    // `value:` with nothing after it parses as null. The schema wants the key
    // present and says nothing about it being filled, so this is a document
    // somebody is halfway through — and an empty box is the honest rendering.
    mount(host(SOURCE.replace('    value: 10', '    value:')))

    const box = await screen.findByLabelText('Value of threshold')
    expect((box as HTMLInputElement).value).toBe('')
  })
})

describe('identity', () => {
  it('renames the workflow through the store, and autosaves it', async () => {
    const source = host()
    mount(source)

    type(await screen.findByLabelText('Name'), 'Overnight triage')

    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
    expect(source.writes[0]).toContain('name: "Overnight triage"')
    // Nothing was clicked to save it. ADR-0005: editing autosaves.
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })

  it('edits the slug, which is the workflow’s id', async () => {
    const source = host()
    mount(source)

    type(await screen.findByLabelText('Slug'), 'overnight-triage')
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
    expect(source.writes[0]).toContain('id: overnight-triage')
  })

  it('commits on leaving the field, not on every keystroke', async () => {
    // A command per keystroke is a write per keystroke and a re-parse per
    // keystroke, which puts the caret at the end of the box on every letter.
    const source = host()
    mount(source)

    const name = await screen.findByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Over' } })
    fireEvent.change(name, { target: { value: 'Overnight' } })
    expect(source.writes).toHaveLength(0)

    fireEvent.blur(name)
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
    expect(source.writes[0]).toContain('name: "Overnight"')
  })

  it('holds no version control, because the top bar shows the version', async () => {
    // ADR-0011: a property of the whole document, shown behind a tab, is
    // visible only while that tab is open. This tab edits; the top bar shows.
    mount(host())
    await screen.findByLabelText('Name')
    expect(screen.queryByText(/v4|draft/i)).toBeNull()
  })
})

describe('triggers', () => {
  it('lists what the document declares, with the id a Template addresses', async () => {
    mount(host())
    expect(await screen.findByDisplayValue('Every morning')).toBeDefined()
    expect(screen.getByText('component.schedule.cron · t1')).toBeDefined()
  })

  it('renders each declared field from the manifest, by kind', async () => {
    mount(host())

    expect((await screen.findByLabelText('Runs at')).getAttribute('value')).toBe('0 6 * * 1-5')
    expect(screen.getByRole('switch', { name: 'Catch up on missed runs' })).toBeDefined()
    expect(screen.getByRole('combobox', { name: 'Time zone' })).toBeDefined()
    expect(screen.getByText('A cron expression.')).toBeDefined()
  })

  it('writes a field value into `with:` under the manifest’s key', async () => {
    const source = host()
    mount(source)

    type(await screen.findByLabelText('Runs at'), '0 7 * * *')
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
    expect(source.writes[0]).toContain('at: "0 7 * * *"')
  })

  it('renames a Trigger without disturbing the id or the comments', async () => {
    const source = host()
    mount(source)

    type(await screen.findByDisplayValue('Every morning'), 'Weekday mornings')
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)

    expect(source.writes[0]).toContain('Weekday mornings')
    expect(source.writes[0]).toContain('id: t1')
    // The round-trip promise, on a key outside `steps:`.
    expect(source.writes[0]).toContain('# Runs before anyone is awake.')
    expect(source.writes[0]).toContain('# Where the digest goes.')
  })

  it('adds one of the type chosen, filtered to Triggers', async () => {
    const source = host()
    mount(source)

    const picker = await screen.findByRole('combobox', { name: 'Trigger type' })
    expect([...picker.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'On a schedule',
      'When mail arrives',
    ])

    fireEvent.change(picker, { target: { value: 'component.email.received' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add trigger' }))

    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
    expect(source.writes[0]).toContain('use: component.email.received')
    expect(source.writes[0]).toContain('id: t2')
  })

  it('removes one, and every Reference to it goes stale rather than being repaired', async () => {
    const source = host()
    mount(source)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Every morning' }))
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
    expect(source.writes[0]).not.toContain('id: t1')
  })

  it('says so when nothing starts the workflow', async () => {
    mount(host('id: wf\nname: n\nversion: 1\nstatus: draft\nsteps: []\n'))
    expect(await screen.findByText('Nothing starts this workflow yet.')).toBeDefined()
  })

  it('renders a Trigger whose type nothing declares, rather than dropping it', async () => {
    // A hand-edited verb, or a Host that stopped serving one. Hiding the row
    // would leave the user unable to remove the thing that is breaking Publish.
    mount(host(), [CATALOGUE[1] as Manifest])

    expect(await screen.findByDisplayValue('Every morning')).toBeDefined()
    // The checker's words, not a second sentence of this region's. Both ports
    // are wired here, so `unknownComponents` reports it and the card renders
    // what it said.
    expect(await screen.findByText(/Nothing declares "component.schedule.cron"/)).toBeDefined()
    expect(screen.queryByText(/Nothing declares this trigger type/)).toBeNull()
  })

  it('accounts for an undeclared type even when there is no checker', async () => {
    // With no catalogue wired there is no validation store at all, so the
    // region says it itself — otherwise the card is a name box with no account
    // of why it has nothing else on it.
    mount(host(), null)

    expect(await screen.findByDisplayValue('Every morning')).toBeDefined()
    expect(screen.getByText(/Nothing declares this trigger type/)).toBeDefined()
  })
})

describe('a Trigger’s connection field', () => {
  /*
   * A `conn` field stores the workflow-local NAME, and `connections[]` holds
   * the Host's opaque handle once. Hatua never establishes a Connection — it
   * has no server, so it can hold no client secret and receive no redirect
   * (ADR-0007) — so the picker offers what the Host says exists and nothing
   * more.
   */
  it('offers the Host’s connections, labelled the way the Host describes them', async () => {
    mount(host(WITH_MAILBOX), CATALOGUE, AVAILABLE)

    const picker = await screen.findByRole('combobox', { name: 'Mailbox' })
    expect([...picker.querySelectorAll('option')].map((o) => o.textContent)).toContain(
      'Ops mailbox',
    )
  })

  it('offers only connections whose type matches conn_type', async () => {
    // So a "when mail arrives" Trigger is never handed an LLM connection —
    // which `mismatchedConnections` would then block editing over.
    mount(host(WITH_MAILBOX), CATALOGUE, AVAILABLE)

    const picker = await screen.findByRole('combobox', { name: 'Mailbox' })
    const options = [...picker.querySelectorAll('option')].map((o) => o.textContent)
    expect(options).toContain('Ops mailbox')
    expect(options).not.toContain('Claude Code · Haiku 4.5')
  })

  it('declares the connection and points the field at it, as one undoable change', async () => {
    const source = host(WITH_MAILBOX)
    mount(source, CATALOGUE, AVAILABLE)

    const picker = await screen.findByRole('combobox', { name: 'Mailbox' })
    fireEvent.change(picker, { target: { value: '+ref_ops' } })

    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
    const written = source.writes[0] as string
    // The handle lands once, in `connections:`; the field points at the name.
    expect(written).toContain('ref: ref_ops')
    expect(written).toContain('id: ops_mailbox')
    expect(written).toContain('connection: ops_mailbox')
  })

  it('offers a connection the workflow already declares, without redeclaring it', async () => {
    const declared = WITH_MAILBOX.replace(
      'triggers:',
      'connections:\n  - id: ops_mailbox\n    ref: ref_ops\n\ntriggers:',
    )
    const source = host(declared)
    mount(source, CATALOGUE, AVAILABLE)

    const picker = await screen.findByRole('combobox', { name: 'Mailbox' })
    fireEvent.change(picker, { target: { value: 'ops_mailbox' } })

    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
    const written = source.writes[0] as string
    expect(written).toContain('connection: ops_mailbox')
    // Declared once, not twice: one handle with two names is a workflow with
    // connections nobody can tell apart.
    expect(written.match(/ref_ops/g)).toHaveLength(1)
  })

  it('says so when the Host wired no ConnectionSource, rather than offering nothing', async () => {
    mount(host(WITH_MAILBOX), CATALOGUE)

    expect(await screen.findByText(/No connection is available for this yet/)).toBeDefined()
    expect(screen.queryByRole('combobox', { name: 'Mailbox' })).toBeNull()
  })

  it('marks a required field, so an empty one is visibly unfinished', async () => {
    mount(host(WITH_MAILBOX), CATALOGUE, AVAILABLE)
    const label = await screen.findByText('Mailbox')
    expect(label.textContent).toContain('*')
  })
})

describe('a field the form shows and does not edit', () => {
  /*
   * `<label htmlFor>` may only point at a labelable element. Two rows do not
   * produce one — a `map` is shown and not edited, and a `conn` degrades to a
   * sentence while the Connections load or when the Host wired no port — and a
   * label pointing at a `<p>` is inert: clicking it does nothing, and a screen
   * reader reads the label and the sentence as two unrelated things.
   */
  it('labels the sentence a conn field degrades to', async () => {
    mount(host(WITH_MAILBOX), CATALOGUE)

    const note = await screen.findByText(/No connection is available for this yet/)
    const labelledBy = note.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy as string)?.textContent).toContain('Mailbox')
  })

  it('leaves no <label> pointing at nothing', async () => {
    const { container } = mount(host(WITH_MAILBOX), CATALOGUE)
    await screen.findByText(/No connection is available for this yet/)

    for (const label of container.querySelectorAll('label[for]')) {
      const target = label.getAttribute('for') as string
      expect(document.getElementById(target), `label for="${target}"`).not.toBeNull()
    }
  })

  it('shows a map field rather than rendering it as empty space', async () => {
    // A field drawn as nothing cannot be told from one this form does not know
    // about — and a required one left unset is reported by the checker with
    // nothing on screen to act on.
    const mapped: Manifest[] = [
      {
        kind: 'trigger',
        use: 'component.email.received',
        name: 'When mail arrives',
        fields: [{ k: 'headers', label: 'Headers', kind: 'map' }],
        outputs: [],
      },
    ]

    mount(host(WITH_MAILBOX), mapped)
    expect(await screen.findByText('Headers')).toBeDefined()
    expect(screen.getByText(/Nothing set/)).toBeDefined()
  })
})

describe('the shared field form', () => {
  /*
   * The same component the step editor mounts. A Trigger's fields and a Step's
   * are the same shape declared by the same schema, so which surface draws them
   * is a rendering decision — which is what lets the canvas's start node open
   * this form later without `triggers[]` moving into `steps[]`.
   */
  it('renders a textarea for a textarea field, not a single-line input', async () => {
    mount(host(WITH_MAILBOX), CATALOGUE, AVAILABLE)
    const notes = await screen.findByLabelText('Notes')
    expect(notes.tagName).toBe('TEXTAREA')
  })

  it('clears a number field rather than writing zero into it', async () => {
    // `Number('')` is 0, and `unfilled()` counts 0 as answered — so a required
    // numeric field would silently stop being reported while reading as
    // answered to the person who just cleared it.
    const source = host(
      WITH_MAILBOX.replace(
        'name: "Every morning"',
        'name: "Every morning"\n    with:\n      retries: 3',
      ),
    )
    mount(source, CATALOGUE, AVAILABLE)

    type(await screen.findByLabelText('Retries'), '')
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
    expect(source.writes[0]).not.toMatch(/retries: 0/)
  })

  it('hides a field its `when` clause switches off', async () => {
    // One rule, in @hatua/model: the same predicate decides whether a required
    // field counts as missing, so a second copy here would eventually let a
    // hidden field block Publish.
    const conditional: Manifest[] = [
      {
        kind: 'trigger',
        use: 'component.email.received',
        name: 'When mail arrives',
        fields: [
          {
            k: 'mode',
            label: 'Mode',
            kind: 'enum',
            options: [
              { value: 'all', label: 'Everything' },
              { value: 'folder', label: 'One folder' },
            ],
          },
          { k: 'folder', label: 'Folder', kind: 'text', when: ['mode', 'folder'] },
        ],
        outputs: [],
      },
    ]

    mount(host(WITH_MAILBOX), conditional)
    await screen.findByLabelText('Mode')
    expect(screen.queryByLabelText('Folder')).toBeNull()
  })
})

describe('an input that commits rather than fighting the user', () => {
  /*
   * Controlled straight from the document, every keystroke would be a command,
   * a write and a re-parse — so the caret would jump to the end on every
   * letter. Held locally and committed once, the document sees what the user
   * settled on. What it must still do is follow the document when the document
   * moves underneath it.
   */
  it('commits on Enter without waiting for the field to lose focus', async () => {
    const source = host()
    mount(source)

    const name = await screen.findByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Overnight triage' } })
    fireEvent.keyDown(name, { key: 'Enter' })

    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
    expect(source.writes[0]).toContain('Overnight triage')
  })

  it('abandons the edit on Escape, and writes nothing', async () => {
    const source = host()
    mount(source)

    const name = await screen.findByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Half a thought' } })
    fireEvent.keyDown(name, { key: 'Escape' })

    expect((name as HTMLInputElement).value).toBe('Morning inbox triage')
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(source.writes).toHaveLength(0)
  })

  it('follows the document when it changes from somewhere else', async () => {
    // Two regions over one store is the cheapest way to be something else. An
    // undo does the same thing, and so will the canvas.
    const source = host()
    render(
      <HatuaProvider
        ports={{ workflows: source.port, manifests: serving(CATALOGUE) }}
        workflowId="wf_morning"
      >
        <Workflow />
        <Workflow />
      </HatuaProvider>,
    )

    const [first, second] = await screen.findAllByLabelText('Name')
    type(first as HTMLElement, 'Overnight triage')

    await waitFor(() => expect((second as HTMLInputElement).value).toBe('Overnight triage'))
  })

  it('commits a textarea the same way, on blur', async () => {
    const source = host(WITH_MAILBOX)
    mount(source, CATALOGUE, AVAILABLE)

    type(await screen.findByLabelText('Notes'), 'Ask before archiving anything.')
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
    expect(source.writes[0]).toContain('Ask before archiving anything.')
  })

  it('follows the document in a textarea too', async () => {
    const source = host(WITH_MAILBOX)
    render(
      <HatuaProvider
        ports={{
          workflows: source.port,
          manifests: serving(CATALOGUE),
          ...connectionPorts(AVAILABLE),
        }}
        workflowId="wf_morning"
      >
        <Workflow />
        <Workflow />
      </HatuaProvider>,
    )

    const [first, second] = await screen.findAllByLabelText('Notes')
    type(first as HTMLElement, 'Written once, seen twice.')

    await waitFor(() =>
      expect((second as HTMLTextAreaElement).value).toBe('Written once, seen twice.'),
    )
  })
})

describe('naming a connection the workflow has not declared', () => {
  it('disambiguates two Connections the Host calls the same thing', async () => {
    // The name lands in a file in the Host's repository and has to be unique
    // there — two `ops_mailbox` entries would be a workflow with connections
    // nobody can tell apart.
    const twins = [
      { ref: 'ref_one', type: 'email', label: 'Ops mailbox' },
      { ref: 'ref_two', type: 'email', label: 'Ops Mailbox' },
    ]
    const source = host(WITH_MAILBOX)
    mount(source, CATALOGUE, twins)

    const picker = await screen.findByRole('combobox', { name: 'Mailbox' })
    fireEvent.change(picker, { target: { value: '+ref_one' } })
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)

    fireEvent.change(await screen.findByRole('combobox', { name: 'Mailbox' }), {
      target: { value: '+ref_two' },
    })
    await waitFor(() => expect(source.writes).toHaveLength(2), AUTOSAVED)

    const written = source.writes[1] as string
    expect(written).toContain('id: ops_mailbox')
    expect(written).toContain('id: ops_mailbox_2')
  })

  it('says so when the connections could not be loaded', async () => {
    render(
      <HatuaProvider
        ports={{
          workflows: host(WITH_MAILBOX).port,
          manifests: serving(CATALOGUE),
          connections: {
            async listConnections() {
              throw new Error('the connections endpoint returned 503')
            },
          },
        }}
        workflowId="wf_morning"
      >
        <Workflow />
      </HatuaProvider>,
    )

    expect(await screen.findByText(/the connections endpoint returned 503/)).toBeDefined()
  })
})

describe('variables', () => {
  it('lists key and value as separate fields', async () => {
    mount(host())
    expect(await screen.findByDisplayValue('digest_to')).toBeDefined()
    expect(screen.getByDisplayValue('ops@example.com')).toBeDefined()
    expect(screen.getByDisplayValue('10')).toBeDefined()
  })

  it('adds one, keeping every comment in the file', async () => {
    const source = host()
    mount(source)

    fireEvent.click(await screen.findByRole('button', { name: 'Add variable' }))
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)

    expect(source.writes[0]).toContain('new_variable')
    // ADR-0001's whole claim, on a key outside `steps:`.
    expect(source.writes[0]).toContain('# Where the digest goes.')
    expect(source.writes[0]).toContain('name: "Morning inbox triage"')
  })

  it('removes one, keeping every comment in the file', async () => {
    const source = host()
    mount(source)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove threshold' }))
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)

    expect(source.writes[0]).not.toContain('threshold')
    expect(source.writes[0]).toContain('# Where the digest goes.')
    expect(source.writes[0]).toContain('# Runs before anyone is awake.')
  })

  it('renames a key and rewrites every Reference that read it', async () => {
    /*
     * A named edit repairs what it invalidates (ADR-0021). The box commits on
     * blur, so the rename is one moment and one undo entry rather than a
     * rewrite of the user's file on every character — which is the fact the
     * never-rewrite rule was written against and which was never true here.
     */
    const source = host(`${SOURCE}    with:\n      to: "{{ var.digest_to }}"\n`)
    mount(source)

    type(await screen.findByDisplayValue('digest_to'), 'digest_recipient')
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)

    expect(source.writes[0]).toContain('key: digest_recipient')
    expect(source.writes[0]).toContain('{{ var.digest_recipient }}')
    expect(source.writes[0]).not.toContain('{{ var.digest_to }}')
    // The rewrite is surgical: the file around it comes back as it was written.
    expect(source.writes[0]).toContain('# Runs before anyone is awake.')
    expect(source.writes[0]).toContain('# Where the digest goes.')
  })

  it('stores a value as what the text denotes, so Text Mode and this box agree', async () => {
    // The type comes from `t`, but the value box still writes the scalar the
    // text denotes: typing `25` here has to mean what typing it in Text Mode
    // means (ADR-0001).
    const source = host()
    mount(source)

    type(await screen.findByLabelText('Value of threshold'), '25')
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
    expect(source.writes[0]).toContain('value: 25')
  })

  /*
   * The type control, which is the one edit on the row that re-types every
   * Expression reading the variable. The value box does not: `core.set_var`
   * writes the same variable from a Step, so the literal in the document is
   * only what it starts as (ADR-0013).
   */
  it('shows each variable’s declared type, and writes a change to it', async () => {
    const source = host()
    mount(source)

    const control = (await screen.findByLabelText('Type of threshold')) as HTMLSelectElement
    expect(control.value).toBe('number')

    fireEvent.change(control, { target: { value: 'text' } })
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
    expect(source.writes[0]).toContain('t: text')
    // The value beside it is untouched, because the two say different things.
    expect(source.writes[0]).toContain('value: 10')
  })

  it('gives a new variable a type, because the schema requires one', async () => {
    const source = host()
    mount(source)

    fireEvent.click(await screen.findByRole('button', { name: 'Add variable' }))
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
    expect(source.writes[0]).toContain('key: new_variable')
    expect(source.writes[0]).toContain('t: text')
  })

  it('stores a Template as a Template, holes and all', async () => {
    const source = host()
    mount(source)

    type(await screen.findByLabelText('Value of digest_to'), '{{ triggers.t1.from }}')
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
    expect(source.writes[0]).toContain('{{ triggers.t1.from }}')
  })

  /*
   * The round-trip promise, through the widget rather than through the command.
   * A Workflow Definition lives in the Host's repository and may be hand-written
   * with comments all over it (ADR-0001), so a value box is not allowed to cost
   * anyone their file.
   */
  it('keeps the comments, the key order and the quoting around what it edited', async () => {
    const source = host()
    mount(source)

    type(await screen.findByLabelText('Value of digest_to'), '{{ run.tenant }}')
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)

    const written = source.writes[0] as string
    expect(written).toContain('# Runs before anyone is awake.')
    expect(written).toContain('  # Where the digest goes.')
    expect(written).toContain('name: "Morning inbox triage"')
    // Untouched keys keep their order and their own quoting.
    expect(written).toContain('      at: "0 6 * * 1-5"')
    expect(written.indexOf('key: digest_to')).toBeLessThan(written.indexOf('key: threshold'))
    expect(written).toContain('{{ run.tenant }}')
  })

  it('says so when there are none, and still offers to add one', async () => {
    mount(host('id: wf\nname: n\nversion: 1\nstatus: draft\nsteps: []\n'))
    expect(await screen.findByText('No variables yet.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Add variable' })).toBeDefined()
  })
})

/**
 * The same three sections, addressed at a Block's Board.
 *
 * A Board's root IS its contract (CONTEXT.md), so the middle section is the
 * Triggers at the root and a Block's `params`/`outputs` inside one. Identity and
 * the variables are the same sections pointed at a different Board.
 */
describe('the tab on a Block’s Board', () => {
  const WITH_BLOCK = `# The overnight triage.
id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft

triggers:
  - id: t1
    use: component.schedule.cron
    name: "Every morning"

vars:
  # The workflow's own, and not the block's.
  - key: digest_to
    t: text
    value: "ops@example.com"

steps:
  - id: s1
    use: block.archive_entry
    with: {}

blocks:
  - id: archive_entry
    name: "Archive an entry"
    params:
      - { k: thread, label: "Thread", t: text }
    outputs:
      - { k: url, label: "Where it went", t: text }
    vars:
      - key: attempts
        t: number
        value: 0
    steps: []
  - id: other
    name: "Something else"
    steps: []
  - id: hollow
    name: "Nothing declared yet"
    steps: []
`

  const onBoard = (
    board: BoardId,
    source: Host,
    onBoardRename?: (from: string, to: string) => void,
  ) =>
    render(
      <HatuaProvider
        ports={{ workflows: source.port, manifests: serving(CATALOGUE) }}
        workflowId="wf_morning"
      >
        <Workflow board={board} onBoardRename={onBoardRename} />
      </HatuaProvider>,
    )

  /*
   * The label names the KIND of thing, never which one: the canvas's tab strip
   * already says which Block is open, and repeating it here spends the panel's
   * width twice.
   */
  it('is called Workflow at the root and Block inside one', () => {
    expect(boardTabLabel(null)).toBe('Workflow')
    expect(boardTabLabel('archive_entry')).toBe('Block')
  })

  it('names itself for the Board it is showing, so a landmark and its tab agree', async () => {
    onBoard('archive_entry', host(WITH_BLOCK))
    expect(await screen.findByRole('region', { name: 'Block' })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Workflow' })).toBeNull()
  })

  it('shows the Block’s name and slug, not the workflow’s', async () => {
    onBoard('archive_entry', host(WITH_BLOCK))
    expect((await screen.findByLabelText('Name')) as HTMLInputElement).toHaveProperty(
      'value',
      'Archive an entry',
    )
    expect(screen.getByLabelText('Slug')).toHaveProperty('value', 'archive_entry')
  })

  it('puts the contract where the Triggers are, because they are the same slot', async () => {
    onBoard('archive_entry', host(WITH_BLOCK))
    expect(await screen.findByRole('region', { name: 'Contract' })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Triggers' })).toBeNull()

    expect(screen.getByLabelText('Name of thread')).toHaveProperty('value', 'Thread')
    expect(screen.getByLabelText('Key of thread')).toHaveProperty('value', 'thread')
    expect(screen.getByLabelText('Type of thread')).toHaveProperty('value', 'text')
    expect(screen.getByLabelText('Key of url')).toHaveProperty('value', 'url')
  })

  it('keeps the Triggers at the root, where the workflow’s contract is', async () => {
    onBoard(null, host(WITH_BLOCK))
    expect(await screen.findByRole('region', { name: 'Triggers' })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Contract' })).toBeNull()
  })

  it('lists the Block’s variables and none of the workflow’s', async () => {
    onBoard('archive_entry', host(WITH_BLOCK))
    expect(await screen.findByLabelText('Name of attempts')).toBeDefined()
    expect(screen.queryByLabelText('Name of digest_to')).toBeNull()
  })

  it('writes a contract edit into the Block, and adds at the end of its list', async () => {
    const source = host(WITH_BLOCK)
    onBoard('archive_entry', source)

    type(await screen.findByLabelText('Name of thread'), 'The thread')
    fireEvent.click(screen.getByRole('button', { name: 'Add output' }))
    await waitFor(() => expect(source.writes.length).toBeGreaterThan(0), AUTOSAVED)

    const written = source.writes.at(-1) as string
    // The user's quoting comes back as they wrote it — a flow mapping stays a
    // flow mapping and a quoted scalar stays quoted (ADR-0001).
    expect(written).toContain('{ k: thread, label: "The thread", t: text }')
    // Appended, never inserted above: a call site's fields are drawn in
    // declaration order, so a new one at the top reorders a form somebody is
    // already looking at.
    expect(written.indexOf('k: url')).toBeLessThan(written.indexOf('new_output'))
    // The other Block is untouched, and so is the workflow around it.
    expect(written).toContain('# The overnight triage.')
    expect(written).toContain('id: other')
  })

  it('writes a variable edit into the Block’s own vars, not the workflow’s', async () => {
    const source = host(WITH_BLOCK)
    onBoard('archive_entry', source)

    type(await screen.findByLabelText('Name of attempts'), 'tries')
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)

    const written = source.writes[0] as string
    expect(written).toContain('key: tries')
    expect(written).toContain('key: digest_to')
    expect(written).toContain("# The workflow's own, and not the block's.")
  })

  /*
   * The commands throw on a collision and `EditingStore.apply` turns a throw
   * into a no-op, so a field wired straight to one appears to reject characters
   * at random. The box has to detect it and say so.
   */
  it('refuses a key another declaration on the same side holds, and says why', async () => {
    const source = host(WITH_BLOCK)
    onBoard('archive_entry', source)

    fireEvent.click(await screen.findByRole('button', { name: 'Add parameter' }))
    type(await screen.findByLabelText('Key of new_parameter'), 'thread')

    expect(screen.getByText('Another parameter already uses this name.')).toBeDefined()
    // The key that is still true is what the box shows, and the row it would
    // have collided with is untouched.
    expect(screen.getByLabelText('Key of new_parameter')).toHaveProperty('value', 'new_parameter')
    expect(screen.getByLabelText('Key of thread')).toHaveProperty('value', 'thread')
  })

  /*
   * A row seeded with its key in both boxes is two identical boxes holding
   * identical text, and no caption is enough to tell them apart when the
   * content does not.
   */
  it('gives a new row a name that is not its key, and a second one its own', async () => {
    onBoard('hollow', host(WITH_BLOCK))

    fireEvent.click(await screen.findByRole('button', { name: 'Add parameter' }))
    expect(screen.getByLabelText('Key of new_parameter')).toHaveProperty('value', 'new_parameter')
    expect(screen.getByLabelText('Name of new_parameter')).toHaveProperty('value', 'New parameter')

    fireEvent.click(screen.getByRole('button', { name: 'Add parameter' }))
    await waitFor(() => expect(screen.getByLabelText('Key of new_parameter_2')).toBeDefined())
    expect(screen.getByLabelText('Name of new_parameter_2')).toHaveProperty(
      'value',
      'New parameter 2',
    )
  })

  /*
   * The defect this closes: `Variable 1` is not an `identifier`, so committing
   * it stopped the whole document projecting — and the canvas, the side panel
   * and the step editor all read the projection, so one blur emptied the entire
   * builder and left a raw zod pattern on screen as the only thing to read.
   */
  it('refuses a name the document cannot address, and says what is allowed', async () => {
    const source = host(WITH_BLOCK)
    onBoard(null, source)

    type(await screen.findByLabelText('Name of digest_to'), 'Variable 1')

    expect(screen.getByText(/letters, numbers and underscores/)).toBeDefined()
    // The document still projects, so every other section is still on screen.
    expect(screen.getByLabelText('Name of digest_to')).toHaveProperty('value', 'digest_to')
    expect(screen.getByRole('region', { name: 'Triggers' })).toBeDefined()
    // Nothing a Host would have to store, either.
    await waitFor(() => expect(source.writes).toEqual([]))
  })

  it('says nothing about a name the schema does hold', async () => {
    const source = host(WITH_BLOCK)
    onBoard(null, source)

    type(await screen.findByLabelText('Name of digest_to'), 'digest_cc')

    expect(screen.queryByText(/letters, numbers and underscores/)).toBeNull()
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
    expect(source.writes[0]).toContain('key: digest_cc')
  })

  it('refuses one in a contract key too, because it is the same rule', async () => {
    onBoard('archive_entry', host(WITH_BLOCK))

    type(await screen.findByLabelText('Key of thread'), 'thread id')

    expect(screen.getByText(/letters, numbers and underscores/)).toBeDefined()
    expect(screen.getByLabelText('Key of thread')).toHaveProperty('value', 'thread')
  })

  it('refuses a slug another Block answers to, and says why', async () => {
    onBoard('archive_entry', host(WITH_BLOCK))

    type(await screen.findByLabelText('Slug'), 'other')
    expect(screen.getByText('Another block already uses this slug.')).toBeDefined()
    expect(screen.getByLabelText('Slug')).toHaveProperty('value', 'archive_entry')
  })

  /*
   * A renamed Block is one nothing resolves under its old id, which every
   * reader — the canvas included — reads as a deleted Block. Reported, so a
   * caller holding the Board can follow it rather than being dropped back to
   * the root mid-edit.
   */
  it('reports a slug rename, because the Board on screen is now called something else', async () => {
    const renames: [string, string][] = []
    onBoard('archive_entry', host(WITH_BLOCK), (from, to) => renames.push([from, to]))

    type(await screen.findByLabelText('Slug'), 'archived')
    expect(renames).toEqual([['archive_entry', 'archived']])
  })

  it('says so when the Board names a Block the document does not declare', async () => {
    onBoard('gone', host(WITH_BLOCK))
    expect(await screen.findByText('That block is not in this workflow.')).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Identity' })).toBeNull()
  })

  /*
   * A Block reads only what it declares plus the Run Context — never the
   * workflow's Triggers or its variables (ADR-0013). The value box's completion
   * list is where that reaches a screen.
   */
  it('offers the Block’s scope to a variable’s value, and not the workflow’s', async () => {
    onBoard('archive_entry', host(WITH_BLOCK))

    fireEvent.click(await screen.findByRole('button', { name: 'Insert into Value of attempts' }))

    expect(await screen.findByText('params.thread')).toBeDefined()
    expect(screen.getByText('var.attempts')).toBeDefined()
    expect(screen.queryByText('triggers.t1')).toBeNull()
    expect(screen.queryByText('var.digest_to')).toBeNull()
  })
})

/**
 * Folding a row.
 *
 * A contract with six parameters is a page of boxes expanded, so every row in
 * the panel folds. Folded it is one line — not just the name, which spends the
 * width without answering "which one is this": the summary carries the whole
 * declaration, the way the canvas already says a Board's root as
 * `2 params · 1 output`.
 */
describe('a row folds', () => {
  const WITH_BLOCK = `id: wf_morning
name: n
version: 1
status: draft

triggers:
  - id: t1
    use: component.email.received
    name: "Every morning"

vars:
  - key: digest_to
    t: text
    value: "ops@example.com"

steps: []

blocks:
  - id: archive_entry
    name: "Archive an entry"
    params:
      - { k: thread, label: "Thread", t: text }
    outputs:
      - { k: url, label: "Where it went", t: text }
    steps: []
`

  const onBoard = (board: BoardId, source: Host) =>
    render(
      <HatuaProvider
        ports={{ workflows: source.port, manifests: serving(CATALOGUE) }}
        workflowId="wf_morning"
      >
        <Workflow board={board} />
      </HatuaProvider>,
    )

  /*
   * Folding is a user managing clutter. A tab that opened folded would hide the
   * editor from somebody who came to edit, and a Block with one parameter would
   * hide its only field for nothing.
   */
  it('opens showing its fields, and says so', async () => {
    onBoard('archive_entry', host(WITH_BLOCK))

    const fold = await screen.findByRole('button', { name: 'Collapse thread' })
    expect(fold.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByLabelText('Key of thread')).toBeDefined()
  })

  it('folds to one line carrying the name, the key and the type', async () => {
    onBoard('archive_entry', host(WITH_BLOCK))

    fireEvent.click(await screen.findByRole('button', { name: 'Collapse thread' }))

    expect(screen.queryByLabelText('Key of thread')).toBeNull()
    expect(screen.queryByLabelText('Name of thread')).toBeNull()
    expect(screen.queryByLabelText('Type of thread')).toBeNull()
    // The name alone would not say which parameter this is; the key is what a
    // Template writes and the type is what it is checked against.
    expect(screen.getByText('Thread')).toBeDefined()
    expect(screen.getByText('thread · text')).toBeDefined()
  })

  it('unfolds again, and the row it did not touch stays as it was', async () => {
    onBoard('archive_entry', host(WITH_BLOCK))

    const fold = await screen.findByRole('button', { name: 'Collapse thread' })
    fireEvent.click(fold)
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    // Its neighbour on the other side of the contract is untouched.
    expect(screen.getByLabelText('Key of url')).toBeDefined()

    fireEvent.click(fold)
    expect(fold.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByLabelText('Key of thread')).toBeDefined()
  })

  it('folds a variable to its key and its type, which is all a variable has', async () => {
    onBoard(null, host(WITH_BLOCK))

    fireEvent.click(await screen.findByRole('button', { name: 'Collapse digest_to' }))
    expect(screen.queryByLabelText('Value of digest_to')).toBeNull()
    expect(screen.getByText('digest_to')).toBeDefined()
    expect(screen.getByText('text')).toBeDefined()
  })

  /*
   * A Trigger named after its own Component — which is what adding one gives
   * you — would fold to its name printed twice if the summary carried the type.
   * The id is what `{{ triggers.t1.… }}` writes, so it is a Trigger's key in the
   * sense a declaration's `k` is.
   */
  it('folds a Trigger to its name and its id, never its name twice', async () => {
    const named = `id: wf_morning\nname: n\nversion: 1\nstatus: draft\ntriggers:\n  - id: t1\n    use: component.email.received\n    name: "When mail arrives"\nsteps: []\n`
    onBoard(null, host(named))

    const fold = await screen.findByRole('button', { name: 'Collapse When mail arrives' })
    fireEvent.click(fold)

    // Scoped to the folded row: the catalogue's Trigger picker offers a type
    // under the same name, which is exactly why this Trigger is named after it.
    const head = within(fold.parentElement as HTMLElement)
    expect(head.getAllByText('When mail arrives')).toHaveLength(1)
    expect(head.getByText('t1')).toBeDefined()
  })

  /*
   * The fold manages height; it does not silence the checker. A folded row that
   * hid its own diagnostic would let somebody tidy a problem off their screen.
   */
  it('keeps a Trigger’s diagnostic on screen while the row is folded', async () => {
    onBoard(null, host(WITH_BLOCK))

    const problem = await screen.findByText(/Mailbox is required/)
    expect(problem).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Every morning' }))
    expect(screen.queryByLabelText('Name of Every morning')).toBeNull()
    expect(screen.getByText(/Mailbox is required/)).toBeDefined()
  })

  it('gives a newly added row its fields, because naming it is the next thing', async () => {
    onBoard('archive_entry', host(WITH_BLOCK))

    fireEvent.click(await screen.findByRole('button', { name: 'Add parameter' }))
    const fold = await screen.findByRole('button', { name: 'Collapse new_parameter' })
    expect(fold.getAttribute('aria-expanded')).toBe('true')
  })
})
