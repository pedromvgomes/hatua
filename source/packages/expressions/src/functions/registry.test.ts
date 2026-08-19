import { describe, expect, it } from 'vitest'
import { CORE_FUNCTIONS } from '#generated/builtins.js'
import { ExpressionError } from '../errors.js'
import { coreFunctions, hostFunctions, mergeRegistries } from './registry.js'

/**
 * Registry construction, which is not expressible as a template scenario: it
 * happens before any expression is evaluated, and it is where a Host's
 * functions meet Hatua's.
 */
describe('coreFunctions', () => {
  it('implements exactly what schemas/functions/*.yaml declares', () => {
    const registry = coreFunctions()
    expect(registry.size).toBe(CORE_FUNCTIONS.length)
    for (const spec of CORE_FUNCTIONS) {
      expect(registry.has(spec.qualified), `${spec.qualified} is declared`).toBe(true)
    }
  })

  it('carries each declaration alongside its implementation', () => {
    const upper = coreFunctions().get('text.upper')
    expect(upper?.spec.returns).toBe('text')
    expect(upper?.spec.params).toHaveLength(1)
  })
})

describe('mergeRegistries', () => {
  it('combines Hatua and Host functions', () => {
    const host = hostFunctions(
      [
        {
          namespace: 'crm',
          name: 'owner',
          qualified: 'crm.owner',
          summary: '',
          params: [],
          returns: 'text',
        },
      ],
      { 'crm.owner': () => 'Dane' },
    )
    const merged = mergeRegistries(coreFunctions(), host)
    expect(merged.has('crm.owner')).toBe(true)
    expect(merged.has('text.upper')).toBe(true)
  })

  it('refuses a collision loudly rather than picking a winner', () => {
    const host = hostFunctions(
      [
        {
          namespace: 'text',
          name: 'upper',
          qualified: 'text.upper',
          summary: '',
          params: [],
          returns: 'text',
        },
      ],
      { 'text.upper': () => 'HOST' },
    )

    let thrown: unknown
    try {
      mergeRegistries(coreFunctions(), host)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ExpressionError)
    expect((thrown as ExpressionError).code).toBe('EXPR_FUNCTION_COLLISION')
  })

  it('refuses a Host declaration with no implementation behind it', () => {
    expect(() =>
      hostFunctions(
        [
          {
            namespace: 'crm',
            name: 'owner',
            qualified: 'crm.owner',
            summary: '',
            params: [],
            returns: 'text',
          },
        ],
        {},
      ),
    ).toThrow(/crm\.owner/)
  })
})
