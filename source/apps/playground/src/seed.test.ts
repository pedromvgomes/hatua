/** biome-ignore-all lint/correctness/noNodejsModules: a Node test reading the catalogue from disk; the playground's own code never does. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { coreFunctions, validate } from '@hatua/expressions'
import { indexManifests, scopeFor, validateDefinition } from '@hatua/model'
import type { Manifest, WorkflowDefinition } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { ESTABLISHED } from './connections'
import { SEED } from './workflow-store'

/**
 * The seed workflow, held against the catalogue the playground actually serves.
 *
 * This is the layer the conformance corpus cannot reach. The corpus supplies its
 * own manifests per scenario, so a rename in `conformance/manifest/catalogue.yaml`
 * — a field key, an output's type — leaves every scenario green while the first
 * screen a person sees fills with markers. The loop below is what stands between
 * a catalogue rename and a seed nobody notices has stopped matching it.
 *
 * Two assertions rather than one. "Nothing is reported" catches the rename;
 * "`item` resolves to the element the source declared" catches the quieter
 * failure, where `t: item` goes unresolved, the checker treats it as matching
 * everything, and a wrong path type-checks clean.
 */

const CATALOGUE: Manifest[] = parse(
  readFileSync(
    fileURLToPath(new URL('../../../conformance/manifest/catalogue.yaml', import.meta.url)),
    'utf8',
  ),
).components

const seed = (): WorkflowDefinition => parse(SEED)

describe('the seed workflow', () => {
  /*
   * The exact set rather than "nothing", because the seed is not meant to be
   * clean: s1's connection is left empty on purpose, so the Flow tab has a
   * marker to show on the first screen anyone sees. Pinning the set catches a
   * diagnostic appearing AND the deliberate one going away, where a count or a
   * "nothing new" check would miss one of the two.
   */
  it('reports exactly the one problem it is seeded with, against the catalogue it serves', () => {
    const found = validateDefinition(seed(), indexManifests(CATALOGUE)).all
    expect(found.map((one) => `${one.code} on ${one.stepId ?? one.triggerId ?? ''}`)).toEqual([
      'FIELD_REQUIRED on s1',
    ])
  })

  it('resolves its loop’s `item` to the element its list declares', () => {
    const scope = scopeFor(seed(), { board: null, id: 's5' }, CATALOGUE)
    const context = { scope, functions: coreFunctions() }

    expect(validate('{{ steps.s4.item.filename }}', 'text', context)).toEqual([])
    // The gate is on, rather than switched off by an unresolved `item`: a text
    // member is refused where a number is declared, and a member nothing
    // declares is not silently accepted.
    expect(validate('{{ steps.s4.item.filename }}', 'number', context)).not.toEqual([])
    expect(validate('{{ steps.s4.item.bytes }}', 'number', context)).toEqual([])
  })
})

describe('the seed against the Connections the Host serves', () => {
  /*
   * The seed's own comment says `cx_9f2a` is "a handle the Host's connection
   * port actually serves", and that is only true of a page that wires the port.
   * Without one, nothing describes the ref: every `conn` field then reads the
   * Connection as being of unknown type and offers it whatever type it asks
   * for, so a Model picker lists a mailbox.
   */
  it('declares only refs the connection port serves', () => {
    const doc = parse(SEED) as WorkflowDefinition
    const served = new Set(ESTABLISHED.map((connection) => connection.ref))

    for (const connection of doc.connections ?? []) {
      expect(connection.ref, `${connection.id} points at a ref nothing serves`).toBeDefined()
      expect(served, `${connection.id}`).toContain(connection.ref)
    }
  })
})
