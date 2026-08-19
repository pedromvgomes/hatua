/**
 * Instants. RFC 3339 only — there are no free-form format strings in v1,
 * because a format string is a second language to keep two implementations
 * agreeing on, and nothing so far needs one.
 */
import type { EvaluationContext, FunctionImpl } from '../resolve.js'
import { datetimeToText, roundHalfAwayFromZero, type Value } from '../value.js'
import { badArgument } from './registry.js'

/**
 * Strict RFC 3339. `Date.parse` accepts a great deal more than this — bare
 * dates, RFC 2822, implementation-defined formats — while Go's parser accepts
 * exactly this, so the strictness has to be written down rather than inherited.
 */
const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/

/** The range a Date can represent: ±100,000,000 days from the epoch. */
const MAX_INSTANT_MS = 8.64e15

/** Days per month, indexed from January. February is decided by the year. */
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

/** Whether the written year-month-day is a day that exists. */
function isRealDate(text: string): boolean {
  const year = Number(text.slice(0, 4))
  const month = Number(text.slice(5, 7))
  const day = Number(text.slice(8, 10))

  if (month < 1 || month > 12) return false
  const length = month === 2 && isLeapYear(year) ? 29 : (MONTH_LENGTHS[month - 1] as number)
  return day >= 1 && day <= length
}

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

    // `Date.parse` rolls an impossible day forward rather than refusing it, so
    // `2026-02-30` becomes 2 March — a date the user never wrote — while Go
    // says "day out of range". The regex only ever checked the *shape* of the
    // digits, so the calendar has to be checked separately.
    //
    // Against the *written* date, never against the parsed instant's UTC date:
    // comparing with `getUTCDate()` looked equivalent and refused every
    // timestamp whose offset crosses midnight, so `2026-01-01T02:00:00+05:00`
    // failed here and parsed fine in Go.
    if (!isRealDate(text)) throw badArgument('dt.parse', 'value', text)
    return new Date(milliseconds)
  },

  'dt.iso': (args: readonly Value[]): Value => datetimeToText(args[0] as Date),

  'dt.add': (args: readonly Value[]): Value => {
    const [value, amount, unit] = args as [Date, number, string]
    const factor = unitFactor(unit, 'dt.add')
    // Half away from zero, like Go's math.Round — `Math.round` would send every
    // negative half the other way.
    const shifted = value.getTime() + roundHalfAwayFromZero(amount * factor)
    // A Date beyond ±100,000,000 days from the epoch is `Invalid Date`, which
    // is still `instanceof Date` and so satisfies a `datetime` slot — a value
    // that renders as nothing and compares as neither. Go refuses the same
    // shift outright, so this does too.
    if (!Number.isFinite(shifted) || Math.abs(shifted) > MAX_INSTANT_MS) {
      throw badArgument('dt.add', 'amount', String(amount))
    }
    return new Date(shifted)
  },

  /** Whole units, truncated toward zero — never rounded, in either language. */
  'dt.diff': (args: readonly Value[]): Value => {
    const [a, b, unit] = args as [Date, Date, string]
    const factor = unitFactor(unit, 'dt.diff')
    return Math.trunc((a.getTime() - b.getTime()) / factor)
  },
}
