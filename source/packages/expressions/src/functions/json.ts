/**
 * The escape hatch for opaque payloads.
 *
 * `json.parse` returns `unknown`, which is what makes
 * `json.parse(s2.output).count` a warning rather than an error at design time —
 * and a run-time type check at the slot boundary instead. Rejecting it would
 * make the function unusable; accepting it silently would hide a real risk.
 */
import type { FunctionImpl } from '../resolve.js'
import { toJson, type Value } from '../value.js'
import { badArgument } from './registry.js'

export const jsonFunctions: Record<string, FunctionImpl> = {
  'json.parse': (args: readonly Value[]): Value => {
    let parsed: Value
    try {
      parsed = JSON.parse(args[0] as string) as Value
    } catch {
      throw badArgument('json.parse', 'value', 'text that is not JSON')
    }
    // `JSON.parse('{"n":1e400}')` yields Infinity, which Go's decoder refuses
    // outright. Refusing it here keeps the two agreeing and keeps Infinity out
    // of a value space defined not to hold it.
    if (hasNonFiniteNumber(parsed))
      throw badArgument('json.parse', 'value', 'a number out of range')
    return parsed
  },

  /** Canonical: object keys sorted, so Go and JavaScript produce one string. */
  'json.stringify': (args: readonly Value[]): Value => toJson(args[0] as Value),
}

function hasNonFiniteNumber(value: Value): boolean {
  if (typeof value === 'number') return !Number.isFinite(value)
  if (Array.isArray(value)) return value.some(hasNonFiniteNumber)
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.values(value as Record<string, Value>).some(hasNonFiniteNumber)
  }
  return false
}
