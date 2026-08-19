/**
 * JSON Schema (draft 2020-12, the subset schemas/ uses) -> zod source text.
 *
 * Deliberately small and explicit rather than a general-purpose converter: we
 * control the input, so an unsupported construct should fail loudly instead of
 * emitting something plausible-but-wrong. A silent mistranslation here is the
 * exact failure the hand-authored schema exists to prevent.
 *
 * Every object property whose subtree contains a `$ref` is emitted as a zod 4
 * getter. That defers evaluation, which means definition order does not matter
 * and self-recursive shapes (a Step containing Steps) need no `z.lazy` and keep
 * full type inference — `z.lazy` would force `ZodType<any>` and silently throw
 * away the types this whole pipeline exists to produce.
 */

/** Keywords this converter understands. Anything else must fail loudly. */
const HANDLED = new Set([
  '$ref',
  '$schema',
  '$id',
  '$defs',
  'title',
  'description',
  'type',
  'enum',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minLength',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'format',
  'pattern',
])

/** Throw on any keyword we would otherwise drop in silence. */
function assertHandled(node) {
  for (const key of Object.keys(node)) {
    if (!HANDLED.has(key)) {
      throw new Error(
        `Unhandled JSON Schema keyword "${key}". Silently dropping it would let Go accept ` +
          `input TypeScript rejects — add support in json-schema-to-zod.js. Node: ` +
          JSON.stringify(node).slice(0, 160),
      )
    }
  }
}

/** A JS string literal. Guards against a value containing a quote or backslash. */
const literal = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** Wrap a description as a JSDoc block at the given indent. */
export function jsdoc(description, indent = '') {
  if (!description) return ''
  if (String(description).includes('*/')) {
    throw new Error('A schema description contains "*/", which would close the JSDoc block early')
  }
  const body = String(description)
    .trim()
    .split('\n')
    .map((line) => `${indent} * ${line}`.trimEnd())
    .join('\n')
  return `${indent}/**\n${body}\n${indent} */\n`
}

/** Does this subtree reference another definition anywhere inside it? */
function containsRef(node) {
  if (!node || typeof node !== 'object') return false
  if (node.$ref) return true
  return Object.values(node).some((v) => (Array.isArray(v) ? v.some(containsRef) : containsRef(v)))
}

function scalar(node) {
  const types = Array.isArray(node.type) ? node.type : [node.type]
  const nullable = types.includes('null')
  const base = types.find((t) => t !== 'null')

  let out
  switch (base) {
    case 'string':
      // The execution schema promises date-time on started_at and friends; a
      // runner handing the Runs view an unparseable timestamp would otherwise
      // pass validation.
      //
      // It used to be assigned over whatever minLength/pattern had built,
      // dropping those constraints without a word. Refusing the combination is
      // the honest version: nothing in schemas/ writes it, and emitting an
      // intersection nobody has exercised is exactly the plausible-but-wrong
      // output this generator is meant not to produce.
      if (node.format === 'date-time') {
        if (node.minLength || node.pattern) {
          throw new Error(
            'Unhandled `format: date-time` combined with minLength/pattern. ' +
              'Add support in json-schema-to-zod.js rather than dropping either.',
          )
        }
        out = 'z.iso.datetime({ offset: true })'
        break
      }
      out = 'z.string()'
      if (node.minLength) out += `.min(${node.minLength})`
      if (node.pattern) out += `.regex(/${node.pattern}/)`
      break
    case 'integer':
      out = 'z.number().int()'
      if (node.minimum !== undefined) out += `.min(${node.minimum})`
      if (node.maximum !== undefined) out += `.max(${node.maximum})`
      break
    case 'number':
      out = 'z.number()'
      if (node.minimum !== undefined) out += `.min(${node.minimum})`
      if (node.maximum !== undefined) out += `.max(${node.maximum})`
      break
    case 'boolean':
      out = 'z.boolean()'
      break
    default:
      return null
  }
  return nullable ? `${out}.nullable()` : out
}

