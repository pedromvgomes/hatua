import type { Manifest } from '@hatua/schema'
import type { ManifestSource } from '@hatua/services'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HatuaProvider } from '../theme/HatuaProvider'
import { Library } from './Library'

const component = (over: Partial<Manifest> & Pick<Manifest, 'use' | 'name'>): Manifest => ({
  kind: 'component',
  fields: [],
  outputs: [],
  ...over,
})

const CATALOGUE: Manifest[] = [
  component({
    use: 'email.send',
    name: 'Send email',
    group: 'Email',
    icon: 'mail',
    blurb: 'Send a message through a connected mailbox.',
  }),
  component({
    use: 'email.received',
    name: 'When mail arrives',
    kind: 'trigger',
    group: 'Email',
    icon: 'inbox',
    blurb: 'Starts the workflow when a message arrives.',
  }),
  component({
    use: 'agent.act',
    name: 'Run agent',
    group: 'Intelligence',
    icon: 'zap',
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

describe('Library', () => {
  it('says so when the Host wired no ManifestSource', async () => {
    // Not the empty state. "Nothing is wired up" and "nothing is declared" have
    // different fixes, and showing the second for the first sends whoever
    // embedded Hatua looking for a manifest file that was never the problem.
    mount(<Library />)
    expect(await screen.findByText(/no Component Manifests are wired up/i)).toBeDefined()
  })

  it('shows loading until the Host answers', async () => {
    const host = pending()
    mount(<Library />, host.source)

    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Loading components…')

    host.resolve(CATALOGUE)
    await waitFor(() => expect(screen.getByText('Send email')).toBeDefined())
    expect(screen.queryByText('Loading components…')).toBeNull()
  })

  it('reports a failure and offers a retry that actually refetches', async () => {
    let attempt = 0
    mount(<Library />, {
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
    mount(<Library />, { loadManifests: async () => [] })

    expect(await screen.findByText(/has declared no Components yet/i)).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
    // Nothing to narrow, so nothing to narrow it with.
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('groups by the manifest group, keeping the Host’s order and filing the rest last', async () => {
    mount(<Library />, { loadManifests: async () => CATALOGUE })

    await screen.findByText('Send email')
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Email',
      // "Other" is not a section the Host chose, so it cannot sit above one it did.
      'Email',
      'Intelligence',
      'Other',
    ])
  })

  /*
   * CONTEXT.md: a Trigger is NOT a Step and lives in its own section of the
   * Workflow Definition. Its manifest carries the same `group`, so grouping
   * alone would file "When mail arrives" beside "Send email" under Email and
   * offer both as things to add as Steps.
   */
  it('separates Triggers from Components rather than mixing or hiding them', async () => {
    mount(<Library />, { loadManifests: async () => CATALOGUE })

    await screen.findByText('Send email')
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Triggers',
      'Components',
    ])

    const triggers = screen.getByRole('heading', { name: 'Triggers' }).closest('div')
    expect(triggers?.textContent).toContain('When mail arrives')
    expect(triggers?.textContent).not.toContain('Send email')
  })

  it('drops a section entirely when the Host declared nothing of that kind', async () => {
    mount(<Library />, { loadManifests: async () => [CATALOGUE[0] as Manifest] })

    await screen.findByText('Send email')
    expect(screen.queryByRole('heading', { name: 'Triggers' })).toBeNull()
  })

  it('renders name, blurb and icon', async () => {
    mount(<Library />, { loadManifests: async () => [CATALOGUE[0] as Manifest] })

    expect(await screen.findByText('Send email')).toBeDefined()
    expect(screen.getByText('Send a message through a connected mailbox.')).toBeDefined()
    // The glyph set is not in the package yet; what matters is that `icon`
    // survives to the DOM so swapping in real icons touches one element.
    expect(document.querySelector('[data-icon="mail"]')).not.toBeNull()
  })

  it('filters as the user types, across every kind at once', async () => {
    mount(<Library />, { loadManifests: async () => CATALOGUE })
    await screen.findByText('Send email')

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'mail' } })
    // Matches the trigger's name and the component's group — both survive.
    expect(cardNames()).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Send email'),
        expect.stringContaining('When mail arrives'),
      ]),
    )
    expect(screen.queryByText('Run agent')).toBeNull()
  })

  it('matches the blurb and the use, not just the name', async () => {
    mount(<Library />, { loadManifests: async () => CATALOGUE })
    await screen.findByText('Send email')
    const search = screen.getByRole('searchbox')

    fireEvent.change(search, { target: { value: 'connected mailbox' } })
    expect(screen.getByText('Send email')).toBeDefined()

    fireEvent.change(search, { target: { value: 'agent.act' } })
    expect(screen.getByText('Run agent')).toBeDefined()
  })

  it('distinguishes "nothing matches" from "nothing declared"', async () => {
    mount(<Library />, { loadManifests: async () => CATALOGUE })
    await screen.findByText('Send email')

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } })
    expect(screen.getByText(/nothing matches/i)).toBeDefined()
    expect(screen.queryByText(/has declared no Components yet/i)).toBeNull()
    // The box stays: a filter you cannot clear is a dead end.
    expect(screen.getByRole('searchbox')).toBeDefined()
  })

  it('starts filtered when told to', async () => {
    mount(<Library defaultQuery="agent" />, { loadManifests: async () => CATALOGUE })

    expect(await screen.findByText('Run agent')).toBeDefined()
    expect(screen.queryByText('Send email')).toBeNull()
  })

  it('hands the whole manifest back on select', async () => {
    const onSelect = vi.fn()
    mount(<Library onSelect={onSelect} />, { loadManifests: async () => CATALOGUE })

    fireEvent.click(await screen.findByRole('button', { name: /Send email/ }))
    expect(onSelect).toHaveBeenCalledWith(CATALOGUE[0])
  })

  it('renders cards as cards, not as dead buttons, when nothing can be selected', async () => {
    mount(<Library />, { loadManifests: async () => CATALOGUE })

    await screen.findByText('Send email')
    // A control that does nothing still takes a tab stop and still announces
    // itself as a button.
    expect(screen.queryByRole('button', { name: /Send email/ })).toBeNull()
  })

  it('reads the catalogue once however many Libraries mount', async () => {
    const loadManifests = vi.fn(async () => CATALOGUE)
    render(
      <HatuaProvider ports={{ manifests: { loadManifests } }}>
        <Library />
        <Library />
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
        <Library />
      </HatuaProvider>,
    )
    await screen.findByText('Send email')

    // A fresh `ports` object holding the same source is not a change.
    rerender(
      <HatuaProvider ports={{ manifests: first }}>
        <Library />
      </HatuaProvider>,
    )
    expect(first.loadManifests).toHaveBeenCalledTimes(1)

    rerender(
      <HatuaProvider ports={{ manifests: second }}>
        <Library />
      </HatuaProvider>,
    )
    expect(await screen.findByText('Run agent')).toBeDefined()
    expect(screen.queryByText('Send email')).toBeNull()
  })
})
