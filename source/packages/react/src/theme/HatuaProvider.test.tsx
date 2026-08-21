import type { ManifestSource } from '@hatua/services'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HatuaProvider, useManifestStore, usePortalContainer } from './HatuaProvider'

function StoreProbe() {
  const store = useManifestStore()
  return <span data-testid="store">{store ? store.getSnapshot().status : 'none'}</span>
}

function PortalProbe() {
  const container = usePortalContainer()
  return <span data-testid="probe">{container ? container.className : 'null'}</span>
}

describe('HatuaProvider', () => {
  // State, not a ref. A ref read during render is null through the whole
  // initial mount and never updates, because assigning to one schedules no
  // re-render — so overlays mounted alongside their trigger would see null.
  it('exposes the portal container to consumers after mount', async () => {
    render(
      <HatuaProvider>
        <PortalProbe />
      </HatuaProvider>,
    )
    expect((await screen.findByTestId('probe')).textContent).toBe('hatua-portals')
  })

  it('keeps the portal container inside the themed subtree', async () => {
    const { container } = render(
      <HatuaProvider>
        <span />
      </HatuaProvider>,
    )
    const portals = container.querySelector('.hatua-portals')
    // Must be a descendant of .hatua-root, or it escapes the custom properties.
    expect(portals?.closest('.hatua-root')).not.toBeNull()
  })

  it('applies theme seeds as inline custom properties, scoped to its subtree', () => {
    const { container } = render(
      <HatuaProvider>
        <span />
      </HatuaProvider>,
    )
    const root = container.querySelector('.hatua-root') as HTMLElement
    expect(root.style.getPropertyValue('--hatua-seed-accent')).toBe('oklch(0.63 0.115 195)')
  })

  it('does not pin a colour mode unless asked, so the Host is inherited', () => {
    const { container } = render(
      <HatuaProvider>
        <span />
      </HatuaProvider>,
    )
    expect(container.querySelector('.hatua-root')?.hasAttribute('data-hatua-mode')).toBe(false)
  })

  it('pins the mode when given one', () => {
    const { container } = render(
      <HatuaProvider colorMode="dark">
        <span />
      </HatuaProvider>,
    )
    expect(container.querySelector('.hatua-root')?.getAttribute('data-hatua-mode')).toBe('dark')
  })

  /*
   * The provider is the composition root, not only the theme: <Library /> takes
   * no props in either embedding, so the ports are the only seam the Host path
   * and the <Hatua> path share.
   */
  it('holds no manifest store until a Host supplies a source', () => {
    render(
      <HatuaProvider>
        <StoreProbe />
      </HatuaProvider>,
    )
    // Null rather than an empty store: "nothing wired" is a state a region
    // renders differently from "nothing declared".
    expect(screen.getByTestId('store').textContent).toBe('none')
  })

  it('wires a ManifestSource to a store, without reading it itself', () => {
    const loadManifests = vi.fn(async () => [])
    render(
      <HatuaProvider ports={{ manifests: { loadManifests } }}>
        <StoreProbe />
      </HatuaProvider>,
    )

    expect(screen.getByTestId('store').textContent).toBe('loading')
    // The provider composes; the region that renders the catalogue is what
    // asks for it. A Host mounting no such region pays for no request.
    expect(loadManifests).not.toHaveBeenCalled()
  })

  it('keeps the same store across renders that keep the same source', () => {
    const manifests: ManifestSource = { loadManifests: async () => [] }
    let seen: unknown[] = []
    function Capture() {
      seen.push(useManifestStore())
      return null
    }

    const { rerender } = render(
      <HatuaProvider ports={{ manifests }}>
        <Capture />
      </HatuaProvider>,
    )
    rerender(
      <HatuaProvider ports={{ manifests }}>
        <Capture />
      </HatuaProvider>,
    )

    // A fresh `ports` literal each render is what a Host writes; rebuilding the
    // store on it would throw away a loaded catalogue on every keystroke.
    expect(new Set(seen).size).toBe(1)
    seen = []
  })
})
