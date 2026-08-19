import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The lint ADR-0002 says exists.
 *
 * ADR-0002: "Components may only reference semantic aliases (--surface-card,
 * --text-muted, --border-subtle), never base ramps... enforced by lint rather
 * than left to discipline." Biome lints CSS but has no rule that can express
 * "this custom property, not that one", so the enforcement is this test.
 *
 * It reads the authored CSS rather than the built bundle. CSS Modules rewrites
 * class NAMES and nothing else — every declaration value survives the transform
 * byte for byte — so the two are the same text for this question, and reading
 * source keeps the check runnable without a build.
 *
 * Three rules, one per way the contract can break:
 *
 *  1. no seeds — a component reading --hatua-accent bypasses the derivation,
 *     so it would ignore dark mode and every host override of a derived step;
 *  2. no literals — a hard-coded colour cannot be themed at all;
 *  3. no undefined aliases — var(--text-subtle) is not a compile error in CSS,
 *     it silently resolves to nothing, which is how a typo ships.
 */

// fileURLToPath is given a string, not a URL object: the jsdom environment
// replaces the global URL class, and Node rejects a foreign instance.
const packageRoot = join(fileURLToPath(import.meta.url), '..', '..', '..')

/** base.css is the definition site: it owns the seeds, the ramps and the literals. */
const BASE = 'src/styles/base.css'

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })

// .storybook is in scope on purpose: it is the likeliest place for a global
// stylesheet to creep in, and it is the one directory outside src/ that ships
// React of its own.
const sources = ['src', '.storybook']
  .map((dir) => join(packageRoot, dir))
  .filter(existsSync)
  .flatMap(walk)
  .map((path) => ({
    path: relative(packageRoot, path).replaceAll('\\', '/'),
    text: readFileSync(path, 'utf8'),
  }))

const cssFiles = sources.filter((f) => f.path.endsWith('.css') && f.path !== BASE)
// This file is excluded from its own scan: it quotes both the alias names and
// the literals it forbids, so it would be its only finding.
const SELF = 'src/styles/tokens.test.ts'
const componentFiles = sources.filter((f) => /\.tsx?$/.test(f.path) && f.path !== SELF)

const definitionsIn = (text: string) =>
  new Set([...text.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1] as string))

/** Every custom property base.css defines — i.e. the alias vocabulary. */
const definedAliases = definitionsIn(sources.find((f) => f.path === BASE)?.text ?? '')

/** Every var(--x) a file reads, wherever it appears. */
const referencedAliases = (text: string) =>
  [...text.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1] as string)

/**
 * Colour literals. `oklch(from var(--alias) …)` is a derivation of an alias and
 * therefore fine; `oklch(0.63 0.115 195)` is a literal and is not — hence the
 * negative lookahead rather than a bare check for the function name.
 */
// The lookarounds around the named colours matter more than they look:
// `\b` would match the `white` in `white-space: nowrap`.
const COLOUR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch)\(|\boklch\(\s*(?!from\b)|\bcolor\(\s*(?!from\b)|(?<![\w-])(?:white|black|red|green|blue|grey|gray|silver|navy|teal|orange|yellow|purple)(?![\w-])/g

describe('token discipline (ADR-0002)', () => {
  it('has an alias vocabulary to check against', () => {
    // Guards the whole suite: were the regex above to stop matching base.css,
    // rule 3 would pass vacuously and rules 1 and 2 would still look green.
    expect(definedAliases.size).toBeGreaterThan(20)
    expect(definedAliases).toContain('--surface-card')
  })

  it.each(cssFiles)('$path uses no --hatua-* seed', ({ text }) => {
    expect(referencedAliases(text).filter((a) => a.startsWith('--hatua-'))).toEqual([])
  })

  it.each(cssFiles)('$path uses no colour literal', ({ text }) => {
    expect(text.match(COLOUR_LITERAL) ?? []).toEqual([])
  })

  // A component may also define a property of its own — Toast's --toast-tone,
  // read by both its stripe and its progress bar — so the file's own
  // definitions count. That does not weaken the rule the check exists for:
  // a typo still names something nobody defines, and a local definition
  // holding a seed or a literal is caught by the two rules above.
  it.each(cssFiles)('$path reads only properties something defines', ({ text }) => {
    const known = definitionsIn(text)
    const unknown = referencedAliases(text).filter((a) => !definedAliases.has(a) && !known.has(a))
    expect(unknown).toEqual([])
  })

  // Inline styles are the other way a colour reaches the DOM, and the CSS rules
  // above cannot see them. theme/ is exempt: createTheme WRITES the seeds and
  // HatuaProvider applies them, which is the whole point of that layer.
  it.each(componentFiles.filter((f) => !f.path.startsWith('src/theme/')))(
    '$path reads only aliases base.css defines',
    ({ text }) => {
      const unknown = referencedAliases(text).filter((a) => !definedAliases.has(a))
      expect(unknown).toEqual([])
    },
  )
})

/**
 * ADR-0003: "A host imports nothing." A single side-effect CSS import anywhere
 * in the package — a Storybook preview is the easy one — quietly restores the
 * stylesheet contract the ADR exists to avoid, and nothing else would fail.
 */
describe('no stylesheet (ADR-0003)', () => {
  it.each(componentFiles)(
    '$path imports CSS for its text or its class map, never for effect',
    ({ text }) => {
      expect(text.match(/^import\s+['"][^'"]+\.css['"]/gm) ?? []).toEqual([])
    },
  )
})
