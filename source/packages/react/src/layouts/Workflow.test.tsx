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
import { Workflow } from './Workflow'

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

  it('renames a key and leaves every Reference to the old one alone', async () => {
    // Settled in docs/handoff.md: a Reference is stored verbatim, so
    // `{{ var.digest_to }}` goes stale and the checker reports it. Rewriting
    // every Template on a keystroke would edit the file where nobody is
    // looking, and mid-typing every intermediate key is a rename too.
    const source = host(`${SOURCE}    with:\n      to: "{{ var.digest_to }}"\n`)
    mount(source)

    type(await screen.findByDisplayValue('digest_to'), 'digest_recipient')
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)

    expect(source.writes[0]).toContain('key: digest_recipient')
    expect(source.writes[0]).toContain('{{ var.digest_to }}')
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