export function toZod(node, indent = '  ') {
  assertHandled(node)
  if (node.$ref) return node.$ref.replace('#/$defs/', '')
  if (node.enum) return `z.enum([${node.enum.map(literal).join(', ')}])`
  if (node.oneOf) return `z.union([${node.oneOf.map((n) => toZod(n, indent)).join(', ')}])`

  const asScalar = scalar(node)
  if (asScalar) return asScalar

  if (node.type === 'array') {
    let out = `z.array(${node.items ? toZod(node.items, indent) : 'z.unknown()'})`
    if (node.minItems !== undefined) out += `.min(${node.minItems})`
    if (node.maxItems !== undefined) out += `.max(${node.maxItems})`
    return out
  }

  if (node.type === 'object') {
    // An open bag: `additionalProperties: true` with nothing declared.
    if (node.additionalProperties === true && !node.properties) {
      return 'z.record(z.string(), z.unknown())'
    }
    // A *schema* for additional properties would need z.record with that value
    // type, and silently emitting `z.object({})` instead would let Go accept
    // input TypeScript rejects — the exact failure ADR-0006 exists to prevent.
    if (node.additionalProperties && typeof node.additionalProperties === 'object') {
      throw new Error(
        'Unhandled `additionalProperties: <schema>`. Add z.record support in ' +
          'json-schema-to-zod.js rather than dropping the constraint.',
      )
    }
    const required = new Set(node.required ?? [])
    const inner = `${indent}  `
    const lines = Object.entries(node.properties ?? {}).map(([key, child]) => {
      const doc = jsdoc(child.description, inner)
      const optional = required.has(key) ? '' : '.optional()'
      const expr = `${toZod(child, inner)}${optional}`
      return containsRef(child)
        ? `${doc}${inner}get ${key}() { return ${expr} },`
        : `${doc}${inner}${key}: ${expr},`
    })
    // z.strictObject rather than z.object().strict(): `.strict()` reads `.shape`
    // eagerly, which fires the getters above and blows up on any self-reference.
    const ctor = node.additionalProperties === false ? 'z.strictObject' : 'z.object'
    return `${ctor}({\n${lines.join('\n')}\n${indent}})`
  }

  // No type and no combinator: a deliberately untyped value, e.g. a step's `output`.
  if (!node.type) return 'z.unknown()'

  throw new Error(`Unsupported schema node: ${JSON.stringify(node).slice(0, 160)}`)
}

const camel = (s) =>
  s.replace(/[^A-Za-z0-9]+(.)/g, (_, c) => c.toUpperCase()).replace(/^(.)/, (c) => c.toLowerCase())
const pascal = (s) => {
  const c = camel(s)
  return c.charAt(0).toUpperCase() + c.slice(1)
}

/**
 * Names that cannot become `export const <name>`.
 *
 * A `$def` called `function` emits syntactically invalid TypeScript, and the
 * formatter that runs afterwards then reports something unrelated about the
 * wreckage. Refusing the name here says what actually went wrong.
 */
const RESERVED = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
])

/** A whole schema document -> a zod module. */
export function generateModule(schema, { sourceFile }) {
  const out = [
    '// GENERATED — do not edit.',
    `// Source: schemas/${sourceFile}`,
    '// Regenerate: pnpm codegen',
    "import { z } from 'zod'",
    '',
  ]

  for (const [name, node] of Object.entries(schema.$defs ?? {})) {
    if (RESERVED.has(name)) {
      throw new Error(
        `${sourceFile}: $def "${name}" is a JavaScript reserved word and cannot be emitted. ` +
          'Rename it in the schema.',
      )
    }
    const doc = jsdoc(node.description).trimEnd()
    if (doc) out.push(doc)
    out.push(`export const ${name} = ${toZod(node)}`)
    out.push(`export type ${pascal(name)} = z.infer<typeof ${name}>`)
    out.push('')
  }

  const rootName = camel(schema.title)
  const rootDoc = jsdoc(schema.description).trimEnd()
  if (rootDoc) out.push(rootDoc)
  out.push(`export const ${rootName} = ${toZod(schema)}`)
  out.push(`export type ${pascal(rootName)} = z.infer<typeof ${rootName}>`)
  out.push('')

  return out.join('\n')
}
