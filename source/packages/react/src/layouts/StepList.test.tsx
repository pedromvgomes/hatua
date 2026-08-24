import type { Manifest } from '@hatua/schema'
import type {
  Cursor,
  DraftSession,
  EditToken,
  Lease,
  PublishedVersion,
  VersionSummary,
  WorkflowStore,
} from '@hatua/services'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HatuaProvider } from '../theme/HatuaProvider'
import { StepList } from './StepList'

/**
 * The Flow tab against a Host's WorkflowStore.
 *
 * Everything here mounts <StepList /> with no document prop, because it takes
 * none: Hatua has no storage and no idea where a workflow lives, so the port
 * goes into <HatuaProvider> and the region subscribes to what comes out. A test
 * that passed a document in would be testing a component this repo does not
 * have.
 */

const SOURCE = `# Kept, whatever the tree does to it.
id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft

steps:
  - id: s1
    use: component.email.fetch
    name: "Fetch mail"
  - id: s2
    use: core.fork
    name: "How urgent?"
    branches:
      - label: Urgent
        when: "{{ steps.s1.count > 10 }}"
        steps:
          - id: s3
            use: component.chat.post
            name: "Ping the channel"
      - label: Otherwise
        steps: []
  - id: s4
    use: core.for_each
    name: "Archive each"
    steps:
      - id: s5
        use: component.email.archive
        name: "Archive"
`

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
      ...overrides,
    },
  }
}

const mount = (source: Host, props: Parameters<typeof StepList>[0] = {}, manifests?: Manifest[]) =>
  render(
    <HatuaProvider
      ports={{
        workflows: source.port,
        ...(manifests ? { manifests: { loadManifests: async () => manifests } } : {}),
      }}
      workflowId="wf_morning"
    >
      <StepList {...props} />
    </HatuaProvider>,
  )

/**
 * Long enough for the autosave debounce plus contention.
 *
 * Autosave waits 800ms of quiet before it writes, and `waitFor` defaults to a
 * 1000ms timeout — 200ms of headroom, which a machine running the whole
 * monorepo's suites in parallel does not reliably have. The debounce is the
 * behaviour under test, so the wait has to outlast it by a margin rather than
 * race it.
 */
const AUTOSAVED = { timeout: 5000 }

/** The Step rows, top to bottom, by the name each one shows. */
const rowNames = () =>
  screen
    .getAllByRole('button')
    .filter((button) => !button.hasAttribute('aria-label'))
    .map((button) => button.firstElementChild?.textContent)

/**
 * The row's `<li>`, which is what carries `draggable` and the keyboard handler.
 *
 * Matched on the name the row SHOWS rather than on its accessible name, which
 * is the name and the meta line run together — and a prefix match on that
 * cannot tell "Archive" from "Archive each".
 */
const rowFor = (name: string) => {
  const identity = screen
    .getAllByRole('button')
    .find(
      (button) =>
        !button.hasAttribute('aria-label') && button.firstElementChild?.textContent === name,
    )
  if (!identity) throw new Error(`no Step row named "${name}"`)
  return identity.closest('li') as HTMLElement
}

