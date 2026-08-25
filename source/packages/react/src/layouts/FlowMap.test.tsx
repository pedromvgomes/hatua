import { parseWorkflow } from '@hatua/document'
import { layout } from '@hatua/layout'
import { boardOf, nameOf, stepKey, walkSteps } from '@hatua/model'
import type { Manifest, WorkflowDefinition } from '@hatua/schema'
import type { Cursor, DraftSession, EditToken, Lease, WorkflowStore } from '@hatua/services'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HatuaProvider } from '../theme/HatuaProvider'
import { FlowMap } from './FlowMap'

/**
 * The canvas against a Host's WorkflowStore.
 *
 * Everything here mounts <FlowMap /> with no document prop, because it takes
 * none: the port goes into <HatuaProvider> and the region subscribes to what
 * comes out. Which Board is on screen is the one thing it does take, and only
 * because a caller may want the Flow tab to follow it.
 */

/** Every region a container owns, plus two Blocks that each hold a `ret`. */
const SOURCE = `id: wf_map
name: "Everything at once"
version: 1
status: draft

triggers:
  - id: nightly
    use: core.schedule
    with: {}

steps:
  - id: fetch
    use: component.email.fetch
    name: "Fetch mail"
  - id: sort
    use: core.fork
    name: "How urgent?"
    with: { mode: condition }
    branches:
      - label: Urgent
        when: "{{ steps.fetch.count }} > 0"
        steps:
          - id: guarded
            use: core.try
            name: "Publish the digest"
            with: { attempts: 2 }
            steps:
              - id: triage
                use: component.agent.act
                name: "Triage"
            handler:
              - id: shelve
                use: component.email.send
                name: "Shelve it"
      - label: Otherwise
        steps: []
  - id: first
    use: block.alpha
    name: "Archive one"
    with: {}
  - id: second
    use: block.beta
    name: "Archive another"
    with: {}

blocks:
  - id: alpha
    name: "Archive an entry"
    outputs:
      - { k: url, label: URL, t: text }
    steps:
      - id: ret
        use: core.return
        name: "Alpha returns"
        with: { url: a }
  - id: beta
    name: "Archive another entry"
    outputs:
      - { k: url, label: URL, t: text }
    steps:
      - id: ret
        use: core.return
        name: "Beta returns"
        with: { url: b }
`

const NESTED = `id: wf_nested
name: n
version: 1
status: draft
steps:
  - id: each
    use: core.for_each
    name: "Each message"
    with: {}
    steps:
      - id: inner
        use: component.email.send
        name: "On the root"
blocks:
  - id: alpha
    name: "A block"
    steps:
      - id: each
        use: core.for_each
        name: "Each entry"
        with: {}
        steps:
          - id: inner
            use: component.email.send
            name: "In the block"
`

const token = 'tok_map' as EditToken
const lease: Lease = { token, expiresAt: '2099-01-01T00:00:00.000Z' }

const serving = (yaml: string): WorkflowStore => ({
  async openDraft(): Promise<DraftSession> {
    return { token, lease, yaml, resumed: false }
  },
  async saveDraft() {},
  async renewLease(): Promise<Lease> {
    return lease
  },
  async publish() {
    return { version: 2, publishedAt: '2026-01-01T00:00:00.000Z' }
  },
  async releaseDraft() {},
  async discardDraft() {},
  async listVersions(): Promise<Cursor<never>> {
    return { items: [] }
  },
  async loadVersion() {
    return yaml
  },
})

const mount = (yaml = SOURCE, props: Parameters<typeof FlowMap>[0] = {}) =>
  render(
    <HatuaProvider ports={{ workflows: serving(yaml) }} workflowId="wf_map">
      <FlowMap {...props} />
    </HatuaProvider>,
  )

const canvas = () => within(screen.getByRole('region', { name: 'Flow map' }))

/**
 * A `DataTransfer` jsdom does not implement.
 *
 * Only the two methods a drop target uses, because that is the whole of the
 * platform surface this code touches — and a fuller fake would be a second
 * implementation of a browser API to check code that only ever asks it two
 * questions.
 */
