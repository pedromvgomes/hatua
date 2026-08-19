import type { TypeNode, ValueType } from '@hatua/expressions'
import type { Manifest, Output, Step, WorkflowDefinition } from '@hatua/schema'
import { TRIGGER_BUILTIN } from '@hatua/schema'
import { MAPPING_VERB, mapEntries } from './slots'
import { walkSteps } from './tree'

/**
 * What a step may reference. The reference tree is built from this, which is
 * what makes a broken mapping unexpressible rather than merely discouraged.
 */

export interface ScopeEntry {
  /** The token root, e.g. `s2`, `triggers.nightly`, `var.digest_to`, `TRIGGER`. */
  path: string
  kind: 'step' | 'trigger' | 'var' | 'builtin'
  label: string
  /**
   * The shape of what it yields.
   *
   * This is what makes an entry usable by `@hatua/expressions`' type checker,
   * which takes `ScopeEntry[]` as an argument precisely so it can stay ignorant
   * of manifests and of this package. One scope, two readers: the reference
   * tree reads `label` and `kind`, the checker reads `path` and `type`.
   */
  type: TypeNode
}

/**
 * The steps a given step may reference: its ancestors and the earlier siblings
 * of every ancestor. Sibling branches are deliberately out of scope, so a user
 * cannot express a mapping that could not resolve at run time.
 */
export function upstreamOf(doc: WorkflowDefinition, id: string): Step[] {
  return collectUpstream(doc.steps, id, []) ?? []
}

function collectUpstream(steps: readonly Step[], id: string, ancestors: Step[]): Step[] | null {
  const earlier: Step[] = []
  for (const step of steps) {
    if (step.id === id) return [...ancestors, ...earlier]

    const nested = [...(step.branches ?? []).map((b) => b.steps), step.steps ?? []]
    for (const children of nested) {
      const hit = collectUpstream(children, id, [...ancestors, ...earlier, step])
      if (hit) return hit
    }
    earlier.push(step)
  }
  return null
}

/**
 * Everything addressable from a step: upstream steps, plus triggers, vars and
 * the TRIGGER built-in — which are in scope everywhere.
 *
 * Triggers are always available because a workflow cannot run without one
 * firing. Vars likewise: they are workflow-scoped, not positional. Only steps
 * are constrained by tree position, because only a step can fail to have run.
 */
export function scopeFor(
  doc: WorkflowDefinition,
  stepId: string,
  manifests: readonly Manifest[] = [],
): ScopeEntry[] {
  const byUse = new Map(manifests.map((manifest) => [manifest.use, manifest]))
  const entries: ScopeEntry[] = []

  for (const trigger of doc.triggers ?? []) {
    entries.push({
      path: `triggers.${trigger.id}`,
      kind: 'trigger',
      label: trigger.name ?? trigger.id,
      type: outputsToType(byUse.get(trigger.use)?.outputs ?? []),
    })
  }

  // Needed because several triggers may declare different payloads, so an
  // expression has to be able to branch on which one started this run.
  if ((doc.triggers?.length ?? 0) > 1) {
    entries.push({
      path: TRIGGER_BUILTIN,
      kind: 'builtin',
      label: 'Which trigger fired',
      type: { type: 'text' },
    })
  }

  for (const variable of doc.vars ?? []) {
    entries.push({
      path: `var.${variable.key}`,
      kind: 'var',
      label: variable.key,
      type: { type: varType(variable.value) },
    })
  }

  for (const step of upstreamOf(doc, stepId)) {
    entries.push({
      path: step.id,
      kind: 'step',
      label: step.name ?? step.id,
      type: stepOutputType(step, byUse.get(step.use)),
    })
  }

  return entries
}

/**
 * A workflow variable's type, read from its literal value.
 *
 * Vars are the one addressable thing with no declaration to consult, and
 * calling them all `unknown` would make every `{{ var.x }}` in a workflow warn
 * — which trains people to ignore warnings. A var holding text is text. A var
 * holding a Template is genuinely unknown until it is evaluated, and says so.
 */
function varType(value: unknown): ValueType {
  if (typeof value === 'string') return value.includes('{{') ? 'unknown' : 'text'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (Array.isArray(value)) return 'list'
  return 'unknown'
}

/**
 * A step's outputs, as a type.
 *
 * `data.map` is the one component whose outputs a manifest cannot declare,
 * because they are whatever the user named. It is the third verb Hatua
 * interprets structurally, alongside `core.fork` and `core.for_each` — and the
 * only one that does so by reading a field's *value* rather than its position
 * in the tree.
 */
function stepOutputType(step: Step, manifest: Manifest | undefined): TypeNode {
  if (step.use === MAPPING_VERB) return mappingOutputType(step)
  return outputsToType(manifest?.outputs ?? [])
}

function mappingOutputType(step: Step): TypeNode {
  const members: Record<string, TypeNode> = {}
  for (const entry of mapEntries((step.with as Record<string, unknown> | undefined)?.entries)) {
    members[entry.key] = { type: entry.type }
  }
  return { type: 'object', members }
}

/** Manifest outputs are a list of `{k, t, of}`; the checker wants a tree. */
function outputsToType(outputs: readonly Output[]): TypeNode {
  const members: Record<string, TypeNode> = {}
  for (const output of outputs) members[output.k] = outputToType(output)
  return { type: 'object', members }
}

function outputToType(output: Output): TypeNode {
  // `of:` describes an object's members, or the fields of each list element —
  // one shape for both, which is exactly what a TypeNode carries.
  const members = output.of ? outputsToType(output.of).members : undefined
  return { type: output.t, ...(members ? { members } : {}) }
}

/** Every step id in the document, for detecting references to steps that vanished. */
export function stepIds(doc: WorkflowDefinition): Set<string> {
  return new Set([...walkSteps(doc.steps)].map((s) => s.id))
}