describe('StepList', () => {
  it('says so when the Host wired no storage, rather than showing an empty workflow', () => {
    // "The Host wired nothing" and "the workflow has no Steps" are different
    // problems with different fixes, so they are different states.
    render(<StepList />)
    expect(screen.getByText(/No workflow is wired up/)).toBeDefined()
  })

  it('opens the Draft and draws the tree', async () => {
    mount(host())
    expect(await screen.findByText('Fetch mail')).toBeDefined()
    expect(screen.getByText('How urgent?')).toBeDefined()
    expect(screen.getByText('Ping the channel')).toBeDefined()
    expect(screen.getByText('Archive')).toBeDefined()
  })

  it('opens once, however the region re-renders', async () => {
    const opens = vi.fn(
      async (): Promise<DraftSession> => ({
        token,
        lease,
        yaml: SOURCE,
        resumed: false,
      }),
    )
    const source = host(SOURCE, { openDraft: opens })
    const view = mount(source)
    await screen.findByText('Fetch mail')
    view.rerender(
      <HatuaProvider ports={{ workflows: source.port }} workflowId="wf_morning">
        <StepList />
      </HatuaProvider>,
    )
    expect(opens).toHaveBeenCalledTimes(1)
  })

  it('names the Branches with the keyword the fork implies', async () => {
    // Read from whether any Branch carries `when`, because the schema has no
    // mode field: "absent on the fallback branch of a condition fork".
    mount(host())
    await screen.findByText('Fetch mail')
    expect(screen.getByText('if')).toBeDefined()
    expect(screen.getByText('else')).toBeDefined()
    expect(screen.getByText('loop')).toBeDefined()
    expect(screen.getByText('{{ steps.s1.count > 10 }}')).toBeDefined()
  })

  it('says what makes a Step structural', async () => {
    mount(host())
    await screen.findByText('Fetch mail')
    expect(screen.getByText(/core\.fork · 2 branches/)).toBeDefined()
    expect(screen.getByText(/core\.for_each · 1 step$/)).toBeDefined()
  })

  it('offers a Branch with no Steps somewhere to put one', async () => {
    // One element, not two: an empty list's insert point IS its empty state.
    // It says Step rather than Component because the Components cards are not
    // draggable and sit behind another tab — no Component can be dropped
    // here.
    mount(host())
    expect(await screen.findByText('Drop a Step here')).toBeDefined()
    expect(screen.queryByText(/Drop a Component/)).toBeNull()
  })

  it('turns the empty Branch into the control that fills it, when there is a handler', async () => {
    mount(host(), { onInsert: () => {} })
    await screen.findByText('Fetch mail')

    expect(
      screen.getByRole('button', { name: 'Add the first Step to the “Otherwise” branch' }),
    ).toBeDefined()
    // ...and then it is a control rather than a label.
    expect(screen.queryByText('Drop a Step here')).toBeNull()
  })

  it('reports a failed open, with a way back', async () => {
    const source = host(SOURCE, {
      openDraft: async () => {
        throw new Error('Another session holds the draft.')
      },
    })
    mount(source)
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Another session holds the draft/,
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined()
  })

  it('holds a document that does not project, and says why there is no tree', async () => {
    // ADR-0001's consequence: toJSON() throws while the source is not a valid
    // Workflow Definition, which is a legitimate state. The document is open,
    // the text is intact, and there is simply nothing to draw.
    mount(host('name: half written\n'))
    expect(await screen.findByText(/not a valid Workflow Definition yet/)).toBeDefined()
    expect(screen.getByText(/nothing has been discarded/)).toBeDefined()
  })

  it('fails only when the YAML will not parse at all', async () => {
    mount(host('steps: [unclosed\n'))
    expect(await screen.findByRole('alert')).toBeDefined()
  })

  it('renders an empty workflow as a state, not a fault', async () => {
    // No special case for it any more: a sequence of nothing renders exactly
    // one insert point, and that insert point knows how to be an empty state.
    mount(host('id: wf\nname: n\nversion: 1\nstatus: draft\nsteps: []\n'))
    expect(await screen.findByText('Drop a Step here')).toBeDefined()
  })

  it('lets an empty workflow be filled from its own insert point', async () => {
    const onInsert = vi.fn()
    mount(host('id: wf\nname: n\nversion: 1\nstatus: draft\nsteps: []\n'), { onInsert })

    fireEvent.click(
      await screen.findByRole('button', { name: 'Add the first Step to the workflow' }),
    )
    expect(onInsert).toHaveBeenCalledWith({ index: 0 })
  })
})

