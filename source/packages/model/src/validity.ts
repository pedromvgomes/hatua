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
 * A field hidden by its `when` clause is not missing.
 *
 * `when: [otherKey, value]` shows a field only while another field equals a
 * value — it is how one trigger component reshapes its form across schedule,
 * API and upstream modes. Counting a hidden field as unfilled would mark a Step
 * invalid for a field the user cannot see, let alone fill.
 */
const visible = (field: Manifest['fields'][number], values: Record<string, unknown>): boolean => {
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

  const check = (id: string, use: string, values: Record<string, unknown> | undefined) => {
    const manifest = manifests.get(use)
    // Unknown components are reported once, by their own rule. Guessing that
    // every field is missing would bury that one diagnostic under ten.
    if (!manifest) return

    const filled = values ?? {}
    for (const field of manifest.fields ?? []) {
      if (!field.req || !visible(field, filled)) continue
      if (!unfilled(filled[field.k])) continue

      out.push({
        code: 'FIELD_REQUIRED',
        message: `${field.label} is required.`,
        blocks: 'publish',
        stepId: id,
        fieldKey: field.k,
      })
    }
  }

  for (const step of walk(doc.steps)) check(step.id, step.use, step.with)
  for (const trigger of doc.triggers ?? []) check(trigger.id, trigger.use, trigger.with)

  return out
}

/**
 * A Step whose `use` no Component Manifest declares.
 *
 * Blocks editing, because it cannot be reached by building: the Library only
 * offers what the catalogue declares. It means a hand-edited verb, or a
 * workflow written against a Host that has since dropped a component — and in
 * the second case the fields are gone too, so there is nothing to fill in.
 */
export function unknownComponents(doc: WorkflowDefinition, manifests: ManifestIndex): Diagnostic[] {
  const out: Diagnostic[] = []

  for (const step of walk(doc.steps)) {
    if (manifests.has(step.use)) continue
    out.push({
      code: 'COMPONENT_UNKNOWN',
      message: `Nothing declares "${step.use}". This Host may no longer offer it.`,
      blocks: 'edit',
      stepId: step.id,
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
export function validateSteps(
  doc: WorkflowDefinition,
  manifests: ManifestIndex,
): Map<string, Diagnostic[]> {
  const all = [
    ...unknownComponents(doc, manifests),
    ...missingRequiredFields(doc, manifests),
    ...malformedContainers(doc),
  ]

  const byStep = new Map<string, Diagnostic[]>()
  for (const diagnostic of all) {
    if (!diagnostic.stepId) continue
    const held = byStep.get(diagnostic.stepId)
    if (held) held.push(diagnostic)
    else byStep.set(diagnostic.stepId, [diagnostic])
  }
  return byStep
}

/** Depth-first, including Triggers' siblings-in-spirit: the Steps only. */
function* walk(steps: readonly Step[]): Generator<Step> {
  for (const step of steps) {
    yield step
    for (const branch of step.branches ?? []) yield* walk(branch.steps)
    if (step.steps) yield* walk(step.steps)
  }
}
