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
   * Go: JavaScript rounds halves toward positive infinity. Go's spelling is the
   * defensible one — it is symmetric about zero — so this is hand-implemented
   * here and left alone there.
   */
  'num.round': (args: readonly Value[]): Value => {
    const value = args[0] as number
    return Math.sign(value) * Math.floor(Math.abs(value) + 0.5)
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
    return Number(text)
  },
}