const transfer = (data: Record<string, string>, effectAllowed = 'none') => {
  const held = { ...data }
  return {
    effectAllowed,
    dropEffect: 'none',
    // The one thing the platform WILL answer before the drop, and the reason
    // the canvas can recognise a Component crossing it. Keys rather than a
    // fixed list, so a transfer written here says exactly what it carries.
    types: Object.keys(held),
    getData: (type: string) => held[type] ?? '',
    setData: (type: string, value: string) => {
      held[type] = value
    },
  }
}

/** The name on every card drawn, in DOM order. */
const cardNames = () =>
  canvas()
    .getAllByRole('button')
    .filter((button) => !button.hasAttribute('aria-label'))
    .map((button) => button.firstElementChild?.textContent)

/** The root Board of the fixture the region is reading. */
const rootBoard = () => {
  const board = boardOf(definitionOf(SOURCE), null)
  if (!board) throw new Error('the fixture lost its root Board')
  return board
}

/** The same document the region is reading, projected here. */
const definitionOf = (yaml: string): WorkflowDefinition => {
  const projected = parseWorkflow(yaml).validate()
  if (!projected.success) throw new Error('the fixture stopped projecting')
  return projected.data
}

describe('FlowMap', () => {
  it('says so when the Host wired no storage, rather than showing an empty map', () => {
    render(<FlowMap />)
    expect(screen.getByText(/No workflow is wired up/)).toBeDefined()
  })

  it('draws the root Board, and names the node above the first Step for its Triggers', async () => {
    mount()
    expect(await canvas().findByText('Fetch mail')).toBeDefined()
    expect(canvas().getByText('Triggers')).toBeDefined()
    expect(canvas().getByText('1 trigger')).toBeDefined()
  })

  /**
   * The guard that closes what #39 could not: `@hatua/layout` had no consumer,
   * so the geometry could be wrong and every suite stayed green.
   *
   * Every Placement is a card and every card is a Placement — which is the map's
   * version of "every Step placed exactly once", and what catches a region the
   * canvas forgets to render.
   */
  it('draws exactly the cards `layout` places, over the same Board', async () => {
    mount()
    await canvas().findByText('Fetch mail')

    const board = rootBoard()
    const placed = layout(board).placements.map((placement) => {
      const step = [...walkSteps(board.steps)].find((one) => one.id === placement.ref.id)
      if (!step) throw new Error(`a Placement names no Step: ${stepKey(placement.ref)}`)
      return nameOf(step)
    })

    expect(placed.length).toBeGreaterThan(0)
    expect([...cardNames()].sort()).toEqual([...placed].sort())
    expect(cardNames().length).toBe(placed.length)
  })

  it('draws one band per region, saying what `regionsOf` calls it', async () => {
    mount()
    await canvas().findByText('Fetch mail')

    // The fork's two Branches, the try's two regions — every region the
    // document carries, and never the ones the verb implies.
    expect(canvas().getByText('if')).toBeDefined()
    expect(canvas().getByText('else')).toBeDefined()
    expect(canvas().getByText('try')).toBeDefined()
    expect(canvas().getByText('on failure')).toBeDefined()
    // The Branch's own label sits beside the keyword the fork's shape decides.
    expect(canvas().getByText('Urgent')).toBeDefined()
  })

  /**
   * A Nest is the container's extent and a Band is one region's. Nothing joins a
   * card to its own regions, so the overlap is the whole of what says the
   * regions are its — and without a drawn edge a `+` belongs to no list anybody
   * can see.
   */
  it('draws one frame per container and one per region inside it', async () => {
    mount()
    await canvas().findByText('Fetch mail')

    const board = rootBoard()
    const map = layout(board)
    const surface = screen.getByRole('region', { name: 'Flow map' })
    const boxes = [...surface.querySelectorAll('div')].map((box) => box.style.top)

    expect(map.nests.length).toBeGreaterThan(0)
    for (const nest of map.nests) expect(boxes).toContain(`${nest.y}px`)
    for (const band of map.bands) expect(boxes).toContain(`${band.y}px`)
  })

  it('marks where a Fork’s Branches converge, and marks nothing else', async () => {
    mount()
    await canvas().findByText('Fetch mail')

    const marks = canvas().getAllByText(/come back together$/)
    expect(marks.map((mark) => mark.textContent)).toEqual([
      'The branches of How urgent? come back together',
    ])
  })

  it('names every card by its verb, which is what a Step is written with', async () => {
    mount()
    await canvas().findByText('Fetch mail')
    expect(canvas().getByText('component.email.fetch')).toBeDefined()
    expect(canvas().getByText('core.fork')).toBeDefined()
  })

  it('draws a line for the gaps that are one, and a `+` on every gap', async () => {
    // The lines are what make 96px of vertical gap read as "then" rather than
    // as two unrelated cards. ADR-0013 refuses an edge a user can attach
    // anything to, and there is nothing here to attach to: no exit handle, no
    // endpoint that takes a pointer, and no Connection in the document.
    mount(SOURCE, { onInsert: () => {} })
    await canvas().findByText('Fetch mail')

    const board = rootBoard()
    const { links } = layout(board)
    const paths = screen.getByRole('region', { name: 'Flow map' }).querySelectorAll('path')

    // A line for every `run` and every `join`, and none for the gaps at a
    // region's two ends: containment is drawn as overlap, so a line from a card
    // to its own body would give the one idiom on this map a second meaning.
    expect(links.length).toBeGreaterThan(0)
    const drawn = links.filter((link) => link.kind === 'run' || link.kind === 'join')
    expect(drawn.length).toBeGreaterThan(0)
    expect(links.some((link) => link.kind === 'enter')).toBe(true)
    expect(paths).toHaveLength(drawn.length)
    // `Add the first Step to …` as well as `Insert a Step …`: an empty region's
    // only gap is its empty state, and it says so.
    const dots = canvas().getAllByRole('button', { name: /Step/ })
    expect(dots).toHaveLength(links.filter((link) => link.at !== undefined).length)
    // Every one names a different place, which is the whole reason they are
    // spelled out rather than numbered.
    expect(new Set(dots.map((dot) => dot.getAttribute('aria-label'))).size).toBe(dots.length)
  })
})

