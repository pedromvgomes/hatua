/** biome-ignore-all lint/correctness/noNodejsModules: a Node test reading fixtures from disk; nothing here ships to a browser. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The lint ADR-0002 says exists.
 *
 * ADR-0002: "Components may only reference semantic aliases (--hatua-surface-card,
 * --hatua-text-muted, --hatua-border-subtle), never base ramps... enforced by lint rather
 * than left to discipline." Biome lints CSS but has no rule that can express
 * "this custom property, not that one", so the enforcement is this test.
 *
 * It reads the authored CSS rather than the built bundle. CSS Modules rewrites
 * class NAMES and nothing else — every declaration value survives the transform
 * byte for byte — so the two are the same text for this question, and reading
 * source keeps the check runnable without a build.
 *
 * Four rules, one per way the contract can break:
 *
 *  1. no seeds — a component reading --hatua-seed-accent bypasses the derivation,
 *     so it would ignore dark mode and every host override of a derived step;
 *  2. no literals — a hard-coded colour cannot be themed at all;
 *  3. no undefined aliases — var(--hatua-text-subtle) is not a compile error in
 *     CSS, it silently resolves to nothing, which is how a typo ships;
 *  4. everything is --hatua-* — see below.
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

/**
 * The one file that writes a Host's tokens on purpose.
 *
 * theming.stories.tsx sets `--accent`, `--surface-card` and friends on a frame
 * and mounts Hatua inside it, precisely to show that Hatua does not shadow
 * them. Those names are the Host's; a rule that forbade them would forbid the
 * demonstration. Exempted by name rather than by pattern so a second file
 * cannot join it quietly.
 */
const HOST_TOKENS = 'src/theme/theming.stories.tsx'

/**
 * The files that may name a seed, listed rather than matched by directory.
 *
 * `createTheme` WRITES the seeds and `HatuaProvider` applies what it returns, so
 * both name `--hatua-seed-*` legitimately. Named individually rather than by
 * directory: `startsWith('src/theme/')` would cover every file that lands
 * there, so a story in that directory would sit outside both alias-existence
 * rules and a typo'd `var(--hatua-text-primry)` in it would resolve to nothing
 * and ship.
 */
const SEED_AUTHORS = new Set(['src/theme/createTheme.ts', 'src/theme/HatuaProvider.tsx'])

/**
 * The names a file references that nothing defines.
 *
 * For every file but one, that is the whole rule. HOST_TOKENS writes a HOST's
 * tokens on purpose, so its unprefixed names are its subject rather than a
 * mistake — but a `--hatua-*` name it gets wrong is still a typo that resolves
 * to nothing, so the exemption is scoped to the properties it is about instead
 * of excusing the file.
 */
const unknownNames = (path: string, names: string[], known: Set<string>) =>
  names
    .filter((a) => !definedAliases.has(a) && !known.has(a))
    .filter((a) => path !== HOST_TOKENS || a.startsWith(PREFIX))
const componentFiles = sources.filter((f) => /\.tsx?$/.test(f.path) && f.path !== SELF)

const definitionsIn = (text: string) =>
  new Set([...text.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1] as string))

/** Every custom property base.css defines — i.e. the alias vocabulary. */
const definedAliases = definitionsIn(sources.find((f) => f.path === BASE)?.text ?? '')

/** Every var(--x) a file reads, wherever it appears. */
const referencedAliases = (text: string) =>
  [...text.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1] as string)

/**
 * Alias names written as bare strings, which is how TypeScript reaches for one
 * without spelling `var()` at the site: tokens.stories.tsx keeps its vocabulary
 * in arrays and builds every swatch as `var(${alias})`, so the regex above sees
 * none of them — a typo in the one file whose entire job is to render the alias
 * set would produce an empty swatch and leave this suite green.
 *
 * Scoped to --hatua-* and the alias namespace rather than every string: a
 * component may still define a property of its own, and those are covered by
 * the file's own definitions the same way the CSS rules cover them.
 */
