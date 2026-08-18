/**
 * Instants. RFC 3339 only — there are no free-form format strings in v1,
 * because a format string is a second language to keep two implementations
 * agreeing on, and nothing so far needs one.
 */
import type { EvaluationContext, FunctionImpl } from '../resolve.js'
import { datetimeToText, type Value } from '../value.js'
import { badArgument } from './registry.js'

/**
 * Strict RFC 3339. `Date.parse` accepts a great deal more than this — bare
 * dates, RFC 2822, implementation-defined formats — while Go's parser accepts
 * exactly this, so the strictness has to be written down rather than inherited.
 */
const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/

const UNITS: Record<string, number> = {
  seconds: 1000,
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
}

function unitFactor(name: string, qualified: string): number {
  const factor = UNITS[name]
  if (factor === undefined) throw badArgument(qualified, 'unit', name)
  return factor
}

export const dtFunctions: Record<string, FunctionImpl> = {
  /**
   * The clock is supplied by the caller and never read from the system.
   *
   * A system clock makes `dt.now()` unfixturable, and worse, lets two steps in
   * one run disagree about when "now" was.
   */
  'dt.now': (_args: readonly Value[], context: EvaluationContext): Value => {
    if (!context.now) throw badArgument('dt.now', 'clock', 'no clock in the context')
    return new Date(context.now.getTime())
  },

  'dt.parse': (args: readonly Value[]): Value => {
    const text = args[0] as string
    const milliseconds = Date.parse(text)
    if (!RFC3339.test(text) || Number.isNaN(milliseconds)) {
      throw badArgument('dt.parse', 'value', text)
    }
    return new Date(milliseconds)
  },

  'dt.iso': (args: readonly Value[]): Value => datetimeToText(args[0] as Date),

  'dt.add': (args: readonly Value[]): Value => {
    const [value, amount, unit] = args as [Date, number, string]
    const factor = unitFactor(unit, 'dt.add')
    return new Date(value.getTime() + Math.round(amount * factor))
  },

  /** Whole units, truncated toward zero — never rounded, in either language. */
  'dt.diff': (args: readonly Value[]): Value => {
    const [a, b, unit] = args as [Date, Date, string]
    const factor = unitFactor(unit, 'dt.diff')
    return Math.trunc((a.getTime() - b.getTime()) / factor)
  },
}
