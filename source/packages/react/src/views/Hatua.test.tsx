import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createTheme } from '../theme/createTheme'
import { Hatua } from './Hatua'

/**
 * <Hatua> is the whole public surface for the common case — a Host writes this
 * and nothing else — so what it mounts on a Host's behalf is worth asserting
 * rather than assuming. Everything below is something the Host would otherwise
 * have to do itself, which is exactly what ADR-0002 says it must not have to.
 */
describe('Hatua', () => {
  it('mounts the provider, so a Host supplies a theme and mounts nothing', () => {
    const { container } = render(
      <Hatua>
        <p>designer</p>
      </Hatua>,
    )
    const root = container.querySelector('.hatua-root')
    expect(root).not.toBeNull()
    expect(screen.getByText('designer').closest('.hatua-root')).toBe(root)
  })

  it('carries the overlay container, so overlays have somewhere themed to land', () => {
    const { container } = render(<Hatua />)
    expect(container.querySelector('.hatua-root .hatua-portals')).not.toBeNull()
  })

  it('passes a theme through as custom properties', () => {
    const { container } = render(<Hatua theme={createTheme({ accent: 'oklch(0.7 0.1 30)' })} />)
    const root = container.querySelector('.hatua-root') as HTMLElement
    expect(root.style.getPropertyValue('--hatua-accent')).toBe('oklch(0.7 0.1 30)')
  })

  it('follows the Host colour mode unless one is pinned', () => {
    const { container, rerender } = render(<Hatua />)
    expect(container.querySelector('.hatua-root')?.hasAttribute('data-hatua-mode')).toBe(false)
    rerender(<Hatua colorMode="dark" />)
    expect(container.querySelector('.hatua-root')?.getAttribute('data-hatua-mode')).toBe('dark')
  })

  it('renders without children, which is what a Host embedding an empty designer does', () => {
    const { container } = render(<Hatua />)
    expect(container.querySelector('.hatua-root')).not.toBeNull()
  })
})
