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
  it('renders the designer screen, which is the whole of what a Host asked for', () => {
    const { container } = render(<Hatua />)
    const root = container.querySelector('.hatua-root')
    expect(root).not.toBeNull()
    expect(screen.getByRole('tablist').closest('.hatua-root')).toBe(root)
    expect(screen.getByRole('region', { name: 'Toolbar' })).toBeDefined()
  })

  it('takes no children, so there is no third way to embed', () => {
    // The type says so and this says so at runtime: passing children used to be
    // the only thing <Hatua> could do, and a Host still holding that habit
    // should see its markup ignored rather than half-composed with the screen.
    // The compiler is the real guard: an unused @ts-expect-error is an error,
    // so restoring a children prop breaks this line rather than passing it.
    // @ts-expect-error children is not part of HatuaProps any more.
    render(<Hatua>escape hatch</Hatua>)
    expect(screen.queryByText('escape hatch')).toBeNull()
  })

  it('carries the overlay container, so overlays have somewhere themed to land', () => {
    const { container } = render(<Hatua />)
    expect(container.querySelector('.hatua-root .hatua-portals')).not.toBeNull()
  })

  it('passes a theme through as custom properties', () => {
    const { container } = render(<Hatua theme={createTheme({ accent: 'oklch(0.7 0.1 30)' })} />)
    const root = container.querySelector('.hatua-root') as HTMLElement
    expect(root.style.getPropertyValue('--hatua-seed-accent')).toBe('oklch(0.7 0.1 30)')
  })

  it('follows the Host colour mode unless one is pinned', () => {
    const { container, rerender } = render(<Hatua />)
    expect(container.querySelector('.hatua-root')?.hasAttribute('data-hatua-mode')).toBe(false)
    rerender(<Hatua colorMode="dark" />)
    expect(container.querySelector('.hatua-root')?.getAttribute('data-hatua-mode')).toBe('dark')
  })
})