describe('selection and collapse — chrome, not the document', () => {
  it('selects a row and tells the Host, without writing anything', async () => {
    const onSelect = vi.fn()
    const source = host()
    mount(source, { onSelect })

    fireEvent.click(await screen.findByRole('button', { name: /^Fetch mail/ }))
    expect(onSelect).toHaveBeenCalledWith('s1')
    // Selection is chrome. Were it in the document it would autosave, and a
    // hand-edited file would gain a key about what some session highlighted.
    expect(source.writes).toHaveLength(0)
  })

  it('collapses a container and hides its subtree', async () => {
    mount(host())
    await screen.findByText('Fetch mail')
    expect(screen.getByText('Ping the channel')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse How urgent?' }))
    expect(screen.queryByText('Ping the channel')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expand How urgent?' }))
    expect(screen.getByText('Ping the channel')).toBeDefined()
  })

  it('offers no collapse control on a leaf, which has nothing to collapse', async () => {
    mount(host())
    await screen.findByText('Fetch mail')
    expect(screen.queryByRole('button', { name: /Collapse Fetch mail/ })).toBeNull()
  })
})

describe('edits go through the store as commands', () => {
  it('removes a Step and autosaves without a Save button anywhere', async () => {
    const source = host()
    mount(source)
    await screen.findByText('Fetch mail')

    fireEvent.click(screen.getByRole('button', { name: 'Remove Fetch mail' }))
    expect(screen.queryByText('Fetch mail')).toBeNull()

    // Nothing was clicked to save it. ADR-0005: editing autosaves, and the user
    // decides only Publish, Release and Discard.
    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
  })

  it('keeps the user’s comment through an edit, which is the round-trip promise', async () => {
    const source = host()
    mount(source)
    await screen.findByText('Fetch mail')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Fetch mail' }))

    await waitFor(() => expect(source.writes).toHaveLength(1), AUTOSAVED)
    expect(source.writes[0]).toContain('# Kept, whatever the tree does to it.')
    expect(source.writes[0]).toContain('name: "Morning inbox triage"')
  })

  it('removes a nested Step without disturbing its Branch', async () => {
    mount(host())
    await screen.findByText('Ping the channel')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ping the channel' }))

    expect(screen.queryByText('Ping the channel')).toBeNull()
    // The Branch is still there, now empty and saying so.
    expect(screen.getAllByText('Drop a Step here')).toHaveLength(2)
  })

  it('reports the selection clearing when the selected Step is removed', async () => {
    // <Build> holds the selection across the unmount the tab strip forces, so a
    // selection cleared only in here comes back on the next mount naming a Step
    // the document no longer has — which is what the step editor gets handed.
    const onSelect = vi.fn()
    mount(host(), { onSelect })
    await screen.findByText('Fetch mail')

    fireEvent.click(screen.getByText('Fetch mail'))
    expect(onSelect).toHaveBeenLastCalledWith('s1')

    fireEvent.click(screen.getByRole('button', { name: 'Remove Fetch mail' }))
    expect(onSelect).toHaveBeenLastCalledWith(undefined)
  })

  it('says nothing when a Step other than the selected one is removed', async () => {
    const onSelect = vi.fn()
    mount(host(), { onSelect })
    await screen.findByText('Fetch mail')

    fireEvent.click(screen.getByText('Fetch mail'))
    onSelect.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Archive' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('hands an insert point out rather than guessing at a Component', async () => {
    // This region knows where a Step would go and nothing about what to put
    // there — the catalogue is the Components tab's. So the point goes out as a prop.
    const onInsert = vi.fn()
    mount(host(), { onInsert })
    await screen.findByText('Fetch mail')

    fireEvent.click(
      screen.getByRole('button', { name: 'Insert a Step at the start of the workflow' }),
    )
    expect(onInsert).toHaveBeenCalledWith({ index: 0 })
  })

  it('renders no insert control at all without a handler for it', async () => {
    mount(host())
    await screen.findByText('Fetch mail')
    expect(screen.queryByRole('button', { name: /Insert a Step/ })).toBeNull()
  })

  it('moves a Step with the keyboard, because drag and drop reaches nobody without a pointer', async () => {
    const source = host()
    mount(source)
    await screen.findByText('Fetch mail')
    expect(rowNames().slice(0, 3)).toEqual(['Fetch mail', 'How urgent?', 'Ping the channel'])

    fireEvent.keyDown(rowFor('Fetch mail'), { key: 'ArrowDown', altKey: true })

    await waitFor(() => expect(rowNames()[0]).toBe('How urgent?'))
  })

  it('moves one Step per keypress, not one per level of nesting', async () => {
    /*
     * A container's <li> wraps its children's, so without stopPropagation the
     * keydown bubbles and the handler runs again at every enclosing level: one
     * Alt+ArrowDown on a Step inside a loop moves that Step AND moves the loop
     * past its next sibling — two mutations and two undo entries from one
     * keypress. preventDefault does not stop it.
     */
    const source = host()
    mount(source)
    await screen.findByText('Archive')

    fireEvent.keyDown(rowFor('Archive'), { key: 'ArrowUp', altKey: true })

    // "Archive" is alone in the loop, so the move is a no-op — and the loop
    // itself must not have moved in its place.
    await act(() => Promise.resolve())
    expect(rowNames()).toEqual([
      'Fetch mail',
      'How urgent?',
      'Ping the channel',
      'Archive each',
      'Archive',
    ])
    expect(source.writes).toHaveLength(0)
  })

  it('ignores Alt+Arrow pressed on a nested insert point', async () => {
    // A nested list's `+` buttons are DOM descendants of their container's
    // <li>, so the innermost handler such a keypress reaches is the CONTAINER's
    // — and stopping propagation cannot help, because there is no nearer
    // handler to stop it at. It moved the loop instead of doing nothing.
    const source = host()
    mount(source, { onInsert: () => {} })
    await screen.findByText('Archive')

    const before = rowNames()
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Insert a Step at the start of the “Archive each” loop' }),
      { key: 'ArrowUp', altKey: true },
    )

    await act(() => Promise.resolve())
    expect(rowNames()).toEqual(before)
    expect(source.writes).toHaveLength(0)
  })

  it('ignores an arrow without Alt, which is how a list is read rather than reordered', async () => {
    mount(host())
    await screen.findByText('Fetch mail')
    fireEvent.keyDown(rowFor('Fetch mail'), { key: 'ArrowDown' })
    expect(rowNames()[0]).toBe('Fetch mail')
  })

  it('will not move a Step off the end of its own list', async () => {
    const source = host()
    mount(source)
    await screen.findByText('Fetch mail')
    fireEvent.keyDown(rowFor('Fetch mail'), { key: 'ArrowUp', altKey: true })

    expect(rowNames()[0]).toBe('Fetch mail')
    await act(() => Promise.resolve())
    expect(source.writes).toHaveLength(0)
  })

  it('drops a dragged Step onto an insert point', async () => {
    const source = host()
    mount(source, { onInsert: () => {} })
    await screen.findByText('Fetch mail')

    const row = rowFor('Fetch mail')
    const target = screen
      .getByRole('button', { name: 'Insert a Step after Archive each' })
      .closest('li') as HTMLElement

    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn() }
    fireEvent.dragStart(row, { dataTransfer })
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })

    await waitFor(() => expect(rowNames().at(-1)).toBe('Fetch mail'))
  })
})