const quotedAliases = (text: string) =>
  [...text.matchAll(/['"`](--[\w-]+)['"`]/g)].map((m) => m[1] as string)

/**
 * Colour literals. `oklch(from var(--alias) …)` is a derivation of an alias and
 * therefore fine; `oklch(0.63 0.115 195)` is a literal and is not — hence the
 * negative lookahead rather than a bare check for the function name.
 */
// The lookarounds around the named colours matter more than they look:
// `\b` would match the `white` in `white-space: nowrap`.
const COLOUR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch)\(|\boklch\(\s*(?!from\b)|\bcolor\(\s*(?!from\b)|(?<![\w-])(?:white|black|red|green|blue|grey|gray|silver|navy|teal|orange|yellow|purple)(?![\w-])/g

/**
 * Seeds are `--hatua-seed-*`; everything else Hatua names is `--hatua-*`. The
 * split exists because rule 1 has to be able to tell a seed from a derived
 * alias, and both now live under the same prefix.
 */
const PREFIX = '--hatua-'
const SEED_PREFIX = '--hatua-seed-'

describe('token discipline (ADR-0002)', () => {
  it('has an alias vocabulary to check against', () => {
    // Guards the whole suite: were the regex above to stop matching base.css,
    // rule 3 would pass vacuously and rules 1 and 2 would still look green.
    expect(definedAliases.size).toBeGreaterThan(20)
    expect(definedAliases).toContain('--hatua-surface-card')
  })

  it.each(cssFiles)('$path uses no --hatua-seed-* seed', ({ text }) => {
    expect(referencedAliases(text).filter((a) => a.startsWith(SEED_PREFIX))).toEqual([])
  })

  it.each(cssFiles)('$path uses no colour literal', ({ text }) => {
    expect(text.match(COLOUR_LITERAL) ?? []).toEqual([])
  })

  // A component may also define a property of its own — Toast's --hatua-toast-tone,
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
  // above cannot see them. Only the two files that author seeds are exempt —
  // see SEED_AUTHORS.
  it.each(componentFiles.filter((f) => !SEED_AUTHORS.has(f.path)))(
    '$path reads only aliases base.css defines',
    ({ path, text }) => {
      expect(unknownNames(path, referencedAliases(text), new Set())).toEqual([])
    },
  )

  /*
   * The same rule for alias names written as bare strings.
   *
   * Tests are exempt and stories are not, which is the whole point of the
   * split: a test NAMES a property to assert something about it — that
   * <Hatua theme> really does write the --hatua-seed-accent seed — while a story
   * READS one to paint with, and tokens.stories.tsx reads every alias there is
   * from arrays of exactly these strings. The two seed authors are exempt by
   * name; the directory around them is not.
   */
  it.each(componentFiles.filter((f) => !SEED_AUTHORS.has(f.path) && !/\.test\.tsx?$/.test(f.path)))(
    '$path names only aliases base.css defines',
    ({ path, text }) => {
      expect(unknownNames(path, quotedAliases(text), definitionsIn(text))).toEqual([])
    },
  )
})

/**
 * Every custom property Hatua defines or reads is `--hatua-*`.
 *
 * This is what makes "Hatua cannot collide with a Host's CSS" a fact rather than
 * a convention, and it is a stronger claim than it first looks. Custom
 * properties inherit downward only, so unprefixed names could never have leaked
 * OUT of `.hatua-root` onto a Host's page — that was never the risk. The risk is
 * the other direction and it is real: in the parts embedding a Host mounts its
 * own markup INSIDE <HatuaProvider> (apps/playground/src/host.tsx does), and a
 * Host wrapper in there reading `var(--accent)` for its own design system used
 * to silently receive ours.
 *
 * The names were unprefixed because they matched the Tumika design system's
 * exactly. That is a coincidence of which handoff we were given, not a property
 * of Hatua — the next design system would not match, and a library embeddable in
 * any Host cannot spend its collision budget on one of them.
 *
 * Component-local properties count too: Toast's --hatua-toast-tone is not a
 * theme alias, but it is still a name Hatua writes into a Host's document.
 */
describe('every custom property is namespaced', () => {
  const named = (text: string) => [
    ...definitionsIn(text),
    ...referencedAliases(text),
    ...quotedAliases(text),
  ]

  it.each(
    sources.filter(
      (f) => f.path !== SELF && f.path !== HOST_TOKENS && !/\.test\.tsx?$/.test(f.path),
    ),
  )('$path defines and reads only --hatua-* properties', ({ text }) => {
    expect(named(text).filter((a) => !a.startsWith(PREFIX))).toEqual([])
  })

  it('exempts only the file that demonstrates the rule, and only while it does', () => {
    // An exemption nobody checks is an exemption that quietly becomes a hole.
    const story = sources.find((f) => f.path === HOST_TOKENS)
    expect(story, HOST_TOKENS).toBeDefined()
    const hostNames = referencedAliases(story?.text ?? '').filter((a) => !a.startsWith(PREFIX))
    expect(hostNames).toContain('--accent')
    expect(hostNames).toContain('--surface-card')
    expect(story?.text).toContain('HatuaProvider')
  })

  it('keeps seeds distinguishable from the aliases derived off them', () => {
    // Rule 1 is only enforceable while this holds.
    const seeds = [...definedAliases].filter((a) => a.startsWith(SEED_PREFIX))
    expect(seeds.length).toBe(0)
    expect(definitionsIn(sources.find((f) => f.path === BASE)?.text ?? '').size).toBeGreaterThan(20)
  })
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

/**
 * One height for every control a value is typed or chosen in.
 *
 * `<Input>`, `<Select>` and the Template input are stacked in one card all over
 * the side panel — a variable is a name box, a type picker and a value box, one
 * under the other — and three files each writing their own number is three
 * numbers that drift. Nothing in the panel survives that: every card in the
 * Workflow tab shows the three heights side by side, one under the next.
 *
 * jsdom has no layout engine, so nothing in the suite can measure a rendered
 * box. What is checkable is the property that makes the numbers agree: each
 * control's own rule takes its height from the token and writes no number.
 */
describe('the controls are one height', () => {
  const HEIGHT = '--hatua-control-height'

  /** The rule that sizes the box, per file that draws one. */
  const CONTROLS = [
    { path: 'src/primitives/Input.module.css', rule: 'input' },
    { path: 'src/primitives/Select.module.css', rule: 'select' },
    { path: 'src/compounds/TemplateInput.module.css', rule: 'box' },
  ]

  /**
   * The declarations of one class's rule, and nothing nested under it.
   *
   * Scoped to the rule rather than searched over the file, because a stylesheet
   * is full of heights that are not the control's: a chevron is 12px, the ⚡
   * button inside the Template input is 32px, and `.tall` is 76px because a
   * `kind: textarea` field asks for a taller box on purpose. Only the box's own
   * rule is this rule's business.
   */
  const ruleFor = (text: string, cls: string): string | null => {
    // Found by scanning lines rather than by building a pattern out of `cls`:
    // a class name is not a regex, and treating one as a pattern is how a `.`
    // in a selector quietly matches something else.
    const opener = `.${cls}`
    const at = text.split('\n').reduce<number>((found, line, index, lines) => {
      if (found !== -1) return found
      if (line.trim().replace(/\s+/g, ' ').replace(' {', '{') !== `${opener}{`) return found
      return lines.slice(0, index).reduce((n, one) => n + one.length + 1, 0)
    }, -1)
    if (at === -1) return null
    const open = text.indexOf('{', at)
    let depth = 0
    for (let i = open; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i)
    }
    return null
  }

  it('defines the height once, in the file that owns the vocabulary', () => {
    const base = sources.find((f) => f.path === BASE)?.text ?? ''
    expect(definitionsIn(base).has(HEIGHT)).toBe(true)
  })

  it.each(CONTROLS)(
    'sizes .$rule in $path from the token, and writes no number',
    ({ path, rule }) => {
      const text = cssFiles.find((f) => f.path === path)?.text
      expect(text, `${path} is not in the scan`).toBeDefined()

      const declarations = ruleFor(text ?? '', rule)
      expect(declarations, `.${rule} is not in ${path}`).not.toBeNull()

      const heights = [
        ...(declarations ?? '').matchAll(/(?:min-)?(?:block-size|height)\s*:\s*([^;]+);/g),
      ].map((match) => (match[1] as string).trim())
      expect(heights).not.toEqual([])
      for (const value of heights) expect(value).toBe(`var(${HEIGHT})`)
    },
  )
})

/**
 * Every class a component reaches for exists in the stylesheet beside it.
 *
 * `styles.invalid` where the CSS defines no `.invalid` is not an error anywhere:
 * the import resolves, the lookup is `undefined`, and `cx` drops it — so the
 * element renders with every other class it asked for and the state is simply
 * not drawn. A card carrying a diagnostic then looks exactly like a healthy one,
 * which is the shape this missed: `<StepList>` gave an invalid row an edge and
 * `<NodeCard>` asked for one that was never written.
 *
 * Read off the authored files for the reason the token rules are: CSS Modules
 * rewrites class names and nothing else, so source and bundle answer this the
 * same way and the check needs no build.
 */
describe('a class a component asks for is a class its stylesheet has', () => {
  /**
   * `styles.foo` and `styles["foo"]`, which are the two spellings in this repo.
   *
   * A component that computed a class name would defeat this, and none does —
   * the point of the rule is that the set is knowable by reading.
   */
  const classesUsedIn = (text: string): string[] => [
    ...new Set(
      [...text.matchAll(/\bstyles(?:\.(\w+)|\[['"](\w+)['"]\])/g)].map(
        (match) => (match[1] ?? match[2]) as string,
      ),
    ),
  ]

  /** A selector this file defines, including one only reached through `composes`. */
  const classesDefinedIn = (text: string): Set<string> =>
    new Set([...text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1] as string))

  const pairs = componentFiles
    .filter((file) => /\.tsx$/.test(file.path) && /from '\.\/[\w.]+\.module\.css'/.test(file.text))
    .map((file) => ({
      component: file.path,
      sheet: file.path.replace(/\.tsx$/, '.module.css'),
      text: file.text,
    }))
    .filter((pair) => cssFiles.some((f) => f.path === pair.sheet))

  it('finds the components to check, so an empty scan cannot pass', () => {
    expect(pairs.length).toBeGreaterThan(10)
  })

  it.each(pairs)('$component uses only classes $sheet defines', ({ sheet, text }) => {
    const defined = classesDefinedIn(cssFiles.find((f) => f.path === sheet)?.text ?? '')
    const missing = classesUsedIn(text).filter((name) => !defined.has(name))
    expect(missing, `${sheet} defines no rule for these`).toEqual([])
  })
})
