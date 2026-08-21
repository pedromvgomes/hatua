import type { Manifest } from '@hatua/schema'
import type { ManifestSource } from '@hatua/services'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HatuaProvider } from '../theme/HatuaProvider'
import { Components } from './Components'

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
    icon: '/icons/mail.svg',
    blurb: 'Send a message through a connected mailbox.',
  }),
  component({
    use: 'email.received',
    name: 'When mail arrives',
    kind: 'trigger',
    group: 'Email',
    icon: '/icons/inbox.svg',
    blurb: 'Starts the workflow when a message arrives.',
  }),
  component({
    use: 'agent.act',
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

    fireEvent.change(search, { target: { value: 'agent.act' } })
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
    // Reachable without anyone typing: an array whose entries carry no `kind`
    // this region renders — a `components:` catalogue is one array away — files
    // into no section, which would otherwise read as `Nothing matches “”.`
    mount(<Components />, {
      loadManifests: async () => [{ components: [] }, { components: [] }] as unknown as Manifest[],
    })

    expect(await screen.findByText(/nothing in it is a Component/i)).toBeDefined()
    expect(screen.queryByText(/nothing matches/i)).toBeNull()
    // A malformed catalogue is a wiring mistake, not an empty one, and the two
    // have different fixes.
    expect(screen.queryByText('No components are available yet.')).toBeNull()
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

  it('hands the whole manifest back on select', async () => {
    const onSelect = vi.fn()
    mount(<Components onSelect={onSelect} />, { loadManifests: async () => CATALOGUE })

    fireEvent.click(await screen.findByRole('button', { name: /Send email/ }))
    expect(onSelect).toHaveBeenCalledWith(CATALOGUE[0])
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
