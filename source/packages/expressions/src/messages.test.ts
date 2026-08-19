import { describe, expect, it } from 'vitest'
import { ExpressionError } from './errors.js'
import { coreFunctions } from './functions/registry.js'
import { resolve } from './resolve.js'
import { validate } from './validate.js'

/**
 * Message *text*, which the conformance corpus deliberately does not assert —
 * it compares codes and severities, so two runtimes can agree on a code while
 * explaining it differently. `errors.ts` says the wording has to match, because
 * a message that reads one way in the builder and another in a runner's logs is
 * a support ticket nobody can close, and these are the cases where the two
 * implementations reach the same code by different routes.
 *
 * The Go half is TestDiagnosticMessagesMatch in sdk/go/expressions.
 */
const FUNCTIONS = coreFunctions()

const messageOf = (template: string, expectedType: 'text' | 'unknown' = 'text'): string => {
  try {
    resolve({ functions: FUNCTIONS }, { name: 'f', template, expectedType })
  } catch (error) {
    if (error instanceof ExpressionError) return error.message
  }
  return 'did not fail'
}

describe('diagnostic messages', () => {
  it('says the same thing about an out-of-range JSON number as Go does', () => {
    // JSON.parse yields Infinity and is caught afterwards; Go's decoder refuses
    // it up front. Different routes, one message.
    expect(messageOf(`{{ json.parse('{"n":1e400}') }}`, 'unknown')).toBe(
      'json.parse cannot accept a number out of range for value.',
    )
  })

  it('and about text that is not JSON at all', () => {
    expect(messageOf(`{{ json.parse('not json') }}`, 'unknown')).toBe(
      'json.parse cannot accept text that is not JSON for value.',
    )
  })

  it('reports an arity range identically at design time and run time', () => {
    const atDesignTime = validate(`{{ text.slice('abc') }}`, 'text', {
      scope: [],
      functions: FUNCTIONS,
    })
    expect(atDesignTime[0]?.message).toBe('text.slice takes 2 to 3 arguments, not 1.')
    expect(messageOf(`{{ text.slice('abc') }}`)).toBe('text.slice takes 2 to 3 arguments, not 1.')
  })

  it('reports a variadic minimum the same way in both phases', () => {
    const atDesignTime = validate('{{ num.min() }}', 'number', { scope: [], functions: FUNCTIONS })
    expect(atDesignTime[0]?.message).toBe('num.min takes at least 1 arguments, not 0.')
  })
})
