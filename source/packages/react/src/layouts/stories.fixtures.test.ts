/** biome-ignore-all lint/correctness/noNodejsModules: a Node test reading story sources from disk; nothing here ships to a browser. */
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseWorkflow } from '@hatua/document'
import { describe, expect, it } from 'vitest'

/**
 * Every Workflow Definition a story hands a region has to project.
 *
 * A story fixture is the only document in the repo nothing executes: Storybook
 * renders it by hand and no test mounts it, so a fixture that stops satisfying
 * the schema does not fail — the region simply falls back to the state it shows
 * a Host that wired nothing up, and every story quietly draws the wrong screen.
 * That is invisible in review precisely because the file still compiles.
 *
 * A field added to the schema is what makes this reachable: it lands in the
 * fixtures under test and in the fixtures under `stories`, and only the first
 * set has anything watching it.
 *
 * Through `@hatua/document` rather than the schema directly, because that is the
 * path a region's document actually takes — the editing store parses the Host's
 * text and hands the region `projection.success ? projection.data : null`, and
 * `null` is what draws the wrong screen. A test-only dependency: nothing under
 * `src/` outside this file imports it, and the layering rule in this
 * directory's README still stands.
 */

/**
 * Every directory whose stories may hold a Workflow Definition.
 *
 * Named rather than globbed from the package root: a glob that stops matching
 * is a guard that silently protects nothing, and the count assertion below is
 * what makes a directory that has moved a failure instead of a pass. `units`
 * is here because the canvas's units are handed Steps rather than documents
 * today — the moment one of them holds YAML, it is already covered.
 */
const STORY_DIRS = [import.meta.dirname, resolve(import.meta.dirname, '..', 'units')]

/**
 * Template literals holding a workflow document, by the one marker every one of
 * them carries: a top-level `id:` before any nesting. Narrow on purpose — a
 * story may hold YAML that is a manifest or a fragment, and neither is this
 * schema's to judge.
 */
function documentsIn(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(/`([^`]*)`/g)) {
    const body = unescaped(match[1] ?? '')
    if (/^(?:#[^\n]*\n|\s*\n)*id:\s*\S/.test(body)) found.push(body)
  }
  return found
}

/**
 * What the compiler would have made of the literal.
 *
 * Read from source rather than from the module, so the escapes are still text:
 * a fixture written `id: wf\nsteps: []` holds two characters where the running
 * story holds a newline, and feeding that to a YAML parser fails for a reason
 * that has nothing to do with the fixture. One pass, so a literal backslash
 * cannot be re-read as the start of the next escape.
 */
const unescaped = (body: string): string =>
  body.replace(/\\([nrt\\`$])/g, (_, char: string) =>
    char === 'n' ? '\n' : char === 'r' ? '\r' : char === 't' ? '\t' : char,
  )

describe('story fixtures', () => {
  const files = STORY_DIRS.flatMap((dir) => {
    const found = readdirSync(dir).filter((name) => name.endsWith('.stories.tsx'))
    // Per directory, not over the total: a directory that has been renamed
    // contributes nothing and the total stays healthy on the strength of the
    // other one, which is the check passing while covering half of what it names.
    expect(found.length, `no stories under ${dir}`).toBeGreaterThan(0)
    return found.map((name) => join(dir, name))
  })

  const documents = files.flatMap((file) =>
    documentsIn(readFileSync(file, 'utf8')).map(
      (source, index) => [`${basename(file)} · document ${index + 1}`, source] as const,
    ),
  )

  // A guard that found nothing is a guard that protects nothing.
  it('finds the documents the stories hold', () => {
    expect(documents.length).toBeGreaterThan(0)
  })

  for (const [name, source] of documents) {
    it(`${name} projects`, () => {
      const projected = parseWorkflow(source).validate()
      expect(projected.error?.issues).toBeUndefined()
      expect(projected.success).toBe(true)
    })
  }
})
