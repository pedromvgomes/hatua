import { parseWorkflow } from '@hatua/document'
import { LAYOUT, layout } from '@hatua/layout'
import { boardOf, nameOf, stepKey, walkSteps } from '@hatua/model'
import type { Manifest, WorkflowDefinition } from '@hatua/schema'
import type {
  Cursor,
  DraftSession,
  EditCommand,
  EditingStore,
  EditToken,
  Lease,
  WorkflowStore,
} from '@hatua/services'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode, useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HatuaProvider, useEditingStore } from '../theme/HatuaProvider'
import { FlowMap } from './FlowMap'
import { ZOOM } from './viewport'

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

/** The clipped box the pan and the zoom are worked out against. */
const surface = () =>
  screen.getByRole('region', { name: 'Flow map' }).querySelector('[tabindex="-1"]') as HTMLElement

/** The canvas's tab strip, which is drawn only once a Block's Board is open. */
const tabs = () => canvas().getByRole('navigation', { name: 'Boards' })

/**
 * A `DataTransfer` jsdom does not implement.
 *
 * Only the methods a drag source and a drop target use, because that is the
 * whole of the platform surface this code touches — and a fuller fake would be
 * a second implementation of a browser API to check code that only ever asks it
 * a few questions.
 */
const transfer = (data: Record<string, string>, effectAllowed = 'none') => {
  const held = { ...data }
  const images: { element: HTMLElement; x: number; y: number }[] = []
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
    /** What the pointer will carry, which is the whole of the drop's feedback. */
    images,
    setDragImage: (element: HTMLElement, x: number, y: number) => {
      images.push({ element, x, y })
    },
  }
}

