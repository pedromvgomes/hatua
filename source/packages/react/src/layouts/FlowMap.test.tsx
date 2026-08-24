import { parseWorkflow } from '@hatua/document'
import { layout } from '@hatua/layout'
import { boardOf, nameOf, stepKey, walkSteps } from '@hatua/model'
import type { WorkflowDefinition } from '@hatua/schema'
import type { Cursor, DraftSession, EditToken, Lease, WorkflowStore } from '@hatua/services'
import { fireEvent, render, screen, within } from '@testing-library/react'
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

/** The name on every card drawn, in DOM order. */
const cardNames = () =>
  canvas()
    .getAllByRole('button')
    .filter((button) => !button.hasAttribute('aria-label'))
    .map((button) => button.firstElementChild?.textContent)

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

    const definition = definitionOf(SOURCE)
    const board = boardOf(definition, null)
    if (!board) throw new Error('the fixture lost its root Board')
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

  it('marks where a Fork’s Branches converge, and marks nothing else', async () => {
    mount()
    await canvas().findByText('Fetch mail')

    const marks = canvas().getAllByText(/come back together$/)
    expect(marks.map((mark) => mark.textContent)).toEqual([
      'The branches of How urgent? come back together',
    ])
  })

  it('shows a container’s summary and gives a leaf nothing to say about itself', async () => {
    // `heightOf` makes a card taller exactly when `isContainer`, so the summary
    // appears on exactly those cards. A leaf card is 64px — "a name and nothing
    // else" — and a summary on it would be 100px of content in it.
    mount()
    await canvas().findByText('Fetch mail')

    expect(canvas().getByText('core.fork · 2 branches')).toBeDefined()
    expect(canvas().queryByText('component.email.fetch')).toBeNull()
  })

  it('draws no connector between cards, because there is no edge to draw', async () => {
    // ADR-0013 refuses an attachable edge; a plain rule between two cards is
    // refused too, because the gap is what reads as a run of the flow. The only
    // mark that is not a card or a region frame is the join.
    mount()
    await canvas().findByText('Fetch mail')
    expect(canvas().queryByText(/connector/i)).toBeNull()
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