describe('dragging', () => {
  const dataTransfer = () => ({
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn(),
    getData: vi.fn(),
  })

  const drag = (from: HTMLElement, onto: HTMLElement) => {
    const transfer = dataTransfer()
    fireEvent.dragStart(from, { dataTransfer: transfer })
    fireEvent.dragOver(onto, { dataTransfer: transfer })
    fireEvent.drop(onto, { dataTransfer: transfer })
  }

  const gapNamed = (name: string) =>
    screen.getByRole('button', { name }).closest('li') as HTMLElement

  it('moves a Step nested inside a loop', async () => {
    /*
     * The same shape as the Alt+Arrow case. `onDragStart` bubbles from the
     * dragged row's <li> up through every container's, and the last handler to
     * run wins — so without stopPropagation `dragging` holds the loop's id
     * rather than the Step's, and dropping into that loop's own list is refused
     * as a move into itself: nothing moves and nothing says why. Root-level
     * rows have no ancestor <li>, so only nested drags are affected.
     */
    const source = host(
      `id: wf
name: n
version: 1
status: draft
steps:
  - id: s1
    use: core.for_each
    name: "Each message"
    steps:
      - id: s2
        use: component.email.send
        name: "Send email"
      - id: s3
        use: component.email.send
        name: "Send digest"
`,
    )
    mount(source, { onInsert: () => {} })
    await screen.findByText('Send digest')

    drag(rowFor('Send digest'), gapNamed('Insert a Step at the start of the “Each message” loop'))

    await waitFor(() => expect(rowNames()).toEqual(['Each message', 'Send digest', 'Send email']))
  })

  it('moves a Step nested inside a Branch', async () => {
    const source = host()
    mount(source, { onInsert: () => {} })
    await screen.findByText('Ping the channel')

    drag(rowFor('Ping the channel'), gapNamed('Insert a Step at the start of the workflow'))
    await waitFor(() => expect(rowNames()[0]).toBe('Ping the channel'))
  })

  it('does nothing when the drop lands with no drag in progress', async () => {
    const source = host()
    mount(source, { onInsert: () => {} })
    await screen.findByText('Fetch mail')

    const transfer = dataTransfer()
    fireEvent.drop(gapNamed('Insert a Step at the start of the workflow'), {
      dataTransfer: transfer,
    })

    await act(() => Promise.resolve())
    expect(rowNames()[0]).toBe('Fetch mail')
    expect(source.writes).toHaveLength(0)
  })

  it('clears the drag when it is abandoned rather than dropped', async () => {
    const source = host()
    mount(source, { onInsert: () => {} })
    await screen.findByText('Fetch mail')

    const row = rowFor('Fetch mail')
    fireEvent.dragStart(row, { dataTransfer: dataTransfer() })
    fireEvent.dragEnd(row)

    // With the drag cleared, a later drop is inert.
    fireEvent.drop(gapNamed('Insert a Step after Archive each'), { dataTransfer: dataTransfer() })
    await act(() => Promise.resolve())
    expect(rowNames()[0]).toBe('Fetch mail')
  })

  it('stops lighting up an insert point once the pointer leaves it', async () => {
    const source = host()
    mount(source, { onInsert: () => {} })
    await screen.findByText('Fetch mail')

    const gap = gapNamed('Insert a Step at the start of the workflow')
    fireEvent.dragStart(rowFor('Fetch mail'), { dataTransfer: dataTransfer() })
    fireEvent.dragOver(gap, { dataTransfer: dataTransfer() })
    fireEvent.dragLeave(gap)
    expect(gap.className).not.toMatch(/gapOver/)
  })
})

