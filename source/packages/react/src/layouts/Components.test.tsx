import type { Manifest } from '@hatua/schema'
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
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HatuaProvider } from '../theme/HatuaProvider'
import { Components } from './Components'
import { COMPONENT_MIME } from './dragging'

const component = (over: Partial<Manifest> & Pick<Manifest, 'use' | 'name'>): Manifest => ({
  kind: 'component',
  fields: [],
  outputs: [],
  ...over,
})

const CATALOGUE: Manifest[] = [
  component({
    use: 'component.email.send',
    name: 'Send email',
    group: 'Email',
    icon: '/icons/mail.svg',
    blurb: 'Send a message through a connected mailbox.',
  }),
  component({
    use: 'component.email.received',
    name: 'When mail arrives',
    kind: 'trigger',
    group: 'Email',
    icon: '/icons/inbox.svg',
    blurb: 'Starts the workflow when a message arrives.',
  }),
  component({
    use: 'component.agent.act',
    name: 'Run agent',
    group: 'Intelligence',
    icon: '/icons/zap.svg',
    blurb: "Ask a model to act on the workflow's data.",
  }),
  component({ use: 'core.wait', name: 'Wait' }),
]

/** The Host, faked: a ManifestSource whose promise the test settles by hand. */
function pending() {
  let settle: (manifests: Manifest[]) => void = () => {}
  let fail: (cause: unknown) => void = () => {}
  const source: ManifestSource = {
    loadManifests: () =>
      new Promise<Manifest[]>((resolve, reject) => {
        settle = resolve
        fail = reject
      }),
  }
  return {
    source,
    resolve: (manifests: Manifest[]) => settle(manifests),
    reject: (cause: unknown) => fail(cause),
  }
}

const mount = (element: ReactElement, manifests?: ManifestSource) =>
  render(<HatuaProvider ports={manifests ? { manifests } : undefined}>{element}</HatuaProvider>)

const cardNames = () => screen.queryAllByRole('listitem').map((item) => item.textContent ?? '')

