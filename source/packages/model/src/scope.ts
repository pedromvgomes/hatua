import { type Step, TRIGGER_BUILTIN, type WorkflowDefinition } from '@hatua/schema'
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
export function scopeFor(doc: WorkflowDefinition, stepId: string): ScopeEntry[] {
  const entries: ScopeEntry[] = []

  for (const trigger of doc.triggers ?? []) {
    entries.push({
      path: `triggers.${trigger.id}`,
      kind: 'trigger',
      label: trigger.name ?? trigger.id,
    })
  }

  // Needed because several triggers may declare different payloads, so an
  // expression has to be able to branch on which one started this run.
  if ((doc.triggers?.length ?? 0) > 1) {
    entries.push({ path: TRIGGER_BUILTIN, kind: 'builtin', label: 'Which trigger fired' })
  }

  for (const variable of doc.vars ?? []) {
    entries.push({ path: `var.${variable.key}`, kind: 'var', label: variable.key })
  }

  for (const step of upstreamOf(doc, stepId)) {
    entries.push({ path: step.id, kind: 'step', label: step.name ?? step.id })
  }

  return entries
}

/** Every step id in the document, for detecting references to steps that vanished. */
export function stepIds(doc: WorkflowDefinition): Set<string> {
  return new Set([...walkSteps(doc.steps)].map((s) => s.id))
}
