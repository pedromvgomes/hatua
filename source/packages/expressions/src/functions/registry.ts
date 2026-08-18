/**
 * Registries are built by explicit construction, never by module-level
 * `register()` side effects.
 *
 * Import-for-effect makes `sideEffects: false` a lie: a bundler can no longer
 * drop a built-in nobody calls, so every Host embedding the builder carries all
 * thirty-four implementations whether or not its manifests use one — and there
 * is nothing to warn you, because the import *looks* unused.
 */
import { CORE_FUNCTIONS, type FunctionSpec } from '#generated/builtins.js'
import { diagnostic, ExpressionError } from '../errors.js'
import type { FunctionImpl, FunctionRegistry, RegisteredFunction } from '../resolve.js'
import type { Value } from '../value.js'
import { dtFunctions } from './dt.js'
import { jsonFunctions } from './json.js'
import { listFunctions } from './list.js'
import { numFunctions } from './num.js'
import { textFunctions } from './text.js'

/** A well-typed argument that is nonetheless unusable. */
export function badArgument(name: string, param: string, actual: string): ExpressionError {
  return new ExpressionError([diagnostic('EVAL_BAD_ARGUMENT', 0, { name, param, actual })])
}

/**
 * Hatua's own functions, checked against the declaration.
 *
 * The check is the point of decision 9: each language supplies implementations
 * only, and verifies its registry against the shared YAML at load time. A
 * function implemented here and not declared — or declared and not implemented
 * — is a divergence between the two runtimes waiting to happen, and it fails
 * here rather than at the call site in production.
 */
export function coreFunctions(): FunctionRegistry {
  const implementations: Record<string, FunctionImpl> = {
    ...dtFunctions,
    ...textFunctions,
    ...numFunctions,
    ...listFunctions,
    ...jsonFunctions,
  }

  const registry = new Map<string, RegisteredFunction>()
  const missing: string[] = []

  for (const spec of CORE_FUNCTIONS) {
    const impl = implementations[spec.qualified]
    if (!impl) {
      missing.push(spec.qualified)
      continue
    }
    registry.set(spec.qualified, { spec, impl })
  }

  const undeclared = Object.keys(implementations).filter((name) => !registry.has(name))

  if (missing.length > 0 || undeclared.length > 0) {
    throw new Error(
      [
        'the function registry disagrees with schemas/functions/*.yaml:',
        ...missing.map((name) => `  declared but not implemented: ${name}`),
        ...undeclared.map((name) => `  implemented but not declared: ${name}`),
      ].join('\n'),
    )
  }

  return registry
}

/**
 * Merge a Host's functions into Hatua's.
 *
 * A collision is a loud error rather than a silent winner. Either answer —
 * Hatua wins, or the Host wins — is a workflow that behaves differently
 * depending on which registry was built first, and neither is discoverable from
 * the workflow.
 */
export function mergeRegistries(...registries: readonly FunctionRegistry[]): FunctionRegistry {
  const merged = new Map<string, RegisteredFunction>()

  for (const registry of registries) {
    for (const [name, entry] of registry) {
      if (merged.has(name)) {
        throw new ExpressionError([diagnostic('EXPR_FUNCTION_COLLISION', 0, { name })])
      }
      merged.set(name, entry)
    }
  }

  return merged
}

/** Build a registry from Host-declared signatures and their implementations. */
export function hostFunctions(
  specs: readonly FunctionSpec[],
  implementations: Readonly<Record<string, FunctionImpl>>,
): FunctionRegistry {
  const registry = new Map<string, RegisteredFunction>()

  for (const spec of specs) {
    const impl = implementations[spec.qualified]
    if (!impl) throw new Error(`${spec.qualified} is declared but not implemented`)
    registry.set(spec.qualified, { spec, impl })
  }

  return registry
}

/** Everything a function implementation is allowed to assume about its list arguments. */
export const asList = (value: Value): readonly Value[] => value as readonly Value[]
