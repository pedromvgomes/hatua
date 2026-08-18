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
    try {
      return JSON.parse(args[0] as string) as Value
    } catch {
      throw badArgument('json.parse', 'value', 'text that is not JSON')
    }
  },

  /** Canonical: object keys sorted, so Go and JavaScript produce one string. */
  'json.stringify': (args: readonly Value[]): Value => toJson(args[0] as Value),
}
