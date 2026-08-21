import type { Manifest, Step, WorkflowDefinition } from '@hatua/schema'
import type { Diagnostic } from './connections'

/**
 * Whether a Step is filled in enough to run — the rules that read a Step
 * against its Component Manifest, and the two Hatua interprets structurally.
 *
 * Here rather than in @hatua/services for the same reason `tree.ts` is: these
 * are pure domain rules over the typed projection, so a Host's runner can hold
 * a definition to exactly what the builder held it to. The store that watches
 * them and the region that draws a dot are separate concerns and live
 * elsewhere.
 *
 * Everything below `blocks: 'publish'`, and that is the whole design rather
 * than a default. ADR-0009: an error "blocks Publish. Never blocks editing."
 * A half-filled Step is what every Step looks like a second after it is added,
 * so a rule that blocked editing on one would make the builder unusable. The
 * marker exists to tell the user what is left to do, not to stop them doing it.
 *
 * `blocks: 'edit'` is reserved for what cannot arise from ordinary building —
 * `connections.ts` uses it for a `conn` field pointing at a connection the
 * workflow never declared, which only a hand-edit can produce.
 */

type ManifestIndex = ReadonlyMap<string, Manifest>

/**
 * Whether a field is shown, and therefore whether it can be missing.
 *
 * `when: [otherKey, value]` shows a field only while another field equals a
 * value — it is how one trigger component reshapes its form across schedule,
 * API and upstream modes. Counting a hidden field as unfilled would mark a Step
 * invalid for a field the user cannot see, let alone fill.
 *
 * Exported because the form that draws the fields has to ask the same question,
 * and two copies of it are two answers waiting to disagree: a hidden field that
 * starts blocking Publish, or a visible required one that stops being reported.
 * `reference.ts` and `slots.ts` refuse the same duplication for the same
 * reason — the rule lives once, in the package that owns the domain.
 */
export const fieldVisible = (
  field: Manifest['fields'][number],
  values: Record<string, unknown>,
): boolean => {
  if (!field.when) return true
  const [key, expected] = field.when
  return String(values[key as string] ?? '') === expected
}

/**
 * Empty means empty: absent, null, or a string of nothing but whitespace.
 *
 * `false` and `0` are values. A `bool` field left off is genuinely unset, but a
 * `bool` field set to false is answered — and treating a falsy value as missing
 * would make "no" impossible to say.
 */
