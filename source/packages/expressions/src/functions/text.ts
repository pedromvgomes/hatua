/**
 * Strings.
 *
 * Case mapping is full Unicode and language-neutral. `upper("ß")` is `"SS"` and
 * `lower("İ")` is two code points, in both languages — Go needs
 * `golang.org/x/text/cases` to agree with what ECMAScript does for free, and
 * that dependency exists for this and nothing else.
 *
 * Lengths and offsets are counted in code points, not UTF-16 units and not
 * bytes, because those are the two units the two languages would otherwise
 * default to.
 */
import type { FunctionImpl } from '../resolve.js'
import { asText, type Value } from '../value.js'

/** JavaScript indexes by UTF-16 unit; Go by byte. Neither is what we mean. */
const points = (value: string): string[] => Array.from(value)

/** JavaScript's `Array.slice` semantics, spelled out so Go can copy them. */
function sliceRange(length: number, start: number, end: number | null): [number, number] {
  const from = clamp(start < 0 ? length + start : start, length)
  const to = end === null ? length : clamp(end < 0 ? length + end : end, length)
  return [from, Math.max(from, to)]
}

const clamp = (index: number, length: number): number =>
  Math.min(Math.max(Math.trunc(index), 0), length)

export const textFunctions: Record<string, FunctionImpl> = {
  'text.upper': (args: readonly Value[]): Value => (args[0] as string).toUpperCase(),
  'text.lower': (args: readonly Value[]): Value => (args[0] as string).toLowerCase(),
  'text.trim': (args: readonly Value[]): Value => (args[0] as string).trim(),

  /** The concatenation primitive, because `+` is numeric only. */
  'text.concat': (args: readonly Value[]): Value => args.map((arg) => arg as string).join(''),

  'text.split': (args: readonly Value[]): Value => {
    const [value, separator] = args as [string, string]
    return (separator === '' ? points(value) : value.split(separator)) as Value
  },

  'text.join': (args: readonly Value[]): Value => {
    const [values, separator] = args as [readonly Value[], string]
    return values.map(asText).join(separator)
  },

  'text.replace': (args: readonly Value[]): Value => {
    const [value, search, replacement] = args as [string, string, string]
    return search === '' ? value : value.split(search).join(replacement)
  },

  'text.contains': (args: readonly Value[]): Value => {
    const [value, search] = args as [string, string]
    return value.includes(search)
  },

  'text.starts_with': (args: readonly Value[]): Value => {
    const [value, prefix] = args as [string, string]
    return value.startsWith(prefix)
  },

  'text.ends_with': (args: readonly Value[]): Value => {
    const [value, suffix] = args as [string, string]
    return value.endsWith(suffix)
  },

  'text.slice': (args: readonly Value[]): Value => {
    const [value, start, end] = args as [string, number, number | undefined]
    const chars = points(value)
    const [from, to] = sliceRange(chars.length, start, end === undefined ? null : end)
    return chars.slice(from, to).join('')
  },

  'text.len': (args: readonly Value[]): Value => points(args[0] as string).length,
}