/** The name on every card drawn, in DOM order. */
// Scoped to the list of Steps, because a region's legend is a button too — it is
// the control that folds its column — and it is not a card.
const cardNames = () =>
  within(canvas().getByRole('list', { name: 'Steps' }))
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
    expect(canvas().getByText('attempt')).toBeDefined()
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

  it('marks every Step with two or more columns, and marks nothing else', async () => {
    // A Join is a Step's and not a Fork's, so a `core.try` gets one too — flow
    // resumes below it whether the body finished or the handler ran. A loop's
    // lone column gets none: there is nothing under it to converge.
    mount()
    await canvas().findByText('Fetch mail')

    const marks = canvas().getAllByText(/come back together$/)
    expect(marks.map((mark) => mark.textContent).sort()).toEqual([
      'The regions of How urgent? come back together',
      'The regions of Publish the digest come back together',
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
    // Every line on one Board is in one SVG, found by the title that names it:
    // it is not the only SVG on the canvas, and counting every `path` in the
    // region would count the toolbar's glyphs as connectors.
    const lines = [
      ...screen.getByRole('region', { name: 'Flow map' }).querySelectorAll('svg'),
    ].find((one) => one.querySelector('title')?.textContent === 'Flow')
    const paths = lines?.querySelectorAll('path') ?? []

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
    // guess: the two gestures do different things. It is not what tells the
    // user a drop will land — `move` draws no badge on macOS — which is what
    // the `over` state below is for.
    const carried = transfer({ 'application/x-hatua-component': '{"use":"a"}' }, 'copy')
    fireEvent.dragOver(gap, { dataTransfer: carried })
    expect(carried.dropEffect).toBe('copy')

    const moved = transfer({}, 'move')
    fireEvent.dragOver(gap, { dataTransfer: moved })
    expect(moved.dropEffect).toBe('move')
  })

  it('selects from anywhere on the card, not only from its name', async () => {
    // A card is a 236px target carrying an icon, a grip, a problem marker, a
    // meta row and its own padding. Only the name and verb answered a click, so
    // most of the card was dead to the one thing a card is mostly for.
    const chosen: string[] = []
    mount(SOURCE, {
      onSelect: (one) => chosen.push(one?.steps.join(',') ?? ''),
      onInsert: () => {},
    })
    await canvas().findByText('Fetch mail')

    const card = canvas().getByText('Fetch mail').closest('[draggable]') as HTMLElement
    const icon = card.querySelector('img, svg') as Element

    fireEvent.click(icon)
    expect(chosen).toEqual(['fetch'])

    // And once, not twice, when the name itself is clicked — two paths to one
    // command is a command that fires twice.
    fireEvent.click(canvas().getByText('Fetch mail'))
    expect(chosen).toEqual(['fetch', 'fetch'])
  })

  it('keeps Open and the chevron off the selection, because they are other commands', async () => {
    const chosen: string[] = []
    const folded: string[][] = []
    mount(SOURCE, {
      onSelect: (one) => chosen.push(one?.steps.join(',') ?? ''),
      onCollapseChange: (all) => folded.push(all.map((one) => one.id)),
      onInsert: () => {},
    })
    await canvas().findByText('Fetch mail')

    fireEvent.click(canvas().getByRole('button', { name: 'Collapse How urgent?' }))
    expect(folded).toEqual([['sort']])
    // Folding a Step is not selecting it.
    expect(chosen).toEqual([])
  })

  it('marks the card being dragged, so it is not read as still sitting there', async () => {
    // The card stays put until the drop lands, and a chip carrying its name
    // follows the pointer — two of the same Step on screen at once unless one
    // of them says it is on its way.
    mount(SOURCE, { onDropComponent: () => {}, onInsert: () => {} })
    await canvas().findByText('Fetch mail')

    const card = canvas().getByText('Fetch mail').closest('[draggable]') as HTMLElement
    const other = canvas().getByText('How urgent?').closest('[draggable]') as HTMLElement
    expect(card.className).not.toContain('dragging')

    fireEvent.dragStart(card, { dataTransfer: transfer({}, 'move') })
    expect(card.className).toContain('dragging')
    // The one in flight, and no other.
    expect(other.className).not.toContain('dragging')

    fireEvent.dragEnd(card, { dataTransfer: transfer({}, 'move') })
    expect(card.className).not.toContain('dragging')
  })

  it('carries a small chip rather than the card, which would cover the gap', async () => {
    // A drag ghost is the source element by default — a whole 236px card,
    // centred under the pointer — and the target is a 20px `+` on a line. The
    // ghost covers what the drag is aimed at, and the only pixels above it are
    // the cursor's own, which is why `copy` looked like the gesture that worked.
    mount(SOURCE, { onDropComponent: () => {}, onInsert: () => {} })
    await canvas().findByText('Fetch mail')

    const card = canvas().getByText('Fetch mail').closest('[draggable]') as HTMLElement
    const carried = transfer({}, 'move')
    fireEvent.dragStart(card, { dataTransfer: carried })

    const [image] = carried.images
    expect(image).toBeDefined()
    expect(image?.element.textContent).toBe('Fetch mail')
    expect(image?.element).not.toBe(card)
    // Negative, so the pointer sits outside the chip and never inside it.
    expect(image?.x).toBeLessThan(0)
    expect(image?.y).toBeLessThan(0)
  })

  it('takes the chip back out of the document, so a drag leaks no node', async () => {
    mount(SOURCE, { onDropComponent: () => {}, onInsert: () => {} })
    await canvas().findByText('Fetch mail')

    const card = canvas().getByText('Fetch mail').closest('[draggable]') as HTMLElement
    const carried = transfer({}, 'move')
    fireEvent.dragStart(card, { dataTransfer: carried })
    const chip = carried.images[0]?.element as HTMLElement

    // The browser rasterises the image during the event and never reads the
    // element again, so it comes out on the next frame.
    expect(chip.isConnected).toBe(true)
    await waitFor(() => expect(chip.isConnected).toBe(false))
  })

  it('marks the gap under the pointer apart from every other armed one', async () => {
    // Every gap goes `live` at once so a target does not have to be hunted for,
    // and that is exactly why one of them has to say the pointer is on IT.
    // `dropEffect: 'move'` draws no badge on macOS, so a Step dragged across the
    // canvas carries the same arrow over a gap as over dead space — without a
    // second state the drop is aimed at nine identical circles.
    mount(SOURCE, { onDropComponent: () => {}, onInsert: () => {} })
    await canvas().findByText('Fetch mail')

    const gap = slotFor('Insert a Step after Fetch mail')
    const other = slotFor('Insert a Step at the start of the workflow')
    const card = canvas().getByText('Fetch mail').closest('[draggable]') as HTMLElement
    fireEvent.dragStart(card, { dataTransfer: transfer({}, 'move') })

    expect(gap.className).toContain('live')
    expect(gap.className).not.toContain('over')

    fireEvent.dragOver(gap, { dataTransfer: transfer({}, 'move') })
    expect(gap.className).toContain('over')
    // The one under the pointer, and no other: a state every gap wears is the
    // state that was already there.
    expect(other.className).not.toContain('over')
  })

  it('draws a bar a card wide at the gap, so the chip cannot cover the signal', async () => {
    // The filled dot is 20px of ink under a chip wider than it is, and a signal
    // you have to move the pointer off to read is not a signal. A card's width,
    // from `LAYOUT`, because that is the footprint of the thing being dropped —
    // wide enough to reach past the chip, never wider than the narrowest column.
    mount(SOURCE, { onDropComponent: () => {}, onInsert: () => {} })
    await canvas().findByText('Fetch mail')

    const gap = slotFor('Insert a Step after Fetch mail')
    const bar = [...gap.children].find((child) => child.className.includes('bar')) as HTMLElement

    expect(bar).toBeDefined()
    expect(bar.style.inlineSize).toBe(`${LAYOUT.nodeWidth}px`)
    // Decoration: it widens what the eye sees and never what the pointer hits,
    // so two adjacent gaps cannot both be under the pointer.
    expect(bar.getAttribute('aria-hidden')).toBe('true')
  })

  it('keeps the gap marked while the pointer crosses the `+` inside it', async () => {
    // `dragleave` fires when the pointer moves onto a descendant, and clearing
    // on that flickers the one thing saying where the drop lands.
    mount(SOURCE, { onDropComponent: () => {}, onInsert: () => {} })
    await canvas().findByText('Fetch mail')

    const gap = slotFor('Insert a Step after Fetch mail')
    const plus = canvas().getByRole('button', { name: 'Insert a Step after Fetch mail' })
    const card = canvas().getByText('Fetch mail').closest('[draggable]') as HTMLElement
    fireEvent.dragStart(card, { dataTransfer: transfer({}, 'move') })
    fireEvent.dragOver(gap, { dataTransfer: transfer({}, 'move') })
    expect(gap.className).toContain('over')

    fireEvent(gap, new MouseEvent('dragleave', { bubbles: true, relatedTarget: plus }))
    expect(gap.className).toContain('over')

    fireEvent(gap, new MouseEvent('dragleave', { bubbles: true, relatedTarget: document.body }))
    expect(gap.className).not.toContain('over')
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
    // Named twice on purpose: the tab says which Board is in front, and the
    // root node says what this Board's contract is.
    expect(within(tabs()).getByText('Archive an entry')).toBeDefined()
    expect(canvas().queryByText('Fetch mail')).toBeNull()

    fireEvent.click(within(tabs()).getByRole('button', { name: 'The workflow' }))
    expect(onBoardChange).toHaveBeenLastCalledWith(null)
    expect(canvas().getByText('Fetch mail')).toBeDefined()
  })

  it('draws no tab strip while the root Board is the only one open', async () => {
    // A strip holding nothing but the root names the one Board the canvas can
    // draw, which is chrome saying what the map already is.
    mount()
    await canvas().findByText('Fetch mail')
    expect(canvas().queryByRole('navigation', { name: 'Boards' })).toBeNull()
  })

  /** One tab per Board and never per call site (ADR-0017). */
  it('brings an open Board forward rather than opening a second tab for it', async () => {
    mount(SOURCE)
    await canvas().findByText('Archive one')

    fireEvent.click(canvas().getByRole('button', { name: 'Open Archive one' }))
    fireEvent.click(within(tabs()).getByRole('button', { name: 'The workflow' }))
    fireEvent.click(canvas().getByRole('button', { name: 'Open Archive one' }))

    // The root and one Block, after visiting that Block twice.
    expect(within(tabs()).getAllByRole('listitem')).toHaveLength(2)
  })

  it('closes a Block tab and falls back to the root Board', async () => {
    const onBoardChange = vi.fn()
    mount(SOURCE, { onBoardChange })
    await canvas().findByText('Archive one')

    fireEvent.click(canvas().getByRole('button', { name: 'Open Archive one' }))
    expect(canvas().queryByText('Fetch mail')).toBeNull()

    fireEvent.click(within(tabs()).getByRole('button', { name: 'Close Archive an entry' }))
    expect(onBoardChange).toHaveBeenLastCalledWith(null)
    // Drawing the root again, and with nothing else open there is no strip left
    // to draw either.
    expect(canvas().getByText('Fetch mail')).toBeDefined()
    expect(canvas().queryByRole('navigation', { name: 'Boards' })).toBeNull()
  })

  /**
   * The root is the fallback because it is the one tab that is always there.
   * Closing a tab that is not in front is not a way to leave the Board that is.
   */
  it('leaves the Board on screen alone when a different tab is closed', async () => {
    mount(SOURCE)
    await canvas().findByText('Archive one')

    fireEvent.click(canvas().getByRole('button', { name: 'Open Archive one' }))
    fireEvent.click(within(tabs()).getByRole('button', { name: 'The workflow' }))
    fireEvent.click(canvas().getByRole('button', { name: 'Open Archive another' }))

    fireEvent.click(within(tabs()).getByRole('button', { name: 'Close Archive an entry' }))
    expect(canvas().getByText('Beta returns')).toBeDefined()
    expect(within(tabs()).getAllByRole('listitem')).toHaveLength(2)
  })

  /**
   * A controlled caller names the Board, and the strip is the only way off it.
   * Seeded from `openBoard` alone, a Host that sets `boardId` itself strands
   * the user on a Block's Board with no navigation at all.
   */
  it('opens a tab for a Board the caller names, not only one it opened itself', async () => {
    mount(SOURCE, { boardId: 'alpha' })
    await canvas().findByText('Alpha returns')

    expect(within(tabs()).getAllByRole('listitem')).toHaveLength(2)
    expect(within(tabs()).getByRole('button', { name: 'The workflow' })).toBeDefined()
  })

  /**
   * Closing a tab drops its viewport with it, so re-opening the Board fits to
   * it rather than restoring a pan made before it was closed — the fit only
   * runs where there is no entry.
   */
  it("drops a closed Board's viewport, so re-opening it fits again", async () => {
    const onViewportChange = vi.fn()
    mount(SOURCE, { onViewportChange })
    await canvas().findByText('Archive one')

    fireEvent.click(canvas().getByRole('button', { name: 'Open Archive one' }))
    const placed = onViewportChange.mock.lastCall?.[0]

    // A pixel-mode wheel pans by its deltas whatever the box measures, which is
    // what makes this reachable at all without a layout engine.
    fireEvent.wheel(surface(), { deltaX: 120, deltaY: 80, deltaMode: 0 })
    expect(onViewportChange.mock.lastCall?.[0]).not.toEqual(placed)

    fireEvent.click(within(tabs()).getByRole('button', { name: 'Close Archive an entry' }))
    fireEvent.click(canvas().getByRole('button', { name: 'Open Archive one' }))

    // Placed again, rather than restored to a pan made before it was closed.
    expect(onViewportChange).toHaveBeenLastCalledWith(placed)
  })

  /**
   * Falling back in `board` alone leaves `wanted` naming the deleted Block, so
   * the viewport stays keyed to a dead Board and a caller holding which Board
   * is open still holds the one that is gone.
   */
  it('reports moving back to the root when the open Block is not there', async () => {
    const onBoardChange = vi.fn()
    mount(SOURCE, { defaultBoardId: 'nowhere', onBoardChange })
    await canvas().findByText('Fetch mail')

    expect(onBoardChange).toHaveBeenCalledWith(null)
  })

  /*
   * The latch that stops the fallback re-reporting is about a Board that is
   * gone, and a Board that is back is a different fact. Held across the return,
   * the SECOND deletion of the same Block is silent: `wanted` goes on naming a
   * Board that is not there, the viewport is written into an entry nothing
   * reads, and a controlled caller keeps the stale id.
   */
  it('reports the fallback again when the same Block is deleted a second time', async () => {
    const onBoardChange = vi.fn()
    let store: EditingStore | undefined
    const WITH_ALPHA = `id: wf_map\nname: n\nversion: 1\nstatus: draft\nsteps:\n  - id: call\n    use: block.alpha\n    name: "Call alpha"\n    with: {}\nblocks:\n  - id: alpha\n    name: "Alpha"\n    steps:\n      - id: deep\n        use: component.email.send\n        name: "Deep"\n`

    render(
      <HatuaProvider ports={{ workflows: serving(WITH_ALPHA) }} workflowId="wf_map">
        <Probe onStore={(one) => (store = one)} />
        <FlowMap onBoardChange={onBoardChange} />
      </HatuaProvider>,
    )
    await canvas().findByText('Call alpha')

    const drop: EditCommand = {
      label: 'Drop alpha',
      apply: (document) => {
        document.ast.delete('blocks')
      },
    }

    const openAlpha = () =>
      fireEvent.click(canvas().getByRole('button', { name: 'Open Call alpha' }))

    openAlpha()
    expect(onBoardChange).toHaveBeenLastCalledWith('alpha')

    onBoardChange.mockClear()
    act(() => store?.apply(drop))
    expect(onBoardChange).toHaveBeenCalledWith(null)

    // Back, walked into again, and taken away again. The latch is about a Board
    // that is gone, so a Board that returned has to release it.
    act(() => store?.undo())
    await canvas().findByText('Call alpha')
    openAlpha()
    expect(onBoardChange).toHaveBeenLastCalledWith('alpha')

    onBoardChange.mockClear()
    act(() => store?.apply(drop))

    expect(onBoardChange).toHaveBeenCalledWith(null)
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
    expect(canvas().queryByRole('navigation', { name: 'Boards' })).toBeNull()
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
    expect(onSelect).toHaveBeenLastCalledWith({ board: 'alpha', steps: ['ret'] })

    // The same id on the other Board, and the selection does not follow it.
    const view = render(
      <HatuaProvider ports={{ workflows: serving(SOURCE) }} workflowId="wf_map">
        <FlowMap defaultBoardId="beta" selected={{ board: 'alpha', steps: ['ret'] }} />
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

  it('folds one column from its legend, leaving the Step and its siblings drawn', async () => {
    // Two different reliefs. The card's chevron folds a Step and its Nest is not
    // drawn at all; a legend folds one column and its siblings stay on screen.
    const onCollapsedRegionsChange = vi.fn()
    mount(SOURCE, { onCollapsedRegionsChange })
    await canvas().findByText('Fetch mail')

    fireEvent.click(canvas().getByRole('button', { name: /on failure/ }))
    expect(onCollapsedRegionsChange).toHaveBeenLastCalledWith([
      { board: null, id: 'guarded', kind: 'handler' },
    ])

    expect(canvas().queryByText('Shelve it')).toBeNull()
    expect(canvas().getByText('Triage')).toBeDefined()
    // The frame stays: a folded column is a box, not an absence.
    expect(canvas().getByRole('button', { name: /on failure/ })).toBeDefined()
  })

  it('fades the lines in on a fold, because a path’s `d` cannot tween with the boxes', async () => {
    // At full strength the lines point at boxes still gliding toward them — by
    // the whole fold distance at the start of it. Folds alone: an ordinary
    // re-render must not make the lines blink.
    mount()
    await canvas().findByText('Fetch mail')
    const svg = () => canvas().getByTitle('Flow').parentElement as Element

    expect(svg().getAttribute('class')).not.toContain('redrawn')
    fireEvent.click(canvas().getByRole('button', { name: /on failure/ }))
    expect(svg().getAttribute('class')).toContain('redrawn')
  })

  it('tells a folded column from an empty one, which are the same box', async () => {
    // They mean opposite things — one is somewhere to add a Step, the other is
    // Steps out of sight — and the rect alone does not separate them.
    mount(SOURCE, { collapsedRegions: [{ board: null, id: 'guarded', kind: 'handler' }] })
    await canvas().findByText('Fetch mail')

    const legend = canvas().getByRole('button', { name: /on failure/ })
    expect(legend.getAttribute('aria-expanded')).toBe('false')
    expect(canvas().getByText('1 step')).toBeDefined()
  })

  it('dashes a column only where it has a solid sibling to be read against', async () => {
    // A try's body always starts, so it is solid; its handler needs a failure,
    // so it is dashed — and that pair is the whole of what separates a try from
    // a two-Branch Fork. A lone loop body has no sibling, and dashed already
    // means *placeholder* here, so it stays solid (ADR-0015).
    mount()
    await canvas().findByText('Fetch mail')

    // A predicate rather than a regex built from the argument: the legend is
    // matched by substring, which is what the callers below mean, and it avoids
    // treating a caller's word as a pattern.
    const frameOf = (word: string) =>
      canvas().getByRole('button', { name: (name) => name.includes(word) })
        .parentElement as HTMLElement

    expect(frameOf('attempt').className).not.toContain('dashed')
    expect(frameOf('on failure').className).toContain('dashed')
    expect(frameOf('if').className).toContain('dashed')
  })

  it('leaves a lone loop body solid, though it may never run', async () => {
    // `alwaysReturns` draws the same line at a `core.for_each` — its list may be
    // empty — but the rule is scoped to sibling columns. With nothing beside it,
    // a dash would read as *unfinished* rather than as *conditional*.
    mount(NESTED)
    await canvas().findByText('Each message')

    const frame = canvas().getByRole('button', { name: /loop/ }).parentElement as HTMLElement
    expect(frame.className).not.toContain('dashed')
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

/**
 * The canvas pans and zooms, and the viewport is chrome (ADR-0016).
 *
 * jsdom has no layout engine, so every box here is 0x0 unless a test says
 * otherwise. The arithmetic is checked in `viewport.test.ts` over plain
 * numbers; what is checked here is which gesture reaches which function, and
 * where the answer lands on screen.
 */
/** A document with no `id` is not a Workflow Definition, so nothing projects. */
const unnamed: EditCommand = {
  label: 'unname the workflow',
  apply: (document) => {
    document.ast.delete('id')
  },
}

/** Hands the test the editing store the provider built, to edit the document with. */
function Probe({ onStore }: { onStore: (store: EditingStore) => void }) {
  const store = useEditingStore()
  useEffect(() => {
    if (store) onStore(store)
  }, [store, onStore])
  return null
}

describe('FlowMap, panning and zooming', () => {
  /** The box that carries the pan and the zoom: the one the cards are laid on. */
  const surfaceOf = () => {
    const cards = canvas().getByRole('list', { name: 'Steps' })
    const surface = cards.parentElement
    if (!surface) throw new Error('the canvas drew no surface')
    return surface
  }

  /** A box with a size, for the measurements a canvas cannot take in jsdom. */
  const measuring = (element: Element, rect: Partial<DOMRect>) => {
    const full = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, ...rect }
    element.getBoundingClientRect = () => ({ ...full, toJSON: () => full }) as DOMRect
  }

  it('opens where the caller said, and says where it went', async () => {
    const onViewportChange = vi.fn()
    mount(SOURCE, { defaultViewport: { x: 40, y: -60, scale: 1.5 }, onViewportChange })
    await canvas().findByText('Fetch mail')

    expect(surfaceOf().style.transform).toBe('translate(40px, -60px) scale(1.5)')
    expect(onViewportChange).toHaveBeenCalledWith({ x: 40, y: -60, scale: 1.5 })
  })

  it('zooms from the toolbar and reports every move', async () => {
    const onViewportChange = vi.fn()
    mount(SOURCE, { defaultViewport: { x: 0, y: 0, scale: 1 }, onViewportChange })
    await canvas().findByText('Fetch mail')

    fireEvent.click(canvas().getByRole('button', { name: 'Zoom in' }))
    expect(
      canvas().getByRole('button', { name: `Zoom level: ${Math.round(ZOOM.step * 100)}%` }),
    ).toBeDefined()

    // Absolute, not a step from wherever the presses left it: the menu is the
    // way back to a known state after free-form zooming.
    fireEvent.click(canvas().getByRole('button', { name: /^Zoom level/ }))
    fireEvent.click(canvas().getByRole('button', { name: '200%' }))
    expect(surfaceOf().style.transform).toContain('scale(2)')
    expect(onViewportChange).toHaveBeenLastCalledWith(expect.objectContaining({ scale: 2 }))
  })

  /*
   * A Host mounting Hatua inside a hidden tab panel measures 0×0, and this is
   * placed once per Board — so a pan worked out against a width of nothing
   * would be permanent, with only Fit to recover it. Kept as the best answer
   * available and redone the first time a real measurement arrives.
   */
  it('re-places an opening view that was worked out against a box with no size', async () => {
    mount()
    await canvas().findByText('Fetch mail')

    // What jsdom measures, and what a display:none panel measures too:
    // `openingView` centres the root against a width of nothing.
    const provisional = surfaceOf().style.transform

    const region = screen.getByRole('region', { name: 'Flow map' })
    measuring(region.firstElementChild as HTMLElement, {
      width: 900,
      height: 600,
      right: 900,
      bottom: 600,
    })

    /*
     * A render that moves nothing itself — selecting a card — so what changes
     * is the placement and not the gesture. The map is rebuilt on every render,
     * so the effect is already running whenever anything moves.
     */
    fireEvent.click(canvas().getByText('Fetch mail'))

    // Centred against 900 rather than against 0: exactly half the box further
    // along, and the same y.
    const before = Number(/translate\((-?[\d.]+)px/.exec(provisional)?.[1])
    const after = Number(/translate\((-?[\d.]+)px/.exec(surfaceOf().style.transform)?.[1])
    expect(after).toBe(before + 450)
  })

  /*
   * The flag is per Board, because the viewports are. One canvas draws every
   * tab in turn, so a single flag is cleared by whichever Board is placed
   * against a real box — and a Board still holding a 0×0 placement is then
   * indistinguishable from one a caller supplied. It would stay pinned where a
   * width of nothing put it, with only Fit to recover it.
   */
  it('re-places each Board that was placed against no box, not just the last one', async () => {
    mount()
    await canvas().findByText('Archive one')

    // Both Boards placed while the canvas measures 0×0, the root first.
    const rootAtNoWidth = surfaceOf().style.transform
    fireEvent.click(canvas().getByRole('button', { name: 'Open Archive one' }))
    await canvas().findByText('Alpha returns')

    const region = screen.getByRole('region', { name: 'Flow map' })
    measuring(region.firstElementChild as HTMLElement, {
      width: 900,
      height: 600,
      right: 900,
      bottom: 600,
    })

    // A render that moves nothing itself, so the Block's Board is re-placed.
    fireEvent.click(canvas().getByText('Alpha returns'))
    const blockPlaced = surfaceOf().style.transform

    // Back to the root, whose placement is still the one made against nothing.
    fireEvent.click(within(tabs()).getByRole('button', { name: 'The workflow' }))
    await canvas().findByText('Archive one')

    const before = Number(/translate\((-?[\d.]+)px/.exec(rootAtNoWidth)?.[1])
    const after = Number(/translate\((-?[\d.]+)px/.exec(surfaceOf().style.transform)?.[1])
    expect(blockPlaced).not.toBe(rootAtNoWidth)
    // Centred against 900 rather than against 0: half the box further along.
    expect(after).toBe(before + 450)
  })

  it('leaves a viewport the caller supplied alone, however the canvas measures', async () => {
    mount(SOURCE, { defaultViewport: { x: 40, y: -60, scale: 1 } })
    await canvas().findByText('Fetch mail')

    const region = screen.getByRole('region', { name: 'Flow map' })
    measuring(region.firstElementChild as HTMLElement, {
      width: 900,
      height: 600,
      right: 900,
      bottom: 600,
    })
    fireEvent.click(canvas().getByRole('button', { name: 'Zoom in' }))

    // Zoomed about the centre, but never re-placed: 40/-60 was not a guess this
    // region made against a box it could not measure.
    expect(surfaceOf().style.transform).not.toContain('translate(0px,')
  })

  it('pans until a focused card is on screen, which no scroll container is left to do', async () => {
    mount(SOURCE, { defaultViewport: { x: 0, y: 0, scale: 1 } })
    const card = await canvas().findByText('Fetch mail')

    const region = screen.getByRole('region', { name: 'Flow map' })
    const frame = region.firstElementChild as HTMLElement
    measuring(frame, { width: 800, height: 600, right: 800, bottom: 600 })
    const target = card.closest('li') as HTMLElement
    // Off the bottom edge of the canvas, which is where tabbing down a large
    // map lands long before the last Step.
    measuring(target, { top: 900, bottom: 960, left: 100, right: 400 })

    fireEvent.focus(target, { bubbles: true })

    // Far enough that its lower edge clears the margin, and no further.
    expect(surfaceOf().style.transform).toBe('translate(0px, -384px) scale(1)')
  })

  /*
   * `undefined` means uncontrolled and `null` means nothing selected, which is
   * what makes `onSelect`'s documented clear performable at all: read with a
   * `??`, a caller clearing is indistinguishable from one that never had an
   * opinion, and the canvas falls back to the card it last selected itself.
   */
  it('clears the selection when the caller says nothing is selected', async () => {
    // One ports object across both renders: <HatuaProvider> keys the store on
    // what it is handed, so a fresh `serving()` would reopen the document and
    // the canvas would be empty at the assertion rather than cleared.
    const ports = { workflows: serving(SOURCE) }
    const highlighted = () =>
      canvas()
        .getAllByRole('button')
        .find((button) => button.getAttribute('aria-current') === 'true')?.firstElementChild
        ?.textContent

    const { rerender } = render(
      <HatuaProvider ports={ports} workflowId="wf_map">
        <FlowMap selected={{ board: null, steps: ['fetch'] }} />
      </HatuaProvider>,
    )
    await canvas().findByText('Fetch mail')
    expect(highlighted()).toBe('Fetch mail')

    /*
     * A press the caller ignores, which is what leaves this region holding a
     * selection of its own. Without it the fallback has nothing to fall back
     * TO, and a `??` clears by accident — so the clear below would pass against
     * the defect it exists to catch.
     */
    fireEvent.click(canvas().getByText('How urgent?'))
    // The highlight does not move, because the caller is the one saying what is
    // selected — but this region is now holding a selection of its own, which
    // is exactly what a `??` falls back to when the caller clears.
    expect(highlighted()).toBe('Fetch mail')

    rerender(
      <HatuaProvider ports={ports} workflowId="wf_map">
        <FlowMap selected={null} />
      </HatuaProvider>,
    )
    expect(highlighted()).toBeUndefined()
  })

  it('keeps its own selection when the caller has no opinion at all', async () => {
    mount()
    fireEvent.click(await canvas().findByText('Fetch mail'))

    expect(
      canvas()
        .getAllByRole('button')
        .find((button) => button.getAttribute('aria-current') === 'true')?.firstElementChild
        ?.textContent,
    ).toBe('Fetch mail')
  })

  it('does not pan for its own chrome, which sits inside the margin and never moves', async () => {
    mount(SOURCE, { defaultViewport: { x: 0, y: 0, scale: 1 } })
    await canvas().findByText('Fetch mail')

    const region = screen.getByRole('region', { name: 'Flow map' })
    const frame = region.firstElementChild as HTMLElement
    measuring(frame, { width: 800, height: 600, right: 800, bottom: 600 })
    const toolbar = canvas().getByRole('button', { name: 'Zoom in' })
    // The toolbar floats closer to the frame's edge than the margin a pan aims
    // for, so panning to it would shift the map on every press — and it never
    // moves, so the next press would shift it again.
    measuring(toolbar, { top: 570, bottom: 596, left: 740, right: 766 })

    fireEvent.focus(toolbar, { bubbles: true })

    expect(surfaceOf().style.transform).toBe('translate(0px, 0px) scale(1)')
  })

  it('hands focus to the canvas after a pointer press, because the canvas pans on space', async () => {
    mount(SOURCE, { defaultViewport: { x: 0, y: 0, scale: 1 } })
    await canvas().findByText('Fetch mail')

    const frame = screen.getByRole('region', { name: 'Flow map' }).firstElementChild
    const zoomIn = canvas().getByRole('button', { name: 'Zoom in' })
    zoomIn.focus()
    // A browser leaves a clicked control focused, and a focused button owns the
    // space bar — so the press after a zoom repeats it instead of arming a pan.
    // The canvas and not nowhere, so the next Tab carries on from the map.
    fireEvent.click(zoomIn, { detail: 1 })
    expect(document.activeElement).toBe(frame)
  })

  it('leaves focus where a keyboard put it, which is the only thing saying where the user is', async () => {
    mount(SOURCE, { defaultViewport: { x: 0, y: 0, scale: 1 } })
    await canvas().findByText('Fetch mail')

    const zoomIn = canvas().getByRole('button', { name: 'Zoom in' })
    zoomIn.focus()
    // `detail` is 0 when a keyboard activated the control.
    fireEvent.click(zoomIn, { detail: 0 })
    expect(document.activeElement).toBe(zoomIn)
  })

  /*
   * The canvas keeps its map AND its pan, because the edit never lands.
   *
   * `EditingStore.apply` refuses a command that would turn a document that
   * projects into one that does not: every surface reads `definition`, so such
   * a command would empty the canvas, the side panel and the step editor at
   * once and leave nobody anything to click on to undo it. This is that
   * guarantee seen from the canvas — the region a user is looking at when a
   * name box commits.
   */
  it('does not lose the map to a command that would stop the document projecting', async () => {
    let store: EditingStore | undefined
    render(
      <HatuaProvider ports={{ workflows: serving(SOURCE) }} workflowId="wf_map">
        <Probe onStore={(one) => (store = one)} />
        <FlowMap defaultViewport={{ x: 40, y: -60, scale: 1.5 }} />
      </HatuaProvider>,
    )
    await canvas().findByText('Fetch mail')
    fireEvent.click(canvas().getByRole('button', { name: 'Zoom in' }))
    const moved = surfaceOf().style.transform

    act(() => store?.apply(unnamed))

    expect(canvas().queryByText(/not a valid Workflow Definition yet/)).toBeNull()
    expect(canvas().getByText('Fetch mail')).toBeDefined()
    expect(surfaceOf().style.transform).toBe(moved)
  })

  /*
   * The screen that IS reachable: a Host whose stored file does not project.
   * ADR-0001 makes the text the source of truth, so a hand-edited Workflow
   * Definition opens and is held rather than refused — there is simply no tree
   * to lay out, and the canvas says so instead of drawing an empty map.
   */
  it('says so, rather than drawing nothing, when the Host’s document does not project', async () => {
    const HALF =
      'id: wf_map\nname: n\nversion: 1\nstatus: draft\nsteps:\n  - use: component.email.send\n'
    render(
      <HatuaProvider ports={{ workflows: serving(HALF) }} workflowId="wf_map">
        <FlowMap />
      </HatuaProvider>,
    )

    expect(await canvas().findByText(/not a valid Workflow Definition yet/)).toBeDefined()
    expect(canvas().queryByRole('button', { name: /Insert a Step/ })).toBeNull()
  })

  it('reads defaultViewport once even where React renders twice', async () => {
    // Every Host in development mounts under StrictMode, which double-invokes
    // the component body and keeps the second result. A default consumed in a
    // render is a default consumed in the pass React throws away.
    render(
      <StrictMode>
        <HatuaProvider ports={{ workflows: serving(SOURCE) }} workflowId="wf_map">
          <FlowMap defaultViewport={{ x: 40, y: -60, scale: 1.5 }} />
        </HatuaProvider>
      </StrictMode>,
    )
    await canvas().findByText('Fetch mail')

    expect(surfaceOf().style.transform).toBe('translate(40px, -60px) scale(1.5)')
  })

  it('consumes every space keydown while a pan is held, not only the first', async () => {
    mount(SOURCE, { defaultViewport: { x: 0, y: 0, scale: 1 } })
    await canvas().findByText('Fetch mail')

    const frame = screen.getByRole('region', { name: 'Flow map' }).firstElementChild as HTMLElement
    frame.focus()

    const held = (repeat: boolean) => {
      const event = new KeyboardEvent('keydown', {
        key: ' ',
        repeat,
        bubbles: true,
        cancelable: true,
      })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }

    expect(held(false)).toBe(true)
    // The browser starts repeating about half a second in, which is well inside
    // one drag. A repeat that reaches the document scrolls the Host's page out
    // from under the gesture.
    expect(held(true)).toBe(true)
  })

  it('re-centres when a Block’s Board is opened, because the coordinates are Board-local', async () => {
    mount(SOURCE, { defaultViewport: { x: 40, y: -60, scale: 1.5 } })
    await canvas().findByText('Archive one')
    expect(surfaceOf().style.transform).toBe('translate(40px, -60px) scale(1.5)')

    const [open] = canvas().getAllByRole('button', { name: /^Open / })
    if (!open) throw new Error('the fixture lost its call sites')
    fireEvent.click(open)
    await canvas().findByText('Alpha returns')

    // Read once means once: a Board opened later is placed by the canvas, not
    // by a prop the caller handed it for the Board it opened on.
    expect(surfaceOf().style.transform).not.toContain('scale(1.5)')
  })
})

/**
 * The working set the tab strip draws (ADR-0017).
 */
describe('the Boards a tab strip holds open', () => {
  /*
   * A Board opened by a CALLER joins the working set, exactly as one opened by
   * pressing a doorway does.
   *
   * `views/Build` sets the Board directly when a Block is declared — the tab is
   * what says the Block exists — so a Board that only ever arrived through
   * `boardId` and never through `openBoard` would be dropped from the set the
   * moment the user went back to the root, taking away the only way back to it.
   * A working set that forgets what is in hand is the one thing the strip is
   * there for (ADR-0017).
   */
  it('keeps a Board opened through the boardId prop in the working set', async () => {
    const ports = { workflows: serving(SOURCE) }
    const { rerender } = render(
      <HatuaProvider ports={ports} workflowId="wf_map">
        <FlowMap boardId={null} />
      </HatuaProvider>,
    )
    await canvas().findByText('Fetch mail')

    rerender(
      <HatuaProvider ports={ports} workflowId="wf_map">
        <FlowMap boardId="alpha" />
      </HatuaProvider>,
    )
    await canvas().findByText('Alpha returns')

    rerender(
      <HatuaProvider ports={ports} workflowId="wf_map">
        <FlowMap boardId={null} />
      </HatuaProvider>,
    )
    await canvas().findByText('Fetch mail')

    // Back on the root, and the Block's tab is still in hand.
    expect(within(tabs()).getByRole('button', { name: 'Archive an entry' })).toBeTruthy()
  })
})

/**
 * A selection is a **Segment** — contiguous sibling Steps in one region — and
 * it is one by construction: no gesture here builds anything else, so nothing
 * downstream has to ask whether a selection is extractable (ADR-0020).
 */
describe('a selection is a Segment', () => {
  /** Every card drawn as selected, by name, in document order. */
  const chosen = () =>
    canvas()
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-current') === 'true')
      .map((button) => button.firstElementChild?.textContent)

  /** The card whose name is this, as the click target the whole card is. */
  const cardOf = (name: string) => canvas().getByText(name).closest('[draggable]') as HTMLElement

  /*
   * The element a key actually arrives on: a card's name is a `<button>` and
   * that is what holds focus once a Step is selected. Firing at the card
   * instead would miss every guard that asks what the target is.
   */
  const focusedIn = (name: string) => canvas().getByText(name).closest('button') as HTMLElement

  it('extends from the anchor to a shift-clicked sibling', async () => {
    mount()
    await canvas().findByText('Fetch mail')

    fireEvent.click(cardOf('Fetch mail'))
    expect(chosen()).toEqual(['Fetch mail'])

    fireEvent.click(cardOf('Archive one'), { shiftKey: true })
    // Every sibling between the two ends, and not only the two that were
    // clicked: `sort` sits between them on the root list.
    expect(chosen()).toEqual(['Fetch mail', 'How urgent?', 'Archive one'])
  })

  it('says the same thing when the selection is extended upwards', async () => {
    mount()
    await canvas().findByText('Fetch mail')

    fireEvent.click(cardOf('Archive one'))
    fireEvent.click(cardOf('Fetch mail'), { shiftKey: true })
    expect(chosen()).toEqual(['Fetch mail', 'How urgent?', 'Archive one'])
  })

  /*
   * The property the whole decision rests on. A Segment cannot span two
   * regions, so shift-clicking into one does what a plain click does rather
   * than building a selection extraction would have to refuse — and rather than
   * doing nothing, which reads as a fault.
   */
  it('selects alone, rather than reaching, when the shift-click is in another region', async () => {
    mount()
    await canvas().findByText('Fetch mail')

    fireEvent.click(cardOf('Fetch mail'))
    fireEvent.click(cardOf('Triage'), { shiftKey: true })
    expect(chosen()).toEqual(['Triage'])

    // And it became the anchor, so extending from it reaches within ITS region.
    fireEvent.click(cardOf('Triage'), { shiftKey: true })
    expect(chosen()).toEqual(['Triage'])
  })

  it('never reaches across a Fork’s sibling regions', async () => {
    mount()
    await canvas().findByText('Fetch mail')

    fireEvent.click(cardOf('Triage'))
    // `shelve` is the handler beside `triage`'s body — a sibling region, not a
    // sibling Step (ADR-0015).
    fireEvent.click(cardOf('Shelve it'), { shiftKey: true })
    expect(chosen()).toEqual(['Shelve it'])
  })

  it('grows with Shift+ArrowDown and shrinks from the other end', async () => {
    mount()
    await canvas().findByText('Fetch mail')
    const card = cardOf('Fetch mail')

    fireEvent.click(card)
    fireEvent.keyDown(focusedIn('Fetch mail'), { key: 'ArrowDown', shiftKey: true })
    expect(chosen()).toEqual(['Fetch mail', 'How urgent?'])

    /*
     * The anchor stays and the head moves, so one keystroke undoes the last.
     * Picking an end by the direction of the key instead walks off the top of a
     * Segment grown downwards and leaves it where it was.
     */
    fireEvent.keyDown(focusedIn('Fetch mail'), { key: 'ArrowUp', shiftKey: true })
    expect(chosen()).toEqual(['Fetch mail'])
  })

  it('stops at the end of the sibling list rather than leaving the region', async () => {
    mount()
    await canvas().findByText('Fetch mail')
    const card = cardOf('Triage')

    fireEvent.click(card)
    // `triage` is alone in the body it sits in, so there is nowhere to extend.
    fireEvent.keyDown(focusedIn('Triage'), { key: 'ArrowDown', shiftKey: true })
    expect(chosen()).toEqual(['Triage'])
  })

  it('leaves a bare arrow to the Host, which is a guest’s manners', async () => {
    mount()
    await canvas().findByText('Fetch mail')
    const card = cardOf('Fetch mail')

    fireEvent.click(card)
    fireEvent.keyDown(focusedIn('Fetch mail'), { key: 'ArrowDown' })
    expect(chosen()).toEqual(['Fetch mail'])
  })

  it('clears on Escape, and says so', async () => {
    const onSelect = vi.fn()
    mount(SOURCE, { onSelect })
    await canvas().findByText('Fetch mail')
    const card = cardOf('Fetch mail')

    fireEvent.click(card)
    expect(chosen()).toEqual(['Fetch mail'])

    fireEvent.keyDown(focusedIn('Fetch mail'), { key: 'Escape' })
    expect(chosen()).toEqual([])
    // Told, not merely forgotten: a caller holding the Segment would otherwise
    // keep handing back Steps nobody has selected.
    expect(onSelect).toHaveBeenLastCalledWith(undefined)
  })
})

/**
 * The bar of actions over the selection: what it says, and what Remove does.
 */
describe('the selection action bar', () => {
  const cardOf = (name: string) => canvas().getByText(name).closest('[draggable]') as HTMLElement
  /** The bar, found by the one line only it draws. */
  const bar = () => screen.queryByText(/steps? selected$/)?.parentElement ?? null

  it('is absent until something is selected', async () => {
    mount()
    await canvas().findByText('Fetch mail')
    expect(bar()).toBeNull()
  })

  /* A Segment of one is a Segment (ADR-0018), and the canvas has no other way
     to remove a Step. */
  it('appears for a single Step, counted in the singular', async () => {
    mount()
    await canvas().findByText('Fetch mail')
    fireEvent.click(cardOf('Fetch mail'))
    expect(screen.getByText('1 step selected')).toBeTruthy()
  })

  it('counts what the selection holds', async () => {
    mount()
    await canvas().findByText('Fetch mail')
    fireEvent.click(cardOf('Fetch mail'))
    fireEvent.click(cardOf('Archive one'), { shiftKey: true })
    expect(screen.getByText('3 steps selected')).toBeTruthy()
  })

  it('reserves extraction’s place rather than drawing a control with nothing behind it', async () => {
    mount()
    await canvas().findByText('Fetch mail')
    fireEvent.click(cardOf('Fetch mail'))
    expect(within(bar() as HTMLElement).queryByRole('button', { name: /block/i })).toBeNull()
  })

  it('removes every Step in the selection, and clears', async () => {
    mount()
    await canvas().findByText('Fetch mail')

    fireEvent.click(cardOf('Fetch mail'))
    fireEvent.click(cardOf('How urgent?'), { shiftKey: true })
    fireEvent.click(within(bar() as HTMLElement).getByRole('button', { name: /^Remove/ }))

    await waitFor(() => expect(canvas().queryByText('Fetch mail')).toBeNull())
    expect(canvas().queryByText('How urgent?')).toBeNull()
    // A container takes its regions with it, which is `removeStep`'s contract.
    expect(canvas().queryByText('Triage')).toBeNull()
    expect(canvas().getByText('Archive one')).toBeTruthy()
    expect(bar()).toBeNull()
  })

  /*
   * A selection names the Board it is on, so it means nothing on any other —
   * and the bar acts on what it counts. Counted against the held Segment rather
   * than the Board being drawn, walking through a doorway leaves the bar
   * reporting Steps that are not on screen and Remove deleting them.
   */
  it('says nothing about a selection held on a Board that is not on screen', async () => {
    mount()
    await canvas().findByText('Fetch mail')

    fireEvent.click(cardOf('Fetch mail'))
    fireEvent.click(cardOf('How urgent?'), { shiftKey: true })
    expect(screen.getByText('2 steps selected')).toBeTruthy()

    const [open] = canvas().getAllByRole('button', { name: /^Open / })
    if (!open) throw new Error('the fixture lost its call sites')
    fireEvent.click(open)
    await canvas().findByText('Alpha returns')

    expect(bar()).toBeNull()
  })
})
