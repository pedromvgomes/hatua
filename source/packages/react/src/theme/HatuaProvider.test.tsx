import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HatuaProvider, usePortalContainer } from './HatuaProvider'

function PortalProbe() {
  const container = usePortalContainer()
  return <span data-testid="probe">{container ? container.className : 'null'}</span>
}

describe('HatuaProvider', () => {
  // Regression: the container was held in a ref and read during render, so it
  // was null through the whole initial mount and never updated — refs schedule
  // no re-render. Overlays mounted alongside their trigger saw null.
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
    expect(root.style.getPropertyValue('--hatua-accent')).toBe('oklch(0.63 0.115 195)')
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
})
