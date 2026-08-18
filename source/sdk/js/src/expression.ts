import { referencePattern } from '@hatua/schema'

/**
 * The expression evaluator — the SDK's reason for existing.
 *
 * DELIBERATELY MINIMAL FOR NOW. This resolves plain `{{path.to.value}}`
 * references and nothing else. The full language — conditionals, functions,
 * the Workato-style data-pill operations — is its own design session, and the
 * conformance corpus is where its semantics get pinned down for TypeScript and
 * Go simultaneously.
 *
 * What matters today is that the seam exists here, in one shared place, rather
 * than being reinvented per Host. An expression that a runner evaluates
 * differently from the builder yields a workflow that looks correct in the
 * editor and misbehaves in production; that is the failure this file prevents.
 */

export interface EvaluationContext {
  /** Step outputs, keyed by step id. */
  steps?: Record<string, unknown>
  /** Trigger payloads, keyed by trigger id — addressed as `triggers.<id>.…`. */
  triggers?: Record<string, unknown>
  /** Workflow variables — addressed as `var.<key>`. */
  var?: Record<string, unknown>
  /** Which trigger fired. Needed when several are declared. */
  TRIGGER?: string
}

/** Walk a dotted path, treating `a[].b` as "that field of each element". */
function resolve(root: unknown, path: string): unknown {
  let current: unknown = root
  for (const rawSegment of path.split('.')) {
    if (current === null || current === undefined) return undefined

    const each = rawSegment.endsWith('[]')
    const segment = each ? rawSegment.slice(0, -2) : rawSegment

    if (segment) {
      if (typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[segment]
    }
    if (each) {
      if (!Array.isArray(current)) return undefined
      // The remaining segments apply to every element.
      const rest = path.slice(path.indexOf(rawSegment) + rawSegment.length + 1)
      return rest ? current.map((item) => resolve(item, rest)) : current
    }
  }
  return current
}

function lookup(context: EvaluationContext, path: string): unknown {
  if (path === 'TRIGGER') return context.TRIGGER

  const [root, ...rest] = path.split('.')
  const tail = rest.join('.')

  if (root === 'triggers') return resolve(context.triggers ?? {}, tail)
  if (root === 'var') return resolve(context.var ?? {}, tail)
  // Anything else is a step id.
  return resolve(context.steps ?? {}, path)
}

/**
 * Substitute every reference in a value.
 *
 * A string that is exactly one reference returns the referenced value with its
 * type intact — `{{s2.count}}` yields the number 24, not the string "24".
 * Anything else interpolates, because mixed text can only be a string.
 */
export function evaluate(value: string, context: EvaluationContext): unknown {
  const whole = value.match(/^\{\{([^}]+)\}\}$/)
  if (whole?.[1]) return lookup(context, whole[1].trim())

  return value.replace(referencePattern(), (_match, path: string) => {
    const resolved = lookup(context, path.trim())
    if (resolved === undefined || resolved === null) return ''
    return typeof resolved === 'object' ? JSON.stringify(resolved) : String(resolved)
  })
}