const unfilled = (value: unknown): boolean => {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

/** Required fields with nothing in them, per Step. */
export function missingRequiredFields(
  doc: WorkflowDefinition,
  manifests: ManifestIndex,
): Diagnostic[] {
  const out: Diagnostic[] = []

  const check = (
    subject: { stepId: string } | { triggerId: string },
    use: string,
    values: Record<string, unknown> | undefined,
  ) => {
    const manifest = manifests.get(use)
    // Unknown components are reported once, by their own rule. Guessing that
    // every field is missing would bury that one diagnostic under ten.
    if (!manifest) return

    const filled = values ?? {}
    for (const field of manifest.fields ?? []) {
      if (!field.req || !fieldVisible(field, filled)) continue
      if (!unfilled(filled[field.k])) continue

      out.push({
        code: 'FIELD_REQUIRED',
        message: `${field.label} is required.`,
        blocks: 'publish',
        ...subject,
        fieldKey: field.k,
      })
    }
  }

  for (const step of walk(doc.steps)) check({ stepId: step.id }, step.use, step.with)
  for (const trigger of doc.triggers ?? []) {
    check({ triggerId: trigger.id }, trigger.use, trigger.with)
  }

  return out
}

/**
 * A Step or a Trigger whose `use` no Component Manifest declares.
 *
 * Blocks editing, because it cannot be reached by building: the catalogue only
 * offers what it declares. It means a hand-edited verb, or a workflow written
 * against a Host that has since dropped a component — and in the second case
 * the fields are gone too, so there is nothing to fill in.
 *
 * Triggers are checked alongside Steps because the same mistake is possible in
 * `triggers:` and has the same consequence: `missingRequiredFields` returns
 * early for a manifest it cannot find, so without this a Trigger naming a verb
 * nothing declares produces no diagnostic at all, while the Workflow tab draws
 * it as a card that says its type is unknown. The checker and the screen would
 * be answering differently about the same entry.
 */
export function unknownComponents(doc: WorkflowDefinition, manifests: ManifestIndex): Diagnostic[] {
  const out: Diagnostic[] = []

  const unknown = (use: string) => `Nothing declares "${use}". It may no longer be available.`

  for (const step of walk(doc.steps)) {
    if (manifests.has(step.use)) continue
    out.push({
      code: 'COMPONENT_UNKNOWN',
      message: unknown(step.use),
      blocks: 'edit',
      stepId: step.id,
    })
  }
  for (const trigger of doc.triggers ?? []) {
    if (manifests.has(trigger.use)) continue
    out.push({
      code: 'COMPONENT_UNKNOWN',
      message: unknown(trigger.use),
      blocks: 'edit',
      triggerId: trigger.id,
    })
  }
  return out
}

/**
 * The two verbs Hatua interprets structurally, held to what they mean.
 *
 * These are read from the tree rather than from a manifest, because a manifest
 * cannot express them: `core.fork`'s Branches and `core.for_each`'s body are
 * positions in the document, not fields under `with:`.
 */
export function malformedContainers(doc: WorkflowDefinition): Diagnostic[] {
  const out: Diagnostic[] = []

  for (const step of walk(doc.steps)) {
    if (step.use === 'core.fork') {
      const branches = step.branches ?? []
      // CONTEXT.md defines a Fork as "holding two or more Branches". One branch
      // is not a fork — it is the same path with a condition on it, which is
      // not a thing the runtime can do anything useful with.
      if (branches.length < 2) {
        out.push({
          code: 'FORK_NEEDS_TWO_BRANCHES',
          message:
            branches.length === 0
              ? 'This fork has no branches. Add the two paths it chooses between.'
              : 'A fork needs at least two branches — add the other path.',
          blocks: 'publish',
          stepId: step.id,
        })
      }

      // A condition fork is "first match wins", so a branch with no `when`
      // before the end swallows every branch after it: they can never be
      // reached. The LAST branch may be unconditional — that is the fallback,
      // and it is the documented shape.
      const conditional = branches.some((branch) => branch.when)
      if (conditional) {
        branches.forEach((branch, index) => {
          if (branch.when || index === branches.length - 1) return
          out.push({
            code: 'BRANCH_UNREACHABLE_AFTER',
            message: `"${branch.label}" has no condition, so nothing after it can ever run. Only the last branch may be unconditional.`,
            blocks: 'publish',
            stepId: step.id,
          })
        })
      }
    }

    if (step.use === 'core.for_each' && (step.steps ?? []).length === 0) {
      out.push({
        code: 'LOOP_HAS_NO_BODY',
        message: 'This loop repeats nothing. Add at least one Step inside it.',
        blocks: 'publish',
        stepId: step.id,
      })
    }
  }

  return out
}

/*
 * Deliberately NOT a rule: a Branch with no Steps.
 *
 * "Do nothing on this path" is a legitimate and common design — an `else` that
 * exists precisely so the other branch does not run — and the schema allows it
 * (`steps` has no `minItems`). Flagging it would put a permanent error on a
 * workflow that is finished and correct, which is how a validation marker stops
 * being read at all.
 */

/** Every step-level rule, in one pass, indexed by the Step it belongs to. */
export interface Validity {
  /** Diagnostics for each Step that has any. A Step with none is absent. */
  byStep: ReadonlyMap<string, Diagnostic[]>
  /** The same, for Triggers, which are not Steps and are drawn by another region. */
  byTrigger: ReadonlyMap<string, Diagnostic[]>
  /**
   * Everything, in the order the rules ran.
   *
   * Returned rather than left to a caller to flatten out of `byStep`: a
   * diagnostic about a Trigger has no `stepId`, so flattening the Step map
   * silently drops it — and a Publish gate counting what it found there would
   * pass a workflow whose Trigger is missing a required field.
   */
  all: readonly Diagnostic[]
}

export function validateSteps(doc: WorkflowDefinition, manifests: ManifestIndex): Validity {
  const all = [
    ...unknownComponents(doc, manifests),
    ...missingRequiredFields(doc, manifests),
    ...malformedContainers(doc),
  ]

  const byStep = new Map<string, Diagnostic[]>()
  const byTrigger = new Map<string, Diagnostic[]>()

  const file = (map: Map<string, Diagnostic[]>, id: string, diagnostic: Diagnostic) => {
    const held = map.get(id)
    if (held) held.push(diagnostic)
    else map.set(id, [diagnostic])
  }

  for (const diagnostic of all) {
    if (diagnostic.stepId) file(byStep, diagnostic.stepId, diagnostic)
    else if (diagnostic.triggerId) file(byTrigger, diagnostic.triggerId, diagnostic)
  }
  return { byStep, byTrigger, all }
}

/** Depth-first, including Triggers' siblings-in-spirit: the Steps only. */
function* walk(steps: readonly Step[]): Generator<Step> {
  for (const step of steps) {
    yield step
    for (const branch of step.branches ?? []) yield* walk(branch.steps)
    if (step.steps) yield* walk(step.steps)
  }
}
