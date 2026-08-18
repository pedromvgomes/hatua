import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { ExpressionError } from './errors.js'
import { parseExpression, parseTemplate } from './parse.js'
import { templateToSexp, toSexp } from './sexp.js'

/**
 * The TypeScript half of the shared expression corpus.
 *
 * `sdk/go/expressions/conformance_test.go` loads the same files. A scenario
 * counted by one harness and skipped by the other is exactly the divergence
 * this corpus exists to catch, so both write their tally where
 * `tools/expression/harness` can compare them.
 */

const CORPUS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../conformance/expression',
)

interface ParseScenario {
  name: string
  expr?: string
  template?: string
  sexp?: string
  error?: string
  offsets?: boolean
}

let counted = 0

function scenariosIn<T>(kind: string): { file: string; scenarios: T[] }[] {
  const dir = path.join(CORPUS, kind)
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.yaml'))
    .sort()

  // A directory matching nothing would make every subtest vacuously pass.
  if (files.length === 0) throw new Error(`no scenarios in conformance/expression/${kind}`)

  return files.map((file) => {
    const doc = parseYaml(fs.readFileSync(path.join(dir, file), 'utf8'))
    const scenarios = (doc?.scenarios ?? []) as T[]
    if (scenarios.length === 0) throw new Error(`${kind}/${file} declares no scenarios`)
    return { file, scenarios }
  })
}

describe('conformance · parse', () => {
  for (const { file, scenarios } of scenariosIn<ParseScenario>('parse')) {
    describe(file, () => {
      for (const scenario of scenarios) {
        counted += 1
        it(scenario.name, () => {
          const options = { offsets: scenario.offsets === true }

          if (scenario.error !== undefined) {
            let thrown: unknown
            try {
              render(scenario, options)
            } catch (error) {
              thrown = error
            }
            expect(thrown, 'expected this to be refused').toBeInstanceOf(ExpressionError)
            expect((thrown as ExpressionError).code).toBe(scenario.error)
            return
          }

          expect(render(scenario, options)).toBe(scenario.sexp)
        })
      }
    })
  }
})

function render(scenario: ParseScenario, options: { offsets: boolean }): string {
  if (scenario.template !== undefined) {
    return templateToSexp(parseTemplate(scenario.template), options)
  }
  if (scenario.expr !== undefined) return toSexp(parseExpression(scenario.expr), options)
  throw new Error(`${scenario.name}: needs either \`expr\` or \`template\``)
}

afterAll(() => {
  const file = process.env.HATUA_SCENARIO_COUNT_FILE
  if (file) fs.writeFileSync(file, JSON.stringify({ language: 'ts', scenarios: counted }), 'utf8')
})
