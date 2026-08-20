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
    use: email.fetch
    name: "Fetch mail"
  - id: s2
    use: core.fork
    name: "How urgent?"
    branches:
      - label: Urgent
        when: "{{ s1.count > 10 }}"
        steps:
          - id: s3
            use: chat.post
            name: "Ping the channel"
      - label: Otherwise
        steps: []
  - id: s4
    use: core.for_each
    name: "Archive each"
    steps:
      - id: s5
        use: email.archive
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

const mount = (source: Host, props: Parameters<typeof StepList>[0] = {}) =>
  render(
    <HatuaProvider ports={{ workflows: source.port }} workflowId="wf_morning">
      <StepList {...props} />
    </HatuaProvider>,
  )

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
    expect(screen.getByText('{{ s1.count > 10 }}')).toBeDefined()
  })

  it('says what makes a Step structural', async () => {
    mount(host())
    await screen.findByText('Fetch mail')
    expect(screen.getByText(/core\.fork · 2 branches/)).toBeDefined()
    expect(screen.getByText(/core\.for_each · 1 step$/)).toBeDefined()
  })

  it('offers a Branch with no Steps somewhere to drop one', async () => {
    mount(host())
    expect(await screen.findByText('Drop a Component here')).toBeDefined()
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
    mount(host('id: wf\nname: n\nversion: 1\nstatus: draft\nsteps: []\n'))
    expect(await screen.findByText(/No Steps yet/)).toBeDefined()
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
    await waitFor(() => expect(source.writes).toHaveLength(1))
  })

  it('keeps the user’s comment through an edit, which is the round-trip promise', async () => {
    const source = host()
    mount(source)
    await screen.findByText('Fetch mail')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Fetch mail' }))

    await waitFor(() => expect(source.writes).toHaveLength(1))
    expect(source.writes[0]).toContain('# Kept, whatever the tree does to it.')
    expect(source.writes[0]).toContain('name: "Morning inbox triage"')
  })

  it('removes a nested Step without disturbing its Branch', async () => {
    mount(host())
    await screen.findByText('Ping the channel')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ping the channel' }))

    expect(screen.queryByText('Ping the channel')).toBeNull()
    // The Branch is still there, now empty and saying so.
    expect(screen.getAllByText('Drop a Component here')).toHaveLength(2)
  })

  it('hands an insert point out rather than guessing at a Component', async () => {
    // This region knows where a Step would go and nothing about what to put
    // there — the catalogue is the Library's. So the point goes out as a prop.
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
     * Regression. A container's <li> wraps its children's, so the keydown
     * bubbled and this handler ran again at every enclosing level: one
     * Alt+ArrowDown on a Step inside a loop moved that Step AND moved the loop
     * past its next sibling — two mutations and two undo entries from one
     * keypress. Only stopPropagation stops it; preventDefault does not.
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
