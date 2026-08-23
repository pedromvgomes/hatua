/** biome-ignore-all lint/correctness/noNodejsModules: a Node test reading fixtures from disk; nothing here ships to a browser. */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Manifest, WorkflowDefinition } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import type { Diagnostic } from './connections'
import { indexManifests } from './connections'
import { validateDefinition } from './validity'

/**
 * The definition rules, held against the corpus both languages run.
 *
 * `sdk/go/rules_test.go` reads the same files and renders each diagnostic the
 * same way. That is the point: these rules are cross-field and
 * manifest-dependent, none is expressible in JSON Schema, each is implemented
 * once per language, and this corpus is the only thing keeping the two saying
 * the same thing about the same document.
 *
 * Compared as a sorted set, so the two are held to the same diagnostics rather
 * than to the same iteration order — and rendered in full, so a scenario has to
 * state every subject a diagnostic carries rather than quietly not checking one.
 */

const CORPUS = join(import.meta.dirname, '../../../conformance/definition/rules')

interface Expected {
  code: string
  blocks: string
  stepId?: string
  triggerId?: string
  blockId?: string
  fieldKey?: string
}

interface Scenario {
  name: string
  definition: WorkflowDefinition
  manifests?: Manifest[]
  expect: Expected[]
}

/** One diagnostic as one comparable line. Absent subjects render empty. */
const render = (one: Expected | Diagnostic): string =>
  [
    one.code,
    one.blocks,
    one.stepId ?? '',
    one.triggerId ?? '',
    one.blockId ?? '',
    one.fieldKey ?? '',
  ].join('|')

describe('conformance · definition rules', () => {
  const files = readdirSync(CORPUS).filter((name) => name.endsWith('.yaml'))
  expect(files.length).toBeGreaterThan(0)

  for (const file of files) {
    const corpus = parse(readFileSync(join(CORPUS, file), 'utf8'))
    const shared: Manifest[] = corpus.manifests ?? []

    describe(file, () => {
      for (const scenario of corpus.scenarios as Scenario[]) {
        it(scenario.name, () => {
          const manifests = indexManifests(scenario.manifests ?? shared)
          const found = validateDefinition(scenario.definition, manifests).all

          // Codes first: when the sets differ, that is the readable failure.
          expect(found.map((one) => one.code).sort()).toEqual(
            scenario.expect.map((one) => one.code).sort(),
          )
          expect(found.map(render).sort()).toEqual(scenario.expect.map(render).sort())
        })
      }
    })
  }
})