describe('Components', () => {
  it('says so when the Host wired no ManifestSource', async () => {
    // Not the empty state. "Nothing is wired up" and "nothing is declared" have
    // different fixes, and showing the second for the first sends whoever
    // embedded Hatua looking for a manifest file that was never the problem.
    mount(<Components />)
    expect(await screen.findByText(/no Component Manifests are wired up/i)).toBeDefined()
  })

  it('shows loading until the Host answers', async () => {
    const host = pending()
    mount(<Components />, host.source)

    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Loading components…')

    host.resolve(CATALOGUE)
    await waitFor(() => expect(screen.getByText('Send email')).toBeDefined())
    expect(screen.queryByText('Loading components…')).toBeNull()
  })

  it('reports a failure and offers a retry that actually refetches', async () => {
    let attempt = 0
    mount(<Components />, {
      loadManifests: async () => {
        attempt += 1
        if (attempt === 1) throw new Error('the catalogue is offline')
        return CATALOGUE
      },
    })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('the catalogue is offline')

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Send email')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('treats an empty catalogue as a legitimate state, not a fault', async () => {
    // Said to the person looking at it, who has never heard of a manifest and
    // could not act on one. See
    // .agents/rules/rendered-copy-is-written-for-the-hosts-users.md.
    mount(<Components />, { loadManifests: async () => [] })

    expect(await screen.findByText('No components are available yet.')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
    // Nothing to narrow, so nothing to narrow it with.
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('groups by the manifest group, keeping the Host’s order and filing the rest last', async () => {
    mount(<Components />, { loadManifests: async () => CATALOGUE })

    await screen.findByText('Send email')
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Email',
      'Intelligence',
      // "Other" is not a section the Host chose, so it cannot sit above one it did.
      'Other',
    ])
  })

  /*
   * CONTEXT.md: a Trigger is NOT a Step. It lives in `doc.triggers[]`, a
   * top-level list, and adding one is the Workflow tab's job — so a card here,
   * which means "add this to the tree", cannot be one. A tab headed Components
   * that also offered Triggers would present the two as interchangeable.
   */
  it('renders Components only, leaving Triggers to the Workflow tab', async () => {
    mount(<Components />, { loadManifests: async () => CATALOGUE })

    await screen.findByText('Send email')
    expect(screen.queryByText('When mail arrives')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Triggers' })).toBeNull()
  })

  it('drags the same chip the canvas does, so neither gesture covers its target', async () => {
    // A drag ghost is the source element by default, and on the canvas the
    // thing being aimed at is a 20px `+` on a line. One chip for both sources:
    // the two gestures look alike, and neither hides where it is going.
    // Draggable only when it is actionable, which is what `onSelect` makes it.
    mount(<Components onSelect={() => {}} />, { loadManifests: async () => CATALOGUE })

    await screen.findByText('Send email')
    const row = screen.getByRole('button', { name: /Send email/ })
    const images: { element: HTMLElement; x: number; y: number }[] = []
    fireEvent.dragStart(row, {
      dataTransfer: {
        effectAllowed: 'none',
        setData: () => {},
        setDragImage: (element: HTMLElement, x: number, y: number) => {
          images.push({ element, x, y })
        },
      },
    })

    const [image] = images
    expect(image?.element.textContent).toBe('Send email')
    expect(image?.element).not.toBe(row)
    // Negative, so the pointer sits outside the chip rather than under it.
    expect(image?.x).toBeLessThan(0)
    expect(image?.y).toBeLessThan(0)
  })

  it('reads a catalogue of Triggers alone as no components, not as a fault', async () => {
    // The Host declared plenty; none of it belongs on this tab. Same answer as
    // an empty catalogue, because it is the same question.
    mount(<Components />, { loadManifests: async () => [CATALOGUE[1] as Manifest] })

    expect(await screen.findByText('No components are available yet.')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders name, blurb and the icon the Host serves', async () => {
    const { container } = mount(<Components />, {
      loadManifests: async () => [CATALOGUE[0] as Manifest],
    })

    expect(await screen.findByText('Send email')).toBeDefined()
    expect(screen.getByText('Send a message through a connected mailbox.')).toBeDefined()

    // `icon` is a URL, so it has to reach an <img src>. Treating it as a name
    // from an icon set would never resolve to a picture, because Hatua ships
    // none.
    const image = container.querySelector('img') as HTMLImageElement
    expect(image.getAttribute('src')).toBe('/icons/mail.svg')
    // Decorative: the name is right beside it, and announcing it twice helps
    // nobody.
    expect(image.getAttribute('alt')).toBe('')
  })

  it('draws a neutral placeholder when a manifest declares no icon', async () => {
    // Artwork must never block declaring a component, and a guessed-at glyph is
    // worse than an honest blank — it carries no more than the name beside it.
    const { container } = mount(<Components />, {
      loadManifests: async () => [component({ use: 'core.wait', name: 'Wait' })],
    })

    await screen.findByText('Wait')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('falls back to the placeholder when the icon URL fails to load', async () => {
    // A 404 is the Host's to fix; until it does, the card still owes the row a
    // square of the right size.
    const { container } = mount(<Components />, {
      loadManifests: async () => [CATALOGUE[0] as Manifest],
    })

    await screen.findByText('Send email')
    fireEvent.error(container.querySelector('img') as HTMLImageElement)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('filters as the user types', async () => {
    mount(<Components />, { loadManifests: async () => CATALOGUE })
    await screen.findByText('Send email')

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'mail' } })
    expect(cardNames()).toEqual([expect.stringContaining('Send email')])
    expect(screen.queryByText('Run agent')).toBeNull()
  })

  it('matches the blurb and the use, not just the name', async () => {
    mount(<Components />, { loadManifests: async () => CATALOGUE })
    await screen.findByText('Send email')
    const search = screen.getByRole('searchbox')

    fireEvent.change(search, { target: { value: 'connected mailbox' } })
    expect(screen.getByText('Send email')).toBeDefined()

    fireEvent.change(search, { target: { value: 'component.agent.act' } })
    expect(screen.getByText('Run agent')).toBeDefined()
  })

  it('distinguishes "nothing matches" from "nothing declared"', async () => {
    mount(<Components />, { loadManifests: async () => CATALOGUE })
    await screen.findByText('Send email')

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } })
    expect(screen.getByText(/nothing matches/i)).toBeDefined()
    expect(screen.queryByText('No components are available yet.')).toBeNull()
    // The box stays: a filter you cannot clear is a dead end.
    expect(screen.getByRole('searchbox')).toBeDefined()
  })

  it('does not report an empty query as a failed search', async () => {
    // Reachable without anyone typing: an entry whose `kind` this region cannot
    // render files into no section, which would otherwise read as
    // `Nothing matches “”.`
    mount(<Components />, {
      loadManifests: async () => [{ kind: 'gadget', use: 'x', name: 'X' }] as unknown as Manifest[],
    })

    expect(await screen.findByText(/nothing in it is a Component/i)).toBeDefined()
    expect(screen.queryByText(/nothing matches/i)).toBeNull()
    // A malformed catalogue is a wiring mistake, not an empty one, and the two
    // have different fixes.
    expect(screen.queryByText('No components are available yet.')).toBeNull()
  })

  /*
   * The store validates the outer array and deliberately not each entry —
   * `manifests.ts` argues that validating every one "would turn one malformed
   * entry into an empty catalogue". The cost lands here, and it must not land
   * as a TypeError from render: that takes down the Host's tree, which is the
   * outcome the `failed` state exists to avoid.
   */
  it('survives an entry that is not a manifest at all', async () => {
    const junk = [
      null,
      42,
      { kind: 'component' },
      { kind: 7, name: 3, use: [], blurb: {}, group: null, icon: 12 },
      CATALOGUE[0] as Manifest,
    ] as unknown as Manifest[]

    mount(<Components />, { loadManifests: async () => junk })

    // The one real entry still renders, and nothing threw on the way.
    expect(await screen.findByText('Send email')).toBeDefined()
  })

  it('reports a catalogue of nothing but junk rather than crashing on it', async () => {
    mount(<Components />, {
      loadManifests: async () => [null, 'nope'] as unknown as Manifest[],
    })

    expect(await screen.findByText(/nothing in it is a Component/i)).toBeDefined()
  })

  /*
   * One array level off is a payload-shaped mistake, not an entry-shaped one,
   * and the store rejects it: a Components tab that loads successfully and
   * shows nothing reads as "this Host has declared nothing" and sends the
   * integrator looking in the wrong place. Every other reader of the same array
   * — the Triggers section, the checker, scope — gets the same answer for free.
   */
  it('reports a catalogue served one array too shallow as a failed load', async () => {
    mount(<Components />, {
      loadManifests: async () => [{ components: [] }] as unknown as Manifest[],
    })

    expect(await screen.findByText(/flat array of entries/i)).toBeDefined()
    expect(screen.queryByText('No components are available yet.')).toBeNull()
  })

  it('names a component the Host left unnamed, rather than drawing a blank row', async () => {
    // Dropping it would leave whoever wrote that manifest counting rows that
    // are not there.
    mount(<Components />, {
      loadManifests: async () => [{ kind: 'component', use: 'core.wait' }] as unknown as Manifest[],
    })

    expect(await screen.findByText('core.wait')).toBeDefined()
  })

  it('keeps one live region mounted, so a change to it is a change worth announcing', async () => {
    // A <p role="status"> inserted together with its text is a new node, not an
    // update to a watched one, and is frequently announced by nothing.
    const host = pending()
    mount(<Components />, host.source)

    const live = screen.getByRole('status')
    expect(live.textContent).toBe('Loading components…')

    host.resolve(CATALOGUE)
    await screen.findByText('Send email')

    // Same element, emptied — not removed.
    expect(screen.getByRole('status')).toBe(live)
    expect(live.textContent).toBe('')
  })

  it('starts filtered when told to', async () => {
    mount(<Components defaultQuery="agent" />, { loadManifests: async () => CATALOGUE })

    expect(await screen.findByText('Run agent')).toBeDefined()
    expect(screen.queryByText('Send email')).toBeNull()
  })

  it('hands back what writes the Step, and nothing a Block could not supply', async () => {
    const onSelect = vi.fn()
    mount(<Components onSelect={onSelect} />, { loadManifests: async () => CATALOGUE })

    fireEvent.click(await screen.findByRole('button', { name: /Send email/ }))
    expect(onSelect).toHaveBeenCalledWith({ use: 'component.email.send', name: 'Send email' })
  })

  it('leaves an entry with no verb a row to read rather than a button that does nothing', async () => {
    const onSelect = vi.fn()
    mount(<Components onSelect={onSelect} />, {
      loadManifests: async () => [{ kind: 'component', name: 'Half a manifest' } as Manifest],
    })

    // There is nothing to write a Step with, so there is nothing for a click to
    // do — and a control that does nothing still takes a tab stop.
    await screen.findByText('Half a manifest')
    expect(screen.queryByRole('button', { name: /Half a manifest/ })).toBeNull()
  })

  it('carries the Host’s name into the drag, never the placeholder standing in for one', async () => {
    const onSelect = vi.fn()
    mount(<Components onSelect={onSelect} />, {
      loadManifests: async () => [{ kind: 'component', use: 'component.x' } as Manifest],
    })

    // "Unnamed component" is a sentence about a broken manifest. Written into
    // the document as a Step's name it becomes something the user has to undo.
    fireEvent.click(await screen.findByRole('button', { name: /component\.x/ }))
    expect(onSelect).toHaveBeenCalledWith({ use: 'component.x' })
  })

  it('renders cards as cards, not as dead buttons, when nothing can be selected', async () => {
    mount(<Components />, { loadManifests: async () => CATALOGUE })

    await screen.findByText('Send email')
    // A control that does nothing still takes a tab stop and still announces
    // itself as a button.
    expect(screen.queryByRole('button', { name: /Send email/ })).toBeNull()
  })

  it('reads the catalogue once however many Components regions mount', async () => {
    const loadManifests = vi.fn(async () => CATALOGUE)
    render(
      <HatuaProvider ports={{ manifests: { loadManifests } }}>
        <Components />
        <Components />
      </HatuaProvider>,
    )

    await waitFor(() => expect(screen.getAllByText('Send email')).toHaveLength(2))
    expect(loadManifests).toHaveBeenCalledTimes(1)
  })

  it('reloads when the Host swaps the source, and not while it holds the same one', async () => {
    // The source has to be referentially stable, the same way any React
    // dependency does — a Host that builds `{ loadManifests: … }` inline on
    // every render is telling Hatua the catalogue changed on every render, and
    // Hatua has no way to tell that apart from a real swap.
    const first: ManifestSource = { loadManifests: vi.fn(async () => [CATALOGUE[0] as Manifest]) }
    const second: ManifestSource = { loadManifests: vi.fn(async () => [CATALOGUE[2] as Manifest]) }

    const { rerender } = render(
      <HatuaProvider ports={{ manifests: first }}>
        <Components />
      </HatuaProvider>,
    )
    await screen.findByText('Send email')

    // A fresh `ports` object holding the same source is not a change.
    rerender(
      <HatuaProvider ports={{ manifests: first }}>
        <Components />
      </HatuaProvider>,
    )
    expect(first.loadManifests).toHaveBeenCalledTimes(1)

    rerender(
      <HatuaProvider ports={{ manifests: second }}>
        <Components />
      </HatuaProvider>,
    )
    expect(await screen.findByText('Run agent')).toBeDefined()
    expect(screen.queryByText('Send email')).toBeNull()
  })
})

/**
 * The Blocks this document declares, listed beside the Host's Components.
 *
 * A verb's root says who declares it, and two of the three roots are here — so
 * everything below is about the one the Host does not serve: it comes off the
 * document, it is created and deleted here, and it becomes a Step by the same
 * two gestures a Host's Component does.
 */

const DOCUMENT = `id: wf_blocks
name: "Morning triage"
version: 1
status: draft

steps:
  - id: s1
    use: block.archive_entry
    name: "File the thread away"
  - id: s2
    use: core.fork
    branches:
      - label: "A lot"
        when: "{{ true }}"
        steps:
          - id: s3
            use: block.archive_entry

blocks:
  - id: archive_entry
    name: "Archive an entry"
    params:
      - { k: thread, label: "Thread", t: text }
    outputs:
      - { k: url, label: "Where it went", t: text }
    steps:
      - id: done
        use: core.return
        with:
          url: "https://archive.example.com/x"
  - id: spare
    steps: []
`

const token = 'tok_test' as EditToken
const lease: Lease = { token, expiresAt: '2099-01-01T00:00:00.000Z' }

/** The Host's storage, faked, keeping every write so a test can read the file back. */
function storing(yaml = DOCUMENT) {
  const writes: string[] = []
  const port: WorkflowStore = {
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
      return { version: 2, publishedAt: '2026-01-01T00:00:00.000Z' }
    },
    async releaseDraft() {},
    async discardDraft() {},
    async listVersions(): Promise<Cursor<VersionSummary>> {
      return { items: [] }
    },
    async loadVersion() {
      return yaml
    },
  }
  return { port, writes }
}