/**
 * The canvas is how a workflow is built, so the gestures that build one are
 * here: a `+` in every gap, a Component dropped onto one, and a Step dragged
 * from one gap to another.
 */
describe('building on the canvas', () => {
  const CATALOGUE: Manifest[] = [
    {
      kind: 'component',
      use: 'component.email.send',
      name: 'Send email',
      blurb: 'Send a message.',
      icon: '/icons/mail.svg',
      fields: [{ k: 'to', label: 'To', kind: 'text' }],
      outputs: [],
    },
  ]

  const withCatalogue = (props: Parameters<typeof FlowMap>[0] = {}) =>
    render(
      <HatuaProvider
        ports={{
          workflows: serving(SOURCE),
          manifests: { loadManifests: async () => CATALOGUE },
        }}
        workflowId="wf_map"
      >
        <FlowMap {...props} />
      </HatuaProvider>,
    )

  it('hands an insert point out rather than guessing at a Component', async () => {
    // The canvas knows where a Step would go and nothing about what to put
    // there — the catalogue is the Components tab's. So the point goes out.
    const onInsert = vi.fn()
    mount(SOURCE, { onInsert })
    await canvas().findByText('Fetch mail')

    fireEvent.click(canvas().getByRole('button', { name: 'Insert a Step after Fetch mail' }))
    expect(onInsert).toHaveBeenCalledWith({ board: null, index: 1 })
  })

  it('renders no insert control at all without a handler for it', async () => {
    // The state `apps/playground/src/host.tsx` mounts. The lines are still
    // drawn, because the flow is still the flow.
    mount()
    await canvas().findByText('Fetch mail')
    expect(canvas().queryByRole('button', { name: /Step/ })).toBeNull()
  })

  it('offers a `+` inside an empty Branch, which is the only way to fill it', async () => {
    mount(SOURCE, { onInsert: () => {} })
    await canvas().findByText('Fetch mail')
    expect(
      canvas().getByRole('button', { name: 'Add the first Step to the “Otherwise” branch' }),
    ).toBeDefined()
  })

  it('offers a `+` under the root node of an empty Board, which has no cards at all', async () => {
    const EMPTY = `id: wf_empty\nname: n\nversion: 1\nstatus: draft\nsteps: []\n`
    mount(EMPTY, { onInsert: () => {} })
    // Without this there is no way to add the first Step to a new workflow.
    expect(
      await canvas().findByRole('button', { name: 'Add the first Step to the workflow' }),
    ).toBeDefined()
  })

  it('names the Board a `+` adds to, so a Block gets its own Step', async () => {
    const onInsert = vi.fn()
    mount(SOURCE, { defaultBoardId: 'alpha', onInsert })
    await canvas().findByText('Alpha returns')

    fireEvent.click(canvas().getByRole('button', { name: 'Insert a Step after Alpha returns' }))
    expect(onInsert).toHaveBeenCalledWith({ board: 'alpha', index: 1 })
  })

  it('turns a Component dropped on a `+` into that point and that verb', async () => {
    const onDropComponent = vi.fn()
    mount(SOURCE, { onDropComponent, onInsert: () => {} })
    await canvas().findByText('Fetch mail')

    const dot = canvas().getByRole('button', { name: 'Insert a Step after Fetch mail' })
      .parentElement as HTMLElement
    const data = transfer({
      'application/x-hatua-component': JSON.stringify({
        use: 'component.email.send',
        name: 'Send email',
      }),
    })
    fireEvent.drop(dot, { dataTransfer: data })

    expect(onDropComponent).toHaveBeenCalledWith(
      { use: 'component.email.send', name: 'Send email' },
      { board: null, index: 1 },
    )
  })

  it('ignores a drop it cannot read rather than adding a Step nobody asked for', async () => {
    const onDropComponent = vi.fn()
    mount(SOURCE, { onDropComponent, onInsert: () => {} })
    await canvas().findByText('Fetch mail')

    const dot = canvas().getByRole('button', { name: 'Insert a Step after Fetch mail' })
      .parentElement as HTMLElement
    fireEvent.drop(dot, { dataTransfer: transfer({ 'application/x-hatua-component': 'not json' }) })
    expect(onDropComponent).not.toHaveBeenCalled()
  })

  /** The `<li>` a `+` sits in, which is the drop target and the thing that lights. */
  const slotFor = (name: string) =>
    canvas().getByRole('button', { name }).parentElement as HTMLElement

  it('lights every gap for a Component crossing the surface, not only the one under the pointer', async () => {
    mount(SOURCE, { onDropComponent: () => {}, onInsert: () => {} })
    await canvas().findByText('Fetch mail')

    const gap = slotFor('Insert a Step after Fetch mail')
    const before = gap.className
    expect(before).not.toContain('live')

    // `getData` is refused until the drop, but the TYPES are readable now — and
    // the private type means "a Component" all by itself. Without reading them
    // a gap cannot know a drag is happening until the pointer is already on top
    // of it, so every gap stays a target that has to be aimed at while a Step
    // dragged across this same canvas lights all of them.
    const surface = gap.closest('div') as HTMLElement
    fireEvent.dragOver(surface, {
      dataTransfer: transfer({ 'application/x-hatua-component': '{"use":"a"}' }),
    })

    expect(gap.className).toContain('live')
    expect(slotFor('Insert a Step at the start of the workflow').className).toContain('live')
  })

  it('drops the light when the drag leaves the canvas, and not when it crosses a card', async () => {
    mount(SOURCE, { onDropComponent: () => {}, onInsert: () => {} })
    await canvas().findByText('Fetch mail')

    const gap = slotFor('Insert a Step after Fetch mail')
    const surface = gap.closest('div') as HTMLElement
    fireEvent.dragOver(surface, {
      dataTransfer: transfer({ 'application/x-hatua-component': '{"use":"a"}' }),
    })
    expect(gap.className).toContain('live')

    // `dragleave` fires on every child the pointer crosses and bubbles, so a
    // pointer moving from the surface onto a card would put every gap out.
    // Constructed rather than `fireEvent.dragLeave(el, { relatedTarget })`,
    // which drops the property — and `relatedTarget` is the whole subject here.
    fireEvent(surface, new MouseEvent('dragleave', { bubbles: true, relatedTarget: gap }))
    expect(gap.className).toContain('live')

    fireEvent(surface, new MouseEvent('dragleave', { bubbles: true, relatedTarget: document.body }))
    expect(gap.className).not.toContain('live')
  })

  it('says what releasing here does: a Component is copied in, a Step is moved', async () => {
    mount(SOURCE, { onDropComponent: () => {}, onInsert: () => {} })
    await canvas().findByText('Fetch mail')
    const gap = slotFor('Insert a Step after Fetch mail')

    // Read off what the source declared rather than left to the browser to
    // guess. It is the pointer's only account of the gesture, and the two
    // gestures do different things.
    const carried = transfer({ 'application/x-hatua-component': '{"use":"a"}' }, 'copy')
    fireEvent.dragOver(gap, { dataTransfer: carried })
    expect(carried.dropEffect).toBe('copy')

    const moved = transfer({}, 'move')
    fireEvent.dragOver(gap, { dataTransfer: moved })
    expect(moved.dropEffect).toBe('move')
  })

  it('moves a Step dragged from one gap to another', async () => {
    const source = serving(SOURCE)
    const writes: string[] = []
    render(
      <HatuaProvider
        ports={{
          workflows: {
            ...source,
            async saveDraft(_t, text) {
              writes.push(text)
            },
          },
        }}
        workflowId="wf_map"
      >
        <FlowMap onInsert={() => {}} />
      </HatuaProvider>,
    )
    await canvas().findByText('Fetch mail')

    const card = canvas().getByText('Fetch mail').closest('[draggable]') as HTMLElement
    fireEvent.dragStart(card, { dataTransfer: transfer({}) })
    const dot = canvas().getByLabelText('Insert a Step after Archive another')
      .parentElement as HTMLElement
    fireEvent.drop(dot, { dataTransfer: transfer({}) })

    await waitFor(() => expect(cardNames()[0]).not.toBe('Fetch mail'), { timeout: 5000 })
  })

  it('draws the Component’s icon, which is a URL the Host serves', async () => {
    withCatalogue()
    await canvas().findByText('Fetch mail')
    // `component.email.send` is the one verb the catalogue declares an icon for.
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('img')].some(
          (img) => img.getAttribute('src') === '/icons/mail.svg',
        ),
      ).toBe(true),
    )
  })

  it('shows a filled Slot as a chip, and shows none before the catalogue lands', async () => {
    const WITH_ARGS = `id: wf_args\nname: n\nversion: 1\nstatus: draft\nsteps:\n  - id: s1\n    use: component.email.send\n    name: "Send it"\n    with: { to: "me@example.com" }\n`
    const { unmount } = mount(WITH_ARGS)
    await canvas().findByText('Send it')
    // No catalogue: nothing declares `to` a Slot, so there is nothing to show.
    expect(canvas().queryByText('me@example.com')).toBeNull()
    unmount()

    render(
      <HatuaProvider
        ports={{
          workflows: serving(WITH_ARGS),
          manifests: { loadManifests: async () => CATALOGUE },
        }}
        workflowId="wf_args"
      >
        <FlowMap />
      </HatuaProvider>,
    )
    expect(await canvas().findByText('me@example.com')).toBeDefined()
  })
})

