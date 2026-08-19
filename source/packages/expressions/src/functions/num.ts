/**
 * Numbers. There is one numeric type and it is a 64-bit float, so nothing here
 * has an integer path to disagree about.
 */
import type { FunctionImpl } from '../resolve.js'
import type { Value } from '../value.js'
import { badArgument } from './registry.js'

/** What `num.parse` accepts. Deliberately the same shape the grammar accepts. */
const NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/

export const numFunctions: Record<string, FunctionImpl> = {
  /**
   * Half away from zero.
   *
   * `Math.round(-0.5)` is `-0` in JavaScript and `math.Round(-0.5)` is `-1` in
   * Go: JavaScript rounds halves toward *positive infinity*, which is the only
   * place the two disagree. So the fix is to reflect negatives and let
   * `Math.round` do the work, rather than to reimplement rounding.
   *
   * `sign(v) * floor(abs(v) + 0.5)` is the idiom that looks right and is not:
   * `0.49999999999999994 + 0.5` is exactly `1` in IEEE-754, so it rounds a
   * number *below* a half up.
   */
  'num.round': (args: readonly Value[]): Value => {
    const value = args[0] as number
    return value < 0 ? -Math.round(-value) : Math.round(value)
  },

  'num.floor': (args: readonly Value[]): Value => Math.floor(args[0] as number),
  'num.ceil': (args: readonly Value[]): Value => Math.ceil(args[0] as number),
  'num.abs': (args: readonly Value[]): Value => Math.abs(args[0] as number),
  'num.min': (args: readonly Value[]): Value => Math.min(...(args as number[])),
  'num.max': (args: readonly Value[]): Value => Math.max(...(args as number[])),

  /** The only text-to-number conversion there is; none is implicit. */
  'num.parse': (args: readonly Value[]): Value => {
    const text = (args[0] as string).trim()
    if (!NUMBER.test(text)) throw badArgument('num.parse', 'value', text)
    const value = Number(text)
    // Well-formed but out of range: Infinity here, ErrRange in Go.
    if (!Number.isFinite(value)) throw badArgument('num.parse', 'value', text)
    return value
  },
}
