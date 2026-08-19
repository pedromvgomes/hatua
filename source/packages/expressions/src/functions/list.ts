/**
 * Lists.
 *
 * There are no lambdas in v1, so no `filter` and no `map`: closures mean
 * implementing scoping and capture twice, and getting them subtly different is
 * the failure this whole package exists to prevent. `[]` projection and
 * `core.for_each` cover the common cases; nothing in the grammar blocks adding
 * them later.
 */
import { equals, type FunctionImpl } from '../resolve.js'
import { asText, compareText, isScalar, typeOf, type Value, type ValueType } from '../value.js'
import { badArgument } from './registry.js'

const clamp = (index: number, length: number): number =>
  Math.min(Math.max(Math.trunc(index), 0), length)

function sliceRange(length: number, start: number, end: number | null): [number, number] {
  const from = clamp(start < 0 ? length + start : start, length)
  const to = end === null ? length : clamp(end < 0 ? length + end : end, length)
  return [from, Math.max(from, to)]
}

const ORDERED: readonly ValueType[] = ['number', 'text', 'datetime']

export const listFunctions: Record<string, FunctionImpl> = {
  'list.len': (args: readonly Value[]): Value => (args[0] as readonly Value[]).length,

  /** Null when empty, which is the one absent value rather than an error. */
  'list.first': (args: readonly Value[]): Value => (args[0] as readonly Value[])[0] ?? null,
  'list.last': (args: readonly Value[]): Value => (args[0] as readonly Value[]).at(-1) ?? null,

  'list.slice': (args: readonly Value[]): Value => {
    const [value, start, end] = args as [readonly Value[], number, number | undefined]
    const [from, to] = sliceRange(value.length, start, end === undefined ? null : end)
    return value.slice(from, to)
  },

  /** By the same rule as `==`: total, and never coercing. */
  'list.contains': (args: readonly Value[]): Value => {
    const [value, needle] = args as [readonly Value[], Value]
    return value.some((item) => equals(item, needle))
  },

  'list.join': (args: readonly Value[]): Value => {
    const [value, separator] = args as [readonly Value[], string]
    return value
      .map((item) => {
        if (item !== null && !isScalar(typeOf(item))) {
          throw badArgument('list.join', 'value', `a list of ${typeOf(item)}`)
        }
        return asText(item)
      })
      .join(separator)
  },

  'list.unique': (args: readonly Value[]): Value => {
    const out: Value[] = []
    for (const item of args[0] as readonly Value[]) {
      if (!out.some((kept) => equals(kept, item))) out.push(item)
    }
    return out
  },

  /**
   * Ascending, and every element must be the same ordered type.
   *
   * A mixed list has no defensible ordering, and inventing one — nulls first,
   * numbers before text — would be a rule nobody could derive from anywhere
   * else in the language.
   */
  'list.sort': (args: readonly Value[]): Value => {
    const value = args[0] as readonly Value[]
    if (value.length === 0) return []

    const type = typeOf(value[0] as Value)
    if (!ORDERED.includes(type)) throw badArgument('list.sort', 'value', `a list of ${type}`)
    if (value.some((item) => typeOf(item) !== type)) {
      throw badArgument('list.sort', 'value', 'a list of mixed types')
    }

    // Text sorts by code point, which is what Go's byte-wise comparison of
    // UTF-8 gives. JavaScript's own `<` compares UTF-16 code units and would
    // order a surrogate pair against U+E000..U+FFFF the other way round.
    if (type === 'text') return [...value].sort((a, b) => compareText(a as string, b as string))

    const key = (item: Value): number =>
      type === 'datetime' ? (item as Date).getTime() : (item as number)

    return [...value].sort((a, b) => {
      const left = key(a)
      const right = key(b)
      return left < right ? -1 : left > right ? 1 : 0
    })
  },
}
