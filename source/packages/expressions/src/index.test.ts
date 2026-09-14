import { describe, expect, it } from 'vitest'
import * as api from './index.js'
import { parseTemplate } from './parse.js'

/**
 * The package's surface, asserted as a set rather than one export at a time.
 *
 * A barrel is the one file where a mistake is invisible: everything here is also
 * reachable by its own path, so dropping a re-export still compiles inside this
 * package and breaks `@hatua/model`, `@hatua/services` and `@hatua/react` at
 * once. This is the test that notices.
 */
describe('@hatua/expressions exports', () => {
  it('exports exactly the surface the rest of the workspace reads', () => {
    expect(Object.keys(api).sort()).toEqual([
      'CORE_FUNCTIONS',
      'CORE_NAMESPACES',
      'DIAGNOSTICS',
      'ExpressionError',
      'ORDERED_TYPES',
      'asText',
      'blocksPublish',
      'canOrder',
      'compareText',
      'coreFunctions',
      'datetimeToText',
      'diagnostic',
      'elementOf',
      'equals',
      'errorsIn',
      'evaluate',
      'formatMessage',
      'hostFunctions',
      'inferType',
      'isReference',
      'isScalar',
      'match',
      'mergeRegistries',
      'numberToText',
      'parseExpression',
      'parseTemplate',
      'pathText',
      'referencePath',
      'referencesIn',
      'renamePath',
      'resolve',
      'resolveAll',
      // biome-ignore lint/security/noSecrets: the name of the rounding helper
      'roundHalfAwayFromZero',
      'satisfies',
      'sourceReference',
      'templateReference',
      'templateToSexp',
      'toJson',
      'toSexp',
      'tryParseTemplate',
      'typeOf',
      'validate',
    ])
  })

  it('re-exports the modules themselves, so a name cannot resolve to something else', () => {
    expect(api.parseTemplate).toBe(parseTemplate)
  })
})
