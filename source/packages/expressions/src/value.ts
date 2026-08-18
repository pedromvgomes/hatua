/**
 * The value space.
 *
 * Two rules make everything else in this package tractable, and both are
 * pinned by ADR-0009:
 *
 *   - There is exactly one absent value, `null`. A missing key yields it, and
 *     reading a property of it yields it again. Nothing here ever produces
 *     `undefined`.
 *   - There is one numeric type and it is a 64-bit float, so `7 / 2` is 3.5 in
 *     both languages. Go must never reach for `int`.
 *
 * `NaN` and `Infinity` are not in the space at all: division by zero is an
 * error rather than a value, which is what keeps them out.
 */

/**
 * Every type a value or a declaration can name.
 *
 * The first seven are the Component Manifest's own output types, so a field's
 * declared type and an expression's type are drawn from one vocabulary rather
 * than two that have to be mapped. `unknown` and `null` exist only here.
 */
export type ValueType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'list'
  | 'object'
  | 'item'
  | 'unknown'
  | 'null'

export type Value =
  | string
  | number
  | boolean
  | Date
  | readonly Value[]
  | { readonly [key: string]: Value }
  | null

/** The runtime type of a value, in the same vocabulary a manifest declares. */
export function typeOf(value: Value): ValueType {
  if (value === null) return 'null'
  if (typeof value === 'string') return 'text'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (value instanceof Date) return 'datetime'
  if (Array.isArray(value)) return 'list'
  return 'object'
}

/**
 * Whether a value satisfies a declared type.
 *
 * Coercion at the boundary is narrow and declared, so "must match" has a
 * precise meaning:
 *
 *   - any scalar into `text` is permitted — a `text` field is the universal
 *     sink, and that is exactly what interpolation already does;
 *   - `text` into `number` is *not* implicit; it requires `num.parse()`;
 *   - `null` satisfies any declared type. Whether absence is *acceptable* is
 *     `req:`'s business, not the evaluator's;
 *   - everything else must match exactly.
 */
export function satisfies(value: Value, declared: ValueType): boolean {
  if (declared === 'unknown' || declared === 'item') return true
  if (value === null) return true

  const actual = typeOf(value)
  if (actual === declared) return true
  if (declared === 'text') return isScalar(actual)
  return false
}

export function isScalar(type: ValueType): boolean {
  return type === 'text' || type === 'number' || type === 'boolean' || type === 'datetime'
}

/**
 * Render a value as text at a `text` boundary.
 *
 * Numbers go through the ECMAScript `Number::toString` algorithm, which Go does
 * not implement — `String(1e-6)` is `"0.000001"` in JavaScript and `"1e-06"` in
 * Go. TypeScript gets it for free; the Go side ports it. A workflow that emails
 * a number must not read differently depending on which runner sent it.
 */
export function asText(value: Value): string {
  if (value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return numberToText(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof Date) return datetimeToText(value)
  return toJson(value)
}

/**
 * RFC 3339 in UTC, with a fractional part only when there is one.
 *
 * `Date.toISOString()` always writes three decimal places and Go's RFC3339Nano
 * writes none for a whole second, so neither language's default would do. This
 * spelling is Go's, and TypeScript is the one that has to be told.
 *
 * Instants carry millisecond precision, which is what `Date` can hold; the Go
 * side truncates to match rather than quietly keeping nanoseconds one runner
 * would print and the other could not.
 */
export function datetimeToText(value: Date): string {
  return value.toISOString().replace(/\.(\d*?)0*Z$/, (_whole, digits: string) =>
    digits === '' ? 'Z' : `.${digits}Z`,
  )
}

/**
 * Canonical JSON — what `json.stringify` produces.
 *
 * Hand-rolled in both languages rather than reaching for the built-in, because
 * the two built-ins disagree in ways that would reach a user: Go sorts object
 * keys and JavaScript preserves insertion order, Go escapes `<` and `&` by
 * default, and each formats numbers its own way. Sorting keys in both is the
 * only choice that can be made identical, so both sort.
 */
export function toJson(value: Value): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return jsonString(value)
  if (typeof value === 'number') return numberToText(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof Date) return jsonString(datetimeToText(value))
  if (Array.isArray(value)) return `[${value.map(toJson).join(',')}]`

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${jsonString(key)}:${toJson((value as Record<string, Value>)[key] as Value)}`)
  return `{${entries.join(',')}}`
}

const JSON_ESCAPES: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
}

function jsonString(value: string): string {
  const escaped = value.replace(/["\\\u0000-\u001f]/g, (char) => {
    const known = JSON_ESCAPES[char]
    if (known) return known
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  })
  return `"${escaped}"`
}

/** ECMAScript `Number::toString`. Named so the Go port has something to point at. */
export function numberToText(value: number): string {
  return String(value)
}
