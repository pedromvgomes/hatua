import type { Manifest } from '@hatua/schema'
import type { DraftSession, EditToken, Lease, WorkflowStore } from '@hatua/services'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentPropsWithRef } from 'react'
import { describe, expect, it } from 'vitest'
import { HatuaProvider } from '../theme/HatuaProvider'
import { Build, type BuildProps } from './Build'

/** True only when A and B are the same type — not merely assignable. */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/**
 * <Build> is the convenience half of the contract: everything it does, a Host
 * could do by hand with the same exports. So what is worth asserting is that it
 * arranges the regions and adds nothing a Host would have to reproduce.
 */
describe('Build', () => {
  it('arranges the toolbar, the side panel, the canvas and the step editor', () => {
    render(<Build />)
    expect(screen.getByRole('region', { name: 'Toolbar' })).toBeDefined()
    expect(screen.getByRole('tablist')).toBeDefined()
    expect(screen.getByRole('region', { name: 'Flow map' })).toBeDefined()
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeDefined()
  })

  /*
   * The regression this exists for: <FlowMap> was mounted as the "Flow" tab, so
   * the canvas was on screen only while one of three tabs was open and never
   * beside the panel it is edited from. The screen had no room for a canvas at
   * all. It has a column of its own now, and it is not a tab.
   */
  it('gives the canvas a place of its own, outside the tab strip', () => {
    render(<Build />)

    const canvas = screen.getByRole('region', { name: 'Flow map' })
    expect(screen.getByRole('tabpanel').contains(canvas)).toBe(false)

    // Still there with a different tab open, which is the whole point.
    fireEvent.click(screen.getByRole('tab', { name: 'Components' }))
    expect(screen.getByRole('region', { name: 'Flow map' })).toBeDefined()
  })

  it('offers the two tabs the design names, and no Flow tab', () => {
    // "The canvas is how a workflow is built." The side panel is the catalogue
    // a Step is chosen from and everything scoped to the workflow; the tree is
    // on the canvas, where the insert points and the doorway are.
    render(<Build />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Workflow',
      'Components',
    ])
    // Components is the tab that opens, whichever end of the strip it sits at:
    // this view is the designer, and the catalogue is what a Step comes from.
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Components')
    // <StepList> is a real region a Host may mount — this view does not.
    expect(screen.queryByRole('region', { name: 'Steps' })).toBeNull()
  })

  it('mounts only the open tab, so the other costs nothing until asked for', () => {
    render(<Build />)
    expect(screen.getByRole('region', { name: 'Components' })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Workflow' })).toBeNull()
  })

  it('claims neither the page banner nor its <h1>, wherever a Host puts it', () => {
    render(<Build />)
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('renders without a provider above it, like any other part', () => {
    // <Build> is exported in its own right, not only as what <Hatua> mounts. It
    // would paint unthemed here — a Host wraps it in <HatuaProvider> — but it
    // must not throw, or "the parts are the seam" has an exception in it.
    expect(() => render(<Build />)).not.toThrow()
  })

  it('takes no slot props: swapping a region means importing the region', () => {
    // Guarded by the compiler, not by the assertion. BuildProps is exactly a
    // <div>'s props and nothing else; the moment a `topBar` or `inspector` slot
    // appears — required or optional — this stops type-checking. A slot would
    // be a third mechanism doing what importing <TopBar> already does, so
    // reversing that has to be a deliberate edit to this line.
    const noSlotProps: Equals<BuildProps, ComponentPropsWithRef<'div'>> = true
    expect(noSlotProps).toBe(true)
  })
})

/**
 * The one thing <Build> does beyond placing regions: it introduces the two
 * halves of "add a Step" to each other.
 *
 * Neither region can do it alone and neither should. <StepList> knows where a
 * Step would go and nothing about the catalogue; <Components> knows the
 * Components and nothing about the tree. Both emit rather than reach, so something above
 * both has to wire them — and that is the whole of what is tested here.
 */
describe('Build wires the Components tab to the canvas', () => {
  const token = 'tok_build' as EditToken
  const lease: Lease = { token, expiresAt: '2099-01-01T00:00:00.000Z' }

  const CATALOGUE: Manifest[] = [
    {
      kind: 'component',
      use: 'component.email.send',
      name: 'Send email',
      blurb: 'Send a message.',
      fields: [],
      outputs: [],
    },
  ]

  const SOURCE = `id: wf\nname: n\nversion: 1\nstatus: draft\nsteps:\n  - id: s1\n    use: a\n    name: "First"\n  - id: s2\n    use: b\n    name: "Second"\n`

  /** The same, with a call into a Block — a second Board to walk into. */
  const CALLING = `id: wf\nname: n\nversion: 1\nstatus: draft\nsteps:\n  - id: s1\n    use: a\n    name: "First"\n  - id: call\n    use: block.inner\n    name: "Do the inner thing"\n    with: {}\nblocks:\n  - id: inner\n    name: "Inner"\n    steps:\n      - id: deep\n        use: b\n        name: "Deep"\n`

  const wired = (yaml = SOURCE) => {
    const writes: string[] = []
    const workflows: WorkflowStore = {
      async openDraft(): Promise<DraftSession> {
        return { token, lease, yaml, resumed: false }
      },
      async saveDraft(_token, text) {
        writes.push(text)
      },
      async renewLease() {
        return lease
      },
      async publish() {
        return { version: 2, publishedAt: '2026-01-01T00:00:00.000Z' }
      },
      async releaseDraft() {},
      async discardDraft() {},
      async listVersions() {
        return { items: [] }
      },
      async loadVersion() {
        return yaml
      },
    }

    render(
      <HatuaProvider
        ports={{ workflows, manifests: { loadManifests: async () => CATALOGUE } }}
        workflowId="wf"
      >
        <Build />
      </HatuaProvider>,
    )
    return { writes }
  }

  /** The name on every card the canvas draws, in DOM order. */
  const rowNames = () =>
    screen
      .getAllByRole('button')
      .filter(
        (button) => !button.hasAttribute('aria-label') && button.closest('[aria-label="Flow map"]'),
      )
      .map((button) => button.firstElementChild?.textContent)

  /**
   * Scoped to a region, because the Components tab and the canvas both name a
   * Component: the card in the catalogue and the Step it becomes carry the same
   * text, so an unscoped `getByRole('button', { name: /Send email/ })` finds
   * two the moment one is added.
   */
  const map = () => within(screen.getByRole('region', { name: 'Flow map' }))
  const catalogue = () => within(screen.getByRole('region', { name: 'Components' }))

  /** The Step each surface shows as selected, by the name on it. */
  const selectedIn = (region: ReturnType<typeof map>) =>
    region.getAllByRole('button').find((button) => button.getAttribute('aria-current') === 'true')
      ?.firstElementChild?.textContent

  it('opens the Components tab when an insert point is chosen, with it pending', async () => {
    // The design: "Clicking it opens the Components tab with that insertion
    // point pending." <TabbedPanel>'s controlled `tabId` exists for this.
    wired()
    await map().findByText('First')

    fireEvent.click(map().getByRole('button', { name: 'Insert a Step after First' }))
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Components')
    expect(await catalogue().findByRole('button', { name: /Send email/ })).toBeDefined()
  })

  /*
   * The other half of that click.
   *
   * The catalogue is usually already the tab in front, so bringing it forward
   * changes nothing on screen and the `+` reads as a control that does nothing.
   * The panel has to say that the next card picked is going somewhere chosen.
   */
  it('says an insertion point is waiting, because opening a tab already open shows nothing', async () => {
    wired()
    await map().findByText('First')

    const sentence = 'Pick a component to drop into the flow.'
    expect(screen.queryByText(sentence)).toBeNull()

    fireEvent.click(map().getByRole('button', { name: 'Insert a Step after First' }))
    expect(catalogue().getByText(sentence)).toBeDefined()

    // And it stops saying so once the point is filled, rather than describing a
    // place the next click will not go.
    fireEvent.click(catalogue().getByRole('button', { name: /Send email/ }))
    expect(screen.queryByText(sentence)).toBeNull()
  })

  it('adds the chosen Component at that point and comes back to the tree', async () => {
    wired()
    await map().findByText('First')

    fireEvent.click(map().getByRole('button', { name: 'Insert a Step after First' }))
    fireEvent.click(await catalogue().findByRole('button', { name: /Send email/ }))

    // The catalogue stays open: the canvas is always on screen, so there is no
    // tab to come back to and adding a second Step costs no navigation.
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Components')
    await waitFor(() => expect(rowNames()).toEqual(['First', 'Send email', 'Second']))
  })

  it('appends when a Component is picked with no insert point pending', async () => {
    // "Add this" with nowhere named means the end of the workflow.
    wired()
    await map().findByText('First')

    fireEvent.click(screen.getByRole('tab', { name: 'Components' }))
    fireEvent.click(await catalogue().findByRole('button', { name: /Send email/ }))

    await waitFor(() => expect(rowNames()).toEqual(['First', 'Second', 'Send email']))
  })

  it('appends to a document that does not project, rather than prepending to it', async () => {
    // `definition?.steps.length ?? 0` answers 0 for "does not project" and for
    // "no Steps" alike, which would put the Component at the front.
    const { writes } = wired('name: half written\nsteps:\n  - use: a\n  - use: b\n')
    await map().findByText(/not a valid Workflow Definition yet/)

    fireEvent.click(screen.getByRole('tab', { name: 'Components' }))
    fireEvent.click(await catalogue().findByRole('button', { name: /Send email/ }))

    // Autosave waits 800ms of quiet and `waitFor` defaults to 1000ms, which is
    // not enough headroom on a machine running every suite at once.
    await waitFor(() => expect(writes).toHaveLength(1), { timeout: 5000 })
    const text = writes[0] as string
    expect(text.indexOf('use: a')).toBeLessThan(text.indexOf('use: component.email.send'))
  })

  it('forgets the pending point when the user navigates away instead of picking', async () => {
    // Kept, it would silently govern where the next Component lands — or name a
    // Step removed in the meantime, which every command refuses, so the click
    // would do nothing and say nothing about why.
    wired()
    await map().findByText('First')

    fireEvent.click(
      map().getByRole('button', { name: 'Insert a Step at the start of the workflow' }),
    )
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Components')

    // Thought better of it, and went to look at something else.
    fireEvent.click(screen.getByRole('tab', { name: 'Workflow' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Components' }))
    fireEvent.click(await catalogue().findByRole('button', { name: /Send email/ }))

    await waitFor(() => expect(rowNames()).toEqual(['First', 'Second', 'Send email']))
  })

  it('keeps the pending point when the open tab is clicked again', async () => {
    // <TabbedPanel> reports every click, including one on the tab already
    // open — which is what anyone does to focus it. Treating that as
    // navigating away loses the insertion point by touching nothing.
    wired()
    await map().findByText('First')

    fireEvent.click(map().getByRole('button', { name: 'Insert a Step after First' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Components' }))
    fireEvent.click(await catalogue().findByRole('button', { name: /Send email/ }))

    await waitFor(() => expect(rowNames()).toEqual(['First', 'Send email', 'Second']))
  })

  /*
   * <TabbedPanel> renders only the open tab, so adding a Step — Flow, then
   * Components, then Flow — unmounts and remounts <StepList> twice. Selection
   * and collapse are its own state, and without something above holding them
   * every insert cleared the selection and re-expanded every container the user
   * had collapsed: on the one action most likely to be repeated.
   *
   * Still chrome, and still nowhere near the document (ADR-0001). It just
   * outlives the region, which is what the design means by the composition root
   * holding selection.
   */
  it('keeps the selected Step through the round trip that adds one', async () => {
    wired()
    await map().findByText('First')

    fireEvent.click(map().getByRole('button', { name: 'Insert a Step after First' }))
    fireEvent.click(await catalogue().findByRole('button', { name: /Send email/ }))
    await waitFor(() => expect(rowNames()).toEqual(['First', 'Send email', 'Second']))

    expect(selectedIn(map())).toBeUndefined()

    // Select one, then add another, and the selection is still there.
    fireEvent.click(map().getByText('First'))
    fireEvent.click(map().getByRole('button', { name: 'Insert a Step after Second' }))
    fireEvent.click(await catalogue().findByRole('button', { name: /Send email/ }))
    await waitFor(() => expect(rowNames().at(-1)).toBe('Send email'))

    expect(selectedIn(map())).toBe('First')
  })

  /**
   * A `StepRef` names the Board it is on, so a selection is meaningless
   * anywhere else. Held per Board, a tab keeps the Step that was left selected
   * on it; held as one shared answer, coming back finds nothing and the step
   * editor is handed nothing every time (ADR-0017).
   */
  it('remembers the selected Step on each Board across the doorway', async () => {
    wired(CALLING)
    await map().findByText('First')

    fireEvent.click(map().getByText('First'))
    expect(selectedIn(map())).toBe('First')

    fireEvent.click(map().getByRole('button', { name: 'Open Do the inner thing' }))
    // A Board nobody has selected anything on has nothing selected — the
    // selection did not follow through the doorway.
    expect(selectedIn(map())).toBeUndefined()
    fireEvent.click(map().getByText('Deep'))
    expect(selectedIn(map())).toBe('Deep')

    const strip = within(map().getByRole('navigation', { name: 'Boards' }))
    fireEvent.click(strip.getByRole('button', { name: 'The workflow' }))
    expect(selectedIn(map())).toBe('First')
  })

  /*
   * The label names the KIND of thing the tab holds; the canvas's strip already
   * says which Block. The id underneath it does not move, or walking through a
   * doorway would leave the panel pointing at a tab that is gone.
   */
  it('calls the side panel’s first tab Block while a Block’s Board is open', async () => {
    wired(CALLING)
    await map().findByText('First')

    expect(screen.getByRole('tab', { name: 'Workflow' })).toBeDefined()

    fireEvent.click(map().getByRole('button', { name: 'Open Do the inner thing' }))
    expect(screen.getByRole('tab', { name: 'Block' })).toBeDefined()
    expect(screen.queryByRole('tab', { name: 'Workflow' })).toBeNull()

    const strip = within(map().getByRole('navigation', { name: 'Boards' }))
    fireEvent.click(strip.getByRole('button', { name: 'The workflow' }))
    expect(screen.getByRole('tab', { name: 'Workflow' })).toBeDefined()
  })

  /*
   * A renamed Block is one nothing resolves under its old id, and the canvas
   * reads that as a deleted Block: without following the rename, committing the
   * slug drops the user back to the root Board mid-edit and closes the tab they
   * were working in.
   */
  it('follows a Block’s slug rename, keeping its Board and its selection', async () => {
    wired(CALLING)
    await map().findByText('First')

    fireEvent.click(map().getByRole('button', { name: 'Open Do the inner thing' }))
    fireEvent.click(map().getByText('Deep'))
    expect(selectedIn(map())).toBe('Deep')

    fireEvent.click(screen.getByRole('tab', { name: 'Block' }))
    const slug = screen.getByLabelText('Slug')
    fireEvent.change(slug, { target: { value: 'renamed' } })
    fireEvent.blur(slug)

    await waitFor(() => expect(screen.getByLabelText('Slug')).toHaveProperty('value', 'renamed'))
    // Still on the Block's Board, and still on the Step that was selected.
    expect(map().getByText('Deep')).toBeDefined()
    expect(selectedIn(map())).toBe('Deep')
    expect(
      within(map().getByRole('navigation', { name: 'Boards' })).getByRole('button', {
        name: 'Inner',
      }),
    ).toBeDefined()
  })

  it('keeps a collapsed container collapsed through the same round trip', async () => {
    const NESTED = `id: wf\nname: n\nversion: 1\nstatus: draft\nsteps:\n  - id: s1\n    use: core.for_each\n    name: "Each"\n    steps:\n      - id: s2\n        use: b\n        name: "Inner"\n`
    wired(NESTED)
    await map().findByText('Each')

    fireEvent.click(map().getByRole('button', { name: 'Collapse Each' }))
    expect(map().queryByText('Inner')).toBeNull()
    // Collapse is one set for both surfaces too, and it is keyed by StepRef, so
    // folding `Each` on this Board folds this Board's and no other's.
    expect(map().queryByText('Inner')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Components' }))
    fireEvent.click(await catalogue().findByRole('button', { name: /Send email/ }))
    await waitFor(() => expect(rowNames()).toContain('Send email'))

    expect(map().queryByText('Inner')).toBeNull()
    expect(map().getByRole('button', { name: 'Expand Each' })).toBeDefined()
  })

  it('forgets the pending point once it has been used', async () => {
    wired()
    await map().findByText('First')

    fireEvent.click(
      map().getByRole('button', { name: 'Insert a Step at the start of the workflow' }),
    )
    fireEvent.click(await catalogue().findByRole('button', { name: /Send email/ }))
    await waitFor(() => expect(rowNames()[0]).toBe('Send email'))

    // A second pick with nothing pending appends rather than repeating the
    // first insertion point.
    fireEvent.click(screen.getByRole('tab', { name: 'Components' }))
    fireEvent.click(await catalogue().findByRole('button', { name: /Send email/ }))
    await waitFor(() => expect(rowNames().at(-1)).toBe('Send email'))
  })
})
