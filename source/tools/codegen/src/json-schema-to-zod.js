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

/** Wrap a description as a JSDoc block at the given indent. */
export function jsdoc(description, indent = '') {
  if (!description) return ''
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
      out = 'z.string()'
      if (node.minLength) out += `.min(${node.minLength})`
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
  if (node.$ref) return node.$ref.replace('#/$defs/', '')
  if (node.enum) return `z.enum([${node.enum.map((v) => `'${v}'`).join(', ')}])`
  if (node.oneOf) return `z.union([${node.oneOf.map((n) => toZod(n, indent)).join(', ')}])`

  const asScalar = scalar(node)
  if (asScalar) return asScalar

  if (node.type === 'array') {
    return `z.array(${node.items ? toZod(node.items, indent) : 'z.unknown()'})`
  }

  if (node.type === 'object') {
    // An open bag: `additionalProperties: true` with nothing declared.
    if (node.additionalProperties === true && !node.properties) {
      return 'z.record(z.string(), z.unknown())'
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

/** A whole schema document -> a zod module. */
export function generateModule(schema, { sourceFile }) {
  const out = [
    '// GENERATED — do not edit.',
    `// Source: schemas/${sourceFile}`,
    '// Regenerate: pnpm --filter @hatua/codegen build',
    "import { z } from 'zod'",
    '',
  ]

  for (const [name, node] of Object.entries(schema.$defs ?? {})) {
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
