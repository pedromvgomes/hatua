import { describe, expect, it } from 'vitest'
import { createTheme } from './createTheme'

describe('createTheme', () => {
  it('produces a full seed set from no input', () => {
    const theme = createTheme()
    expect(theme['--hatua-seed-accent']).toBe('oklch(0.63 0.115 195)')
    expect(theme['--hatua-seed-radius']).toBe('10px')
  })

  it('overrides only what the host supplies', () => {
    const theme = createTheme({ accent: 'oklch(0.55 0.2 300)' })
    expect(theme['--hatua-seed-accent']).toBe('oklch(0.55 0.2 300)')
    // Untouched seeds keep their defaults, so a partial theme stays coherent.
    expect(theme['--hatua-seed-ink']).toBe('#232d47')
  })

  it('is serialisable, so it can be computed at build time', () => {
    expect(JSON.parse(JSON.stringify(createTheme()))).toEqual({ ...createTheme() })
  })
})