const withDocument = (element: ReactElement, host = storing()) =>
  render(
    <HatuaProvider
      ports={{ manifests: { loadManifests: async () => CATALOGUE }, workflows: host.port }}
      workflowId="wf_blocks"
    >
      {element}
    </HatuaProvider>,
  )

/** The Blocks group, once it has arrived. */
const blocksGroup = async () => {
  const heading = await screen.findByRole('heading', { name: 'Blocks' })
  return within(heading.parentElement as HTMLElement)
}

/** Autosave waits for quiet, and a machine running every suite at once is slow. */
const AUTOSAVED = { timeout: 5000 }

describe('the Blocks a document declares', () => {
  it('lists them, above the Host’s groups', async () => {
    withDocument(<Components />)

    const group = await blocksGroup()
    expect(group.getByText('Archive an entry')).toBeDefined()
    // The contract, in the words the canvas already says it in.
    expect(group.getByText('1 param · 1 output')).toBeDefined()

    // Above, not among: the Host's groups are ordered as the Host declared
    // them, and this is not one the Host chose.
    const headings = screen.getAllByRole('heading').map((one) => one.textContent)
    expect(headings[0]).toBe('Blocks')
    expect(headings).toContain('Email')
  })

  /*
   * `byBlock` holds what is wrong with a Block ITSELF — a path without a
   * return, a cycle, a repeated key. A Block whose Steps are broken has none of
   * those, so its card drew clean while the workflow could not run.
   *
   * Its own catalogue, declaring the structural verbs the shared one leaves
   * out: with `core.return` unknown, every Block holding one is already
   * troubled and the assertion would pass without the rule under test.
   */
  const whole = [
    ...CATALOGUE,
    component({ use: 'core.return', name: 'Return' }),
    component({ use: 'core.fork', name: 'Branch' }),
  ]

  const withWholeCatalogue = (yaml: string) =>
    render(
      <HatuaProvider
        ports={{ manifests: { loadManifests: async () => whole }, workflows: storing(yaml).port }}
        workflowId="wf_blocks"
      >
        <Components />
      </HatuaProvider>,
    )

  it('marks a Block whose own Board will not run', async () => {
    withWholeCatalogue(
      DOCUMENT.replace('url: "https://archive.example.com/x"', 'url: "{{ var.nope }}"'),
    )

    const group = await blocksGroup()
    await waitFor(() => expect(group.getByText(/problems on its own board/i)).toBeDefined())
  })

  it('says nothing about a Block whose Board is fine', async () => {
    withWholeCatalogue(DOCUMENT)

    const group = await blocksGroup()
    // Waited for, so this is "checked and clean" rather than "not checked yet".
    await waitFor(() => expect(group.getByText('1 param · 1 output')).toBeDefined())
    expect(group.queryByText(/problems on its own board/i)).toBeNull()
  })

  it('names a Block by its id when it has no name of its own', async () => {
    withDocument(<Components />)
    expect((await blocksGroup()).getByText('spare')).toBeDefined()
  })

  it('is absent when no storage is wired, and the catalogue still lists', async () => {
    // Nothing here restates the document's own states: the Workflow tab says
    // the Host wired no storage, and a second copy in this panel would be two
    // sentences about one problem.
    mount(<Components />, { loadManifests: async () => CATALOGUE })

    await screen.findByText('Send email')
    expect(screen.queryByRole('heading', { name: 'Blocks' })).toBeNull()
  })

  it('hands back the verb a call is written with', async () => {
    const onSelect = vi.fn()
    withDocument(<Components onSelect={onSelect} />)

    const group = await blocksGroup()
    fireEvent.click(group.getByRole('button', { name: /^Archive an entry/ }))
    expect(onSelect).toHaveBeenCalledWith({
      use: 'block.archive_entry',
      name: 'Archive an entry',
    })
  })

  it('drags what it clicks, so the two gestures cannot write two different Steps', async () => {
    const onSelect = vi.fn()
    withDocument(<Components onSelect={onSelect} />)

    const card = (await blocksGroup()).getByRole('button', { name: /^Archive an entry/ })
    const setData = vi.fn()
    fireEvent.dragStart(card, {
      dataTransfer: { setData, setDragImage: vi.fn(), effectAllowed: 'none' },
    })

    expect(setData).toHaveBeenCalledWith(
      COMPONENT_MIME,
      JSON.stringify({ use: 'block.archive_entry', name: 'Archive an entry' }),
    )
    // And the verb alone for every other editor on the page.
    expect(setData).toHaveBeenCalledWith('text/plain', 'block.archive_entry')
  })

  it('opens the Board of a Block nothing calls, which nothing else can reach', async () => {
    const onBoardOpen = vi.fn()
    const onSelect = vi.fn()
    withDocument(<Components onBoardOpen={onBoardOpen} onSelect={onSelect} />)

    // `spare` has no call site, so the canvas has no doorway into it and the
    // tab strip lists only Boards already open. Without this control it can be
    // declared and never opened again.
    fireEvent.click(await screen.findByRole('button', { name: 'Open spare' }))

    expect(onBoardOpen).toHaveBeenCalledWith('spare')
    // Going to the Board is not adding a call to it.
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('offers no doorway when the caller holds no Board to open', async () => {
    // Which Board is on screen is chrome this region does not hold, so with
    // nobody listening there is nowhere for the control to go.
    withDocument(<Components />)

    await blocksGroup()
    expect(screen.queryByRole('button', { name: 'Open spare' })).toBeNull()
  })

  it('filters Blocks the way it filters the Host’s Components', async () => {
    withDocument(<Components defaultQuery="archive" />)

    const group = await blocksGroup()
    expect(group.getByText('Archive an entry')).toBeDefined()
    expect(group.queryByText('spare')).toBeNull()
    expect(screen.queryByText('Send email')).toBeNull()
  })

  it('marks a Block the checker has something to say about', async () => {
    const recursive = DOCUMENT.replace(
      '  - id: spare\n    steps: []\n',
      '  - id: spare\n    steps:\n      - id: again\n        use: block.spare\n',
    )
    withDocument(<Components onSelect={() => {}} />, storing(recursive))

    // Marked, never withheld: a Block in a cycle is still a Block the user is
    // working on, and a card that quietly disappeared would say the panel had
    // changed its mind rather than what is wrong.
    const group = await blocksGroup()
    await waitFor(() => expect(group.getByText(/calls itself/)).toBeDefined())
    expect(group.getByRole('button', { name: /^spare/ })).toBeDefined()
  })
})

describe('declaring one', () => {
  it('writes it and says which one, so its Board can be opened', async () => {
    const onBoardOpen = vi.fn()
    const host = storing()
    withDocument(<Components onBoardOpen={onBoardOpen} />, host)

    fireEvent.click(await screen.findByRole('button', { name: 'New block' }))

    // ADR-0017: a Block's tab opens when the Block is declared, and a caller
    // cannot open one it does not know the name of.
    expect(onBoardOpen).toHaveBeenCalledWith('block_1')
    expect((await blocksGroup()).getByText('block_1')).toBeDefined()
    await waitFor(() => expect(host.writes.at(-1)).toContain('- id: block_1'), AUTOSAVED)
  })

  it('mints against the ids already taken, twice running', async () => {
    withDocument(<Components />)

    const button = await screen.findByRole('button', { name: 'New block' })
    fireEvent.click(button)
    fireEvent.click(button)

    const group = await blocksGroup()
    expect(group.getByText('block_1')).toBeDefined()
    expect(group.getByText('block_2')).toBeDefined()
  })

  it('is not offered while the list is narrowed to a search', async () => {
    // A Block declared out of a search reads as the thing that was searched
    // for, and lands under a filter that hides it.
    withDocument(<Components defaultQuery="archive" />)

    await blocksGroup()
    expect(screen.queryByRole('button', { name: 'New block' })).toBeNull()
  })
})

describe('deleting one', () => {
  it('goes straight through when the Block is empty and nothing calls it', async () => {
    const host = storing()
    withDocument(<Components />, host)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete spare' }))

    // Nothing is lost that was not on the card, so a dialog in front of it is
    // friction with nothing to report.
    expect(screen.queryByRole('dialog')).toBeNull()
    const group = await blocksGroup()
    await waitFor(() => expect(group.queryByText('spare')).toBeNull())
  })

  it('says what a Block with call sites costs before taking it away', async () => {
    withDocument(<Components />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Archive an entry' }))

    const dialog = within(screen.getByRole('dialog'))
    // Both costs are invisible from the card: the Steps on its Board are on
    // another screen, and its call sites are wherever somebody wrote them.
    expect(dialog.getByText(/It has 1 step on it\./)).toBeDefined()
    expect(dialog.getByText(/2 steps call it/)).toBeDefined()
  })

  it('counts a call nested inside a container, not just the top level', async () => {
    // A call inside a Fork branch is a call. Counted off the top level alone,
    // the dialog would under-report exactly the sites hardest to find again.
    withDocument(<Components />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Archive an entry' }))
    expect(within(screen.getByRole('dialog')).getByText(/2 steps call it/)).toBeDefined()
  })

  it('changes nothing when the confirmation is declined', async () => {
    withDocument(<Components />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Archive an entry' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect((await blocksGroup()).getByText('Archive an entry')).toBeDefined()
  })

  it('removes it on confirm and leaves every call site alone', async () => {
    const host = storing()
    withDocument(<Components />, host)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Archive an entry' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    const group = await blocksGroup()
    await waitFor(() => expect(group.queryByText('Archive an entry')).toBeNull())

    // Stale, reported and never rewritten — the rule `removeBlock` follows.
    // Rewriting a call site would edit the file in a place the user is not
    // looking, which is the confirmation's job to warn about instead.
    await waitFor(() => {
      const written = host.writes.at(-1) ?? ''
      expect(written).toContain('use: block.archive_entry')
      expect(written).not.toContain('id: archive_entry')
    }, AUTOSAVED)
  })
})
