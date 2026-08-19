/**
 * Joins class names, dropping anything falsy.
 *
 * CSS Modules types every lookup as `string | undefined` under
 * `noUncheckedIndexedAccess`, and variant lookups are exactly that shape, so
 * every primitive needs this. Kept here rather than pulled from `clsx`: it is
 * four lines, and a primitive tier that carries no domain knowledge should not
 * carry dependencies either.
 */
export const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ')
