import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { ExpressionError } from './errors.js'
import { coreFunctions } from './functions/registry.js'
import { parseExpression, parseTemplate } from './parse.js'
import { type EvaluationContext, resolve, type Slot } from './resolve.js'
import { templateToSexp, toSexp } from './sexp.js'
import { datetimeToText, numberToText, type Value, type ValueType } from './value.js'

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

interface EvalScenario {
  name: string
  template: string
  type?: ValueType
  on_missing?: 'error' | 'null'
  now?: string
  context?: Record<string, unknown>
  value?: unknown
  error?: string
}

let counted = 0

const FUNCTIONS = coreFunctions()

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

describe('conformance · eval', () => {
  for (const { file, scenarios } of scenariosIn<EvalScenario>('eval')) {
    describe(file, () => {
      for (const scenario of scenarios) {
        counted += 1
        it(scenario.name, () => {
          const slot: Slot = {
            name: 'field',
            template: scenario.template,
            expectedType: scenario.type ?? 'text',
          }
          const context: EvaluationContext = {
            ...(decode(scenario.context ?? {}) as EvaluationContext),
            onMissing: scenario.on_missing ?? 'error',
            functions: FUNCTIONS,
            ...(scenario.now ? { now: new Date(scenario.now) } : {}),
          }

          if (scenario.error !== undefined) {
            let thrown: unknown
            try {
              resolve(context, slot)
            } catch (error) {
              thrown = error
            }
            expect(thrown, 'expected this to fail').toBeInstanceOf(ExpressionError)
            expect((thrown as ExpressionError).code).toBe(scenario.error)
            // Every evaluation failure names the slot it happened in: the Host
            // decides what to do about it, and cannot without being told where.
            expect((thrown as ExpressionError).diagnostics[0]?.slot).toBe('field')
            return
          }

          expect(canon(resolve(context, slot))).toBe(canon(decode(scenario.value ?? null) as Value))
        })
      }
    })
  }
})

/** `{ $datetime: … }` is how a scenario writes an instant that YAML cannot. */
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode)
  if (value !== null && typeof value === 'object') {
    const marker = (value as Record<string, unknown>).$datetime
    if (typeof marker === 'string') return new Date(marker)
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, decode(item)]),
    )
  }
  return value
}

/**
 * A canonical rendering, so an expectation compares the same way in both
 * languages. Deliberately not the evaluator's own `equals`: a bug there would
 * then hide itself.
 */
function canon(value: Value): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return numberToText(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (value instanceof Date) return `@${datetimeToText(value)}`
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`

  const object = value as Record<string, Value>
  const entries = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canon(object[key] as Value)}`)
  return `{${entries.join(',')}}`
}

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