describe('a Board is what the canvas draws one of', () => {
  it('opens a call into the Block it names, and comes back', async () => {
    const onBoardChange = vi.fn()
    mount(SOURCE, { onBoardChange })
    await canvas().findByText('Archive one')

    fireEvent.click(canvas().getByRole('button', { name: 'Open Archive one' }))
    expect(onBoardChange).toHaveBeenLastCalledWith('alpha')

    // The Block's Board, its contract as the root node, and its own Step.
    expect(canvas().getByText('Alpha returns')).toBeDefined()
    expect(canvas().getByText('0 params · 1 output')).toBeDefined()
    // Named twice on purpose: the breadcrumb says where you are, and the root
    // node says what this Board's contract is.
    expect(
      within(canvas().getByRole('navigation', { name: 'Board' })).getByText('Archive an entry'),
    ).toBeDefined()
    expect(canvas().queryByText('Fetch mail')).toBeNull()

    fireEvent.click(canvas().getByRole('button', { name: '← The workflow' }))
    expect(onBoardChange).toHaveBeenLastCalledWith(null)
    expect(canvas().getByText('Fetch mail')).toBeDefined()
  })

  it('offers no doorway on a Step that calls nothing', async () => {
    mount()
    await canvas().findByText('Fetch mail')
    expect(canvas().queryByRole('button', { name: 'Open Fetch mail' })).toBeNull()
  })

  it('falls back to the root Board rather than drawing a Block that is gone', async () => {
    // A Block deleted in Text Mode while its Board is open. Nothing on screen
    // may name a tree the document no longer has.
    mount(SOURCE, { defaultBoardId: 'nowhere' })
    expect(await canvas().findByText('Fetch mail')).toBeDefined()
    expect(canvas().queryByRole('navigation', { name: 'Board' })).toBeNull()
  })

  /**
   * Step ids are Board-local (ADR-0013), so two Blocks may each hold a `ret`.
   * Keyed by a bare id the two are one entry, and selecting one selects both.
   */
  it('selects a `ret` on one Block without selecting the `ret` on the other', async () => {
    const onSelect = vi.fn()
    mount(SOURCE, { defaultBoardId: 'alpha', onSelect })
    await canvas().findByText('Alpha returns')

    fireEvent.click(canvas().getByText('Alpha returns'))
    expect(onSelect).toHaveBeenLastCalledWith({ board: 'alpha', id: 'ret' })

    // The same id on the other Board, and the selection does not follow it.
    const view = render(
      <HatuaProvider ports={{ workflows: serving(SOURCE) }} workflowId="wf_map">
        <FlowMap defaultBoardId="beta" selected={{ board: 'alpha', id: 'ret' }} />
      </HatuaProvider>,
    )
    const other = within(view.container.querySelector('[aria-label="Flow map"]') as HTMLElement)
    await other.findByText('Beta returns')
    expect(
      other
        .getAllByRole('button')
        .filter((button) => button.getAttribute('aria-current') === 'true'),
    ).toHaveLength(0)
  })

  it('collapses a container on one Board without collapsing the same id on another', async () => {
    // `collapsed` is a set of StepRefs for exactly this reason: bare ids are one
    // set shared by every Board, so folding `each` at the root folds a Block's.
    const onCollapseChange = vi.fn()
    mount(NESTED, { onCollapseChange })
    await canvas().findByText('Each message')

    fireEvent.click(canvas().getByRole('button', { name: 'Collapse Each message' }))
    expect(onCollapseChange).toHaveBeenLastCalledWith([{ board: null, id: 'each' }])
    expect(canvas().queryByText('On the root')).toBeNull()

    const view = render(
      <HatuaProvider ports={{ workflows: serving(NESTED) }} workflowId="wf_map">
        <FlowMap defaultBoardId="alpha" collapsed={[{ board: null, id: 'each' }]} />
      </HatuaProvider>,
    )
    const block = within(view.container.querySelector('[aria-label="Flow map"]') as HTMLElement)
    expect(await block.findByText('In the block')).toBeDefined()
  })
})
