/** biome-ignore-all lint/correctness/noNodejsModules: a Node test reading fixtures from disk; nothing here ships to a browser. */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { componentManifest, workflowDefinition, workflowExecution } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/**
 * The TypeScript half of the shared conformance corpus. `sdk/go` runs the same
 * files against the Go implementation; a fixture passing here and failing there
 * is exactly the divergence this corpus exists to catch.
 *
 * Lives in tools/ rather than in @hatua/schema so that a browser-targeted
 * library never carries Node types — which would let its own source import fs
 * and still typecheck.
 */

const CORPUS = join(import.meta.dirname, '../../../conformance')
const read = (dir: string) =>
  readdirSync(join(CORPUS, dir))
    .filter((f: string) => f.endsWith('.yaml'))
    .map((file: string) => ({ file, source: readFileSync(join(CORPUS, dir, file), 'utf8') }))

describe('conformance · definition/valid', () => {
  for (const { file, source } of read('definition/valid')) {
    it(`accepts ${file}`, () => {
      const result = workflowDefinition.safeParse(parse(source))
      expect(result.error?.issues).toBeUndefined()
      expect(result.success).toBe(true)
    })
  }
})

describe('conformance · definition/invalid', () => {
  for (const { file, source } of read('definition/invalid')) {
    it(`rejects ${file}`, () => {
      // The expectation travels in the fixture, so the two cannot drift apart.
      expect(source).toMatch(/^# expect: SCHEMA_INVALID$/m)
      expect(workflowDefinition.safeParse(parse(source)).success).toBe(false)
    })
  }
})

describe('conformance · execution', () => {
  for (const { file, source } of read('execution')) {
    it(`accepts ${file}`, () => {
      const result = workflowExecution.safeParse(parse(source))
      expect(result.error?.issues).toBeUndefined()
      expect(result.success).toBe(true)
    })
  }
})

describe('conformance · manifest', () => {
  for (const { file, source } of read('manifest')) {
    it(`accepts ${file}`, () => {
      const result = componentManifest.safeParse(parse(source))
      expect(result.error?.issues).toBeUndefined()
      expect(result.success).toBe(true)
    })
  }
})

it('the corpus is not silently empty', () => {
  // A glob that matches nothing would make every suite above vacuously pass.
  expect(read('definition/valid').length).toBeGreaterThan(0)
  expect(read('definition/invalid').length).toBeGreaterThan(0)
})
