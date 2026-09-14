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
import { HatuaProvider, useEditingStore } from '../theme/HatuaProvider'
import { Inspector } from './Inspector'

/** A Host's own control, ending the session without going through a toolbar. */
function Ends() {
  const store = useEditingStore()
  return (
    <button type="button" onClick={() => void store?.release()}>
      end it
    </button>
  )
}

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

/** A workflow with a Block, a call into it, and a Step on its Board. */
const WITH_BLOCKS = `id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft

steps:
  - id: call
    use: block.archive
    name: "Archive it"
    with:
      thread: "{{ triggers.t1.subject }}"

blocks:
  - id: archive
    name: "Archive an entry"
    params:
      - { k: thread, label: "Thread", t: text }
      - { k: urgent, label: "Urgent", t: boolean }
    outputs:
      - { k: url, label: "Where it went", t: text }
    steps:
      - id: b1
        use: component.email.send
      - id: b2
        use: core.return
        with:
          url: "{{ steps.b1.link }}"
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

  it('shows the Connection it just declared, rather than falling back to none', async () => {
    // The document is written correctly and the picker still has to SAY so: a
    // field that snaps back to "—" reads as a choice that did not take.
    const source = host()
    mount(source, on('s1'), CATALOGUE, true)

    const picker = await screen.findByLabelText('Mailbox')
    await waitFor(() => expect(picker.querySelectorAll('option').length).toBeGreaterThan(1))
    fireEvent.change(picker, { target: { value: '+ref_support' } })

    await waitFor(() =>
      expect((screen.getByLabelText('Mailbox') as HTMLSelectElement).value).toBe('support_inbox'),
    )
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
    expect(screen.queryByRole('button', { name: 'References' })).toBeNull()
    unmount()

    mount(host(), { ...on('s1'), onExpandedChange: () => {} })
    expect(await screen.findByRole('button', { name: 'References' })).toBeDefined()
  })
})

/**
 * A Board's root is its contract, so the arguments a call takes and the values
 * a return supplies are declared by the document rather than by a Component
 * Manifest — and `manifest` is undefined for both.
 */
describe('the arguments a Board’s contract declares', () => {
  it('draws a call’s parameters, filled in or not', async () => {
    mount(host(WITH_BLOCKS), on('call'))

    expect(await screen.findByDisplayValue('{{ triggers.t1.subject }}')).toBeDefined()
    // Declared and unanswered. Hiding the row leaves nothing on screen to act
    // on for a parameter its own rule reports as missing.
    expect(screen.getByLabelText('Urgent')).toBeDefined()
    expect(screen.queryByText(/Nothing declares this step type/)).toBeNull()
  })

  it('writes a call’s argument into its `with:`', async () => {
    const source = host(WITH_BLOCKS)
    mount(source, on('call'))

    type(await screen.findByLabelText('Urgent'), '{{ var.rush }}')

    await waitFor(() => expect(source.writes.length).toBeGreaterThan(0), AUTOSAVED)
    expect(source.writes.at(-1)).toContain('urgent: "{{ var.rush }}"')
  })

  /*
   * `addBlock` writes `{id, name, steps: []}` and no `params:` key, so an
   * undefined here is the ordinary state of a Block that takes nothing — and
   * read as "this is not a contract step" the editor says nothing declares a
   * verb the document declares perfectly well.
   */
  it('says a call to a Block that takes nothing takes nothing', async () => {
    const HOLLOW = `id: wf
name: n
version: 1
status: draft
steps:
  - id: call
    use: block.hollow
    name: "Do the thing"
blocks:
  - id: hollow
    name: "Nothing declared yet"
    steps: []
`
    mount(host(HOLLOW), on('call'))
    expect(await screen.findByText('This step takes nothing.')).toBeDefined()
    expect(screen.queryByText(/Nothing declares this step type/)).toBeNull()
  })

  it('draws a return’s values from the Board it sits on', async () => {
    mount(host(WITH_BLOCKS), { selected: { board: 'archive', steps: ['b2'] } })
    expect(await screen.findByLabelText('Where it went')).toBeDefined()
  })
})

describe('what it says about a Step it cannot draw a form for', () => {
  /*
   * Diagnostics are filed under `stepKey`, which is `<board>/<id>` off the root
   * Board. Looked up by the bare id they are found for the root and for nowhere
   * else — so a card the canvas marks draws clean here, on every Board but one.
   */
  it('shows a Step’s problems on a Block’s Board, not only at the root', async () => {
    const REQUIRED: Manifest[] = [
      {
        kind: 'component',
        use: 'component.email.send',
        name: 'Send mail',
        fields: [{ k: 'to', label: 'To', kind: 'text', req: true }],
        outputs: [],
      },
    ]
    mount(host(WITH_BLOCKS), { selected: { board: 'archive', steps: ['b1'] } }, REQUIRED)

    expect(await screen.findByText(/To is required/)).toBeDefined()
  })

  /*
   * <Build> never produces one, but the region is public API and a body with
   * nothing in it and no sentence is a state no region may be left in.
   */
  it('says something for a Segment holding no Steps at all', async () => {
    mount(host(), { selected: { board: null, steps: [] } })
    expect(await screen.findByText('Select a step to fill it in.')).toBeDefined()
  })
})

/*
 * "This expression expects text, but this produces object" says nothing about
 * WHICH of a Step's Templates is wrong. Three of them collected above the form
 * are three sentences a reader cannot act on.
 */
describe('where a diagnostic is drawn', () => {
  const MISMATCHED = `id: wf
name: n
version: 1
status: draft
triggers:
  - id: t1
    use: component.schedule.cron
