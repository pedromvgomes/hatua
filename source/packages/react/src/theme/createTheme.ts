/**
 * Seed-and-derive theming (ADR-0002).
 *
 * A Host supplies a handful of brand seeds; the ramps and every semantic alias
 * are derived from them in CSS via oklch relative colour syntax. That keeps the
 * colour maths in one place instead of duplicated per instance, and leaves each
 * derived step individually overridable.
 *
 * createTheme is a pure function returning a serialisable object, so it can run
 * at build time and needs no runtime of its own.
 */

export interface ThemeSeed {
  /** Accent, in any CSS colour. oklch is preferred so derivation stays in gamut. */
  accent?: string
  /** Primary ink; the neutral ramp derives from it. */
  ink?: string
  /** Page background in light mode. */
  surface?: string
  /** Base control radius in px; chips and cards scale from it. */
  radius?: number
  fontFamily?: string
  fontFamilyMono?: string
}

/** Custom properties applied to Hatua's root element. */
export type Theme = Readonly<Record<`--hatua-${string}`, string>>

const DEFAULT_SEED = {
  accent: 'oklch(0.63 0.115 195)',
  ink: '#232d47',
  surface: '#f7f8fb',
  radius: 10,
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  fontFamilyMono: "'Fragment Mono', ui-monospace, monospace",
} as const satisfies Required<ThemeSeed>

export function createTheme(seed: ThemeSeed = {}): Theme {
  const s = { ...DEFAULT_SEED, ...seed }
  return Object.freeze({
    '--hatua-seed-accent': s.accent,
    '--hatua-seed-ink': s.ink,
    '--hatua-seed-surface': s.surface,
    '--hatua-seed-radius': `${s.radius}px`,
    '--hatua-seed-font': s.fontFamily,
    '--hatua-seed-font-mono': s.fontFamilyMono,
  })
}