describe('when the Host rejects a write', () => {
  it('says saving stopped, and keeps every edit on screen', async () => {
    // ADR-0005: a rejected write halts autosave and keeps the in-memory
    // document rather than retrying or discarding. The panel's job is to say
    // the first half out loud, because the second half is invisible — the tree
    // looks exactly the same whether the edit was written or not.
    const source = host(SOURCE, {
      saveDraft: async () => {
        throw new Error('Your lease expired.')
      },
    })
    mount(source)
    await screen.findByText('Fetch mail')

    fireEvent.click(screen.getByRole('button', { name: 'Remove Fetch mail' }))
    expect(await screen.findByText(/Saving stopped/)).toBeDefined()

    // Not reverted, and still an editor.
    expect(screen.queryByText('Fetch mail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Archive each' }))
    expect(screen.queryByText('Archive each')).toBeNull()
  })
})

/*
 * Its own document rather than a `core.try` added to SOURCE: the tests above
 * assert exact row lists and exact drag destinations, so a Step appended to the
 * shared fixture changes what they are about.
 */
const TRIED = `id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft

steps:
  - id: s1
    use: core.try
    name: "Publish the digest"
    steps:
      - id: s2
        use: component.email.send
        name: "Send it"
    handler:
      - id: s3
        use: component.chat.post
        name: "Say it failed"
`

describe('a core.try draws two regions', () => {
  /*
   * The one Step with two child regions, so the one place the tree has to say
   * which is which. `steps:` holds a loop's children and a try's body alike, so
   * the word comes from the verb — "loop" over the Steps a try is protecting
   * would name the wrong control flow.
   */
  it('labels the body `try` and the handler `on failure`, rather than calling either a loop', async () => {
    mount(host(TRIED))
    await screen.findByText('Publish the digest')

    const card = rowFor('Publish the digest')
    const chips = [...card.querySelectorAll('span')]
      .map((one) => one.textContent)
      .filter((text) => text === 'try' || text === 'on failure' || text === 'loop')

    expect(chips).toEqual(['try', 'on failure'])
  })

  it('draws a Step from each region, so neither is a region nothing renders', async () => {
    mount(host(TRIED))
    expect(await screen.findByText('Send it')).toBeDefined()
    expect(screen.getByText('Say it failed')).toBeDefined()
  })

  /*
   * The one Step whose expanded height is not what its count implies: a body
   * count alone reads as the whole of it, on a card that opens into two
   * regions.
   */
  it('says it has a handler in its summary, which a body count alone would hide', async () => {
    mount(host(TRIED))
    await screen.findByText('Publish the digest')
    expect(rowFor('Publish the digest').textContent).toContain('core.try · 1 step · handler')
  })
})