steps:
  - id: s1
    use: component.email.fetch
  - id: s2
    use: component.email.send
    with:
      to: "{{ steps.s1 }}"
      subject: "{{ steps.s1 }}"
`

  /** Everything the row holding this control says. */
  const marked = (field: HTMLElement) => field.closest('[data-field]')?.textContent ?? ''

  it('puts each message under the field it names', async () => {
    mount(host(MISMATCHED), on('s2'))

    const to = await screen.findByLabelText('To')
    await waitFor(() => expect(marked(to)).toMatch(/expects text/))
    // And on the other one too — both are wrong, and each says so where it is.
    expect(marked(screen.getByLabelText('Subject'))).toMatch(/expects text/)
    // Never both on one field.
    expect(marked(to).match(/expects text/g)).toHaveLength(1)
  })

  it('leaves a field the checker is happy with unmarked', async () => {
    const ONE_BAD = MISMATCHED.replace('subject: "{{ steps.s1 }}"', 'subject: "Nightly"')
    mount(host(ONE_BAD), on('s2'))

    await waitFor(() => expect(marked(screen.getByLabelText('To'))).toMatch(/expects text/))
    expect(marked(screen.getByLabelText('Subject'))).not.toMatch(/expects text/)
  })

  /*
   * A diagnostic about the Step itself names no field and has nowhere else to
   * go, so it keeps its place above the form.
   */
  it('keeps what names no field above the form', async () => {
    // COMPONENT_UNKNOWN is about the Step, not about any field of it.
    mount(host(MISMATCHED), on('s2'), [CATALOGUE[0] as Manifest])
    const said = await screen.findByText(/Nothing declares "component.email.send"/)
    expect(said.closest('[data-field]')).toBeNull()
  })
})

describe('the name field', () => {
  /*
   * A visible label and an accessible name that disagree fail WCAG 2.5.3:
   * voice control acts on the words a user can read, and an aria-label the
   * screen does not carry is not one of them.
   */
  it('answers to the word printed beside it', async () => {
    mount(host(), on('s1'))
    const box = await screen.findByDisplayValue('Fetch the mail')
    expect(box.getAttribute('aria-label')).toBe('Name')
    expect(screen.getByLabelText('Name')).toBe(box)
  })
})

describe('once the session has ended', () => {
  /*
   * The store refuses commands with no claim behind them, and a form that still
   * looked editable would be one whose every keystroke was dropped without a
   * word. What a Step declares stays on screen in full — most of what a Step
   * DOES is what its fields say, so emptying the panel would answer "what is
   * this workflow" with nothing.
   */
  it('shows every parameter, and lets none of them be edited', async () => {
    const source = host()
    render(
      <HatuaProvider
        ports={{ workflows: source.port, manifests: serving(CATALOGUE) }}
        workflowId="wf_morning"
      >
        <Ends />
        <Inspector selected={{ board: null, steps: ['s1'] }} />
      </HatuaProvider>,
    )

    // Editable while the Draft is claimed.
    const name = await screen.findByLabelText('Name')
    expect((name as HTMLInputElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'end it' }))

    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true),
    )
    // The value is still there to read.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).not.toBe('')
    for (const field of screen.getAllByRole('textbox')) {
      expect((field as HTMLInputElement).disabled).toBe(true)
    }
  })
})

describe('the playground’s own shape', () => {
  /*
   * What the seed actually has: a workflow declaring one email Connection bound
   * to a served handle, a Step whose field wants a different type, and several
   * handles served — only one of which fits.
   */
  const LLM = `id: wf_morning
name: n
version: 1
status: draft

connections:
  - id: mailbox
    ref: cx_9f2a

steps:
  - id: s1
    use: component.agent.act
    name: "Sort by urgency"
`

  const AGENT: Manifest[] = [
    {
      kind: 'component',
      use: 'component.agent.act',
      name: 'Run agent',
      fields: [{ k: 'connection', label: 'Model', kind: 'conn', conn_type: 'llm', req: true }],
      outputs: [],
    },
  ]

  const SERVED = [
    { ref: 'cx_9f2a', type: 'email', label: 'Ops mailbox' },
    { ref: 'cx_7c04', type: 'llm', label: 'Claude Code · Haiku 4.5' },
  ]

  const ports = () => ({
    connections: {
      async listConnections() {
        return { items: SERVED.map(({ ref, type }) => ({ ref, type })) }
      },
    },
    describeConnection: {
      async describe(ref: string) {
        const found = SERVED.find((one) => one.ref === ref)
        if (!found) throw new Error(`No connection "${ref}"`)
        return { type: found.type, label: found.label, status: 'ready' as const, details: {} }
      },
    },
  })

  it('offers only the Connection that fits, and keeps it once chosen', async () => {
    const source = host(LLM)
    render(
      <HatuaProvider
        ports={{ workflows: source.port, manifests: serving(AGENT), ...ports() }}
        workflowId="wf_morning"
      >
        <Inspector selected={{ board: null, steps: ['s1'] }} />
      </HatuaProvider>,
    )

    const picker = (await screen.findByLabelText('Model')) as HTMLSelectElement
    await waitFor(() => expect(picker.querySelectorAll('option').length).toBeGreaterThan(1))

    // The email mailbox is not offered for a Model.
    expect([...picker.querySelectorAll('option')].map((one) => one.textContent)).not.toContain(
      'Ops mailbox',
    )

    fireEvent.change(picker, { target: { value: '+cx_7c04' } })

    await waitFor(() =>
      expect((screen.getByLabelText('Model') as HTMLSelectElement).value).not.toBe(''),
    )
  })
})
