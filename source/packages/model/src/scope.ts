import type { TypeNode, ValueType } from '@hatua/expressions'
import type { ContextKey, Manifest, Output, Step, WorkflowDefinition } from '@hatua/schema'
import { TRIGGER_BUILTIN } from '@hatua/schema'
import { MAPPING_VERB, mapEntries } from './slots'
import { walkSteps } from './tree'

/**
 * What a step may reference. The reference tree is built from this, which is
 * what makes a broken mapping unexpressible rather than merely discouraged.
 */

export interface ScopeEntry {
  /** The token root, e.g. `s2`, `triggers.nightly`, `var.digest_to`, `run.tenant`, `TRIGGER`. */
  path: string
  /**
   * Where the value comes from, which is what the reference tree groups by and
   * what decides a row's icon.
   *
   * `context` is the Host's Run Context — ambient values it supplies to every
   * execution. It sits beside `trigger` and `var` rather than under them
   * because it is neither: nothing in the document declares it, and unlike a
   * variable it cannot be edited from the builder at all.
   */
  kind: 'step' | 'trigger' | 'var' | 'context' | 'builtin'
  label: string
  /**
   * One sentence about the value, shown under the focused row in the completion
   * list. Only the Host's Run Context declares one today — a manifest output
   * has nowhere to put a sentence — so absent is the ordinary case and a row
   * without one simply shows nothing rather than a placeholder.
   */
  description?: string
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
 * Everything addressable with no position in the tree: Run Context, the
 * Triggers, the TRIGGER built-in, and the workflow's variables.
 *
 * **Never a Step's output.** A variable's value has no position — it is not
 * reached by running anything — so no Step is guaranteed to have run by the
 * time it is evaluated, and offering one would express a mapping that cannot
 * resolve. Everything here is available unconditionally for the mirror-image
 * reason: a workflow cannot run without a Trigger firing, the Host supplies Run
 * Context to every execution, and a variable is workflow-scoped rather than
 * positional.
 *
 * It exists as its own function because the Workflow tab needs scope without a
 * Step to ask about. `scopeFor` is this plus the upstream Steps, so the two
 * readers share one definition of the unpositioned half rather than drifting.
 */
export function workflowScope(
  doc: WorkflowDefinition,
  manifests: readonly Manifest[] = [],
  context: readonly ContextKey[] = [],
): ScopeEntry[] {
  const byUse = new Map(manifests.map((manifest) => [manifest.use, manifest]))
  const entries: ScopeEntry[] = []

  /*
   * First, because it is the only part of scope no document declares: it is
   * there before a workflow has a Trigger, a variable or a Step.
   *
   * The first of any repeated key wins, the way every other lookup here
   * resolves one. Nothing stops a Host assembling its array from several
   * sources, and two `run.tenant` entries are two rows in the completion list
   * and two siblings under one React key in the reference tree.
   */
  const declared = new Set<string>()
  for (const key of context) {
    if (declared.has(key.k)) continue
    declared.add(key.k)
    entries.push({
      path: `run.${key.k}`,
      kind: 'context',
      label: key.label,
      type: contextKeyToType(key),
      ...(key.description ? { description: key.description } : {}),
    })
  }

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

  return entries
}

/**
 * Everything addressable from a step: the unpositioned scope above, plus the
 * upstream steps.
 *
 * Only steps are constrained by tree position, because only a step can fail to
 * have run.
 */
export function scopeFor(
  doc: WorkflowDefinition,
  stepId: string,
  manifests: readonly Manifest[] = [],
  context: readonly ContextKey[] = [],
): ScopeEntry[] {
  const byUse = new Map(manifests.map((manifest) => [manifest.use, manifest]))

  return [
    ...workflowScope(doc, manifests, context),
    ...upstreamOf(doc, stepId).map(
      (step): ScopeEntry => ({
        path: `steps.${step.id}`,
        kind: 'step',
        label: step.name ?? step.id,
        type: stepOutputType(step, byUse.get(step.use)),
      }),
    ),
  ]
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
 * `core.map` is the one component whose outputs a manifest cannot declare,
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

/**
 * A Run Context key, as a type.
 *
 * Spelled `{k, label, t, of}` exactly as a manifest output is, which is why
 * this is three lines rather than a second traversal: the reference tree, the
 * completion list and the checker all read one shape whether the value came
 * from a component's outputs or from the Host's ambient values.
 */
function contextKeyToType(key: ContextKey): TypeNode {
  const members = key.of ? membersOf(key.of) : undefined
  return { type: key.t, ...(members ? { members } : {}) }
}

const membersOf = (keys: readonly ContextKey[]): Record<string, TypeNode> => {
  const members: Record<string, TypeNode> = {}
  for (const key of keys) members[key.k] = contextKeyToType(key)
  return members
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