describe('landmarks', () => {
  it('nests the tree so a screen reader hears three top-level Steps, not eleven rows', async () => {
    // A flat list with a computed indent looks identical and says the wrong
    // thing: there is no way to express depth outside `role="tree"`, so the
    // structure has to be in the DOM.
    mount(host())
    await screen.findByText('Fetch mail')

    const region = screen.getByRole('region', { name: 'Steps' })
    const top = within(region).getAllByRole('list')[0] as HTMLElement
    const rows = [...top.children].filter((child) => child.querySelector('button'))
    expect(rows.length).toBeGreaterThanOrEqual(3)
  })
})

describe('marking a Step that is not filled in', () => {
  const CATALOGUE: Manifest[] = [
    {
      kind: 'component',
      use: 'component.email.fetch',
      name: 'Fetch',
      fields: [{ k: 'folder', label: 'Folder', kind: 'text', req: true }],
      outputs: [],
    },
    { kind: 'component', use: 'component.chat.post', name: 'Post', fields: [], outputs: [] },
    { kind: 'component', use: 'component.email.archive', name: 'Archive', fields: [], outputs: [] },
    { kind: 'component', use: 'core.fork', name: 'Fork', fields: [], outputs: [] },
    { kind: 'component', use: 'core.for_each', name: 'Loop', fields: [], outputs: [] },
  ]

  /** The problem reports, which are text rather than the coloured edge. */
  const reports = () =>
    screen
      .queryAllByRole('status')
      .map((mark) => mark.textContent ?? '')
      .filter((text) => text.includes('problem'))

  it('marks the Step whose required field is empty, and only that one', async () => {
    mount(host(), {}, CATALOGUE)
    await screen.findByText('Fetch mail')

    await waitFor(() => expect(reports().length).toBeGreaterThan(0))
    expect(reports().some((text) => text.startsWith('Fetch mail:'))).toBe(true)
    expect(reports().some((text) => text.startsWith('Ping the channel:'))).toBe(false)
  })

  it('says what is wrong in words, not in colour alone', async () => {
    // The marker itself is a coloured edge, which a screen reader cannot see
    // and neither can anyone who does not distinguish the hue.
    mount(host(), {}, CATALOGUE)
    await screen.findByText('Fetch mail')

    await waitFor(() => expect(reports().length).toBeGreaterThan(0))
    const report = reports().find((text) => text.startsWith('Fetch mail:')) as string
    expect(report).toContain('1 problem')
    expect(report).toContain('Folder is required.')
  })

  it('explains itself to a pointer too, from anywhere on the row', async () => {
    // A 3px edge is not something to ask anyone to hover.
    mount(host(), {}, CATALOGUE)
    await screen.findByText('Fetch mail')

    const row = rowFor('Fetch mail').querySelector('[title]') as HTMLElement
    await waitFor(() => expect(row.getAttribute('title')).toContain('Folder is required.'))
  })

  it('marks a fork with only one Branch', async () => {
    const yaml = `id: wf\nname: n\nversion: 1\nstatus: draft\nsteps:\n  - id: s1\n    use: core.fork\n    name: "Only one"\n    branches:\n      - label: L\n        steps: []\n`
    mount(host(yaml), {}, CATALOGUE)
    await screen.findByText('Only one')

    await waitFor(() => expect(reports().length).toBeGreaterThan(0))
    expect(reports()[0]).toContain('at least two branches')
  })

  it('marks nothing at all until the catalogue has arrived', async () => {
    // Every Step is an unknown component until the manifests land, so painting
    // before then would flash a marker on every row of a good workflow.
    mount(host(), {}, undefined)
    await screen.findByText('Fetch mail')
    expect(reports()).toHaveLength(0)
  })

  it('marks nothing once the Step is filled in', async () => {
    const yaml = `id: wf\nname: n\nversion: 1\nstatus: draft\nsteps:\n  - id: s1\n    use: component.email.fetch\n    name: "Done"\n    with:\n      folder: INBOX\n`
    mount(host(yaml), {}, CATALOGUE)
    await screen.findByText('Done')
    expect(reports()).toHaveLength(0)
  })
})
