import { render, screen } from '@testing-library/react'
import type { ComponentPropsWithRef } from 'react'
import { describe, expect, it } from 'vitest'
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
  it('arranges the toolbar, the tabs and the step editor', () => {
    render(<Build />)
    expect(screen.getByRole('region', { name: 'Toolbar' })).toBeDefined()
    expect(screen.getByRole('tablist')).toBeDefined()
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeDefined()
  })

  it('offers exactly the three tabs, opening on the flow map', () => {
    render(<Build />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Library',
      'Flow',
      'Data',
    ])
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Flow')
    expect(screen.getByRole('region', { name: 'Flow' })).toBeDefined()
  })

  it('mounts only the open tab, so the other two cost nothing until asked for', () => {
    render(<Build />)
    expect(screen.queryByRole('region', { name: 'Library' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Data' })).toBeNull()
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
