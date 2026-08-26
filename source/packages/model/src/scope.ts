import { elementOf, sourceReference, type TypeNode } from '@hatua/expressions'
import type {
  Block,
  ContextKey,
  Declaration,
  Manifest,
  Output,
  Step,
  Variable,
  WorkflowDefinition,
} from '@hatua/schema'
import { TRIGGER_BUILTIN } from '@hatua/schema'
import { blockIdOf, blockOf } from './blocks'
import {
  FOR_EACH_LIST_FIELD,
  FOR_EACH_VERB,
  ITEM_BINDING,
  MAPPING_VERB,
  mapEntries,
  variableType,
} from './slots'
import { type BoardId, boardOf, own, type StepRef, stepKey, TRY_VERB } from './tree'

/**
 * What a step may reference. The reference tree is built from this, which is
 * what makes a broken mapping unexpressible rather than merely discouraged.
 */

export interface ScopeEntry {
  /**
   * The whole addressable path, e.g. `steps.s2`, `triggers.nightly`,
   * `var.digest_to`, `params.entry`, `run.tenant`, `TRIGGER`.
   *
   * Always below a root, never at one — which is what lets a Step be called
   * `run` and a parameter be called `steps` (ADR-0014).
   */
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
  kind: 'step' | 'trigger' | 'param' | 'var' | 'context' | 'builtin'
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
 *
 * The walk is rooted at the Step's own Board and never leaves it. A Block's
 * steps do not see the call site's ancestry, which is the whole reason a call is
 * a cross-link with a contract and a jump is not (ADR-0013).
 */
export function upstreamOf(doc: WorkflowDefinition, ref: StepRef): Step[] {
  const board = boardOf(doc, ref.board)
  return board ? (collectUpstream(board.steps, ref.id, []) ?? []) : []
}

/**
 * The walk, and the one verb it treats as more than a container.
 *
 * A `core.try` has two child regions, and they are siblings — so the body
 * cannot see the handler and the handler cannot see the body's Steps, with no
 * code saying so. That is the same rule that keeps a Fork's branches out of
 * each other's scope, and it is the right one for the right reason: the body
 * failed *somewhere*, and which of its Steps completed before it did is not a
 * fact the document holds. Offering them would make scope an intersection over
 * paths, which is the analysis ADR-0013 refuses edges in order to avoid.
 *
 * What IS special is the try Step itself. It appears in the upstream list only
 * for Steps inside its `handler`, because that is where its binding means
 * something: `{{steps.<try id>.error}}` is the failure the handler is handling.
 * Its body cannot read it — the body is what produces it — and neither can a
 * Step after the try, because whether there was a failure at all is decided
 * during a run and not in the file.
 */
function collectUpstream(steps: readonly Step[], id: string, ancestors: Step[]): Step[] | null {
  const earlier: Step[] = []
  for (const step of steps) {
    if (step.id === id) return [...ancestors, ...earlier]

    const above = [...ancestors, ...earlier]
    const outside = step.use === TRY_VERB ? above : [...above, step]

    const regions: readonly (readonly [readonly Step[], Step[]])[] = [
      ...(step.branches ?? []).map((branch) => [branch.steps, outside] as const),
      [step.steps ?? [], outside] as const,
      // The handler, and the only place the try itself is in scope.
      [step.handler ?? [], [...above, step]] as const,
    ]
    for (const [children, visible] of regions) {
      const hit = collectUpstream(children, id, visible)
      if (hit) return hit
    }

    if (step.use !== TRY_VERB) earlier.push(step)
  }
  return null
}

/**
 * Everything a Board offers with no position in its tree.
 *
 * **Never a Step's output.** A variable's value has no position — it is not
 * reached by running anything — so no Step is guaranteed to have run by the
 * time it is evaluated, and offering one would express a mapping that cannot
 * resolve. Everything here is available unconditionally for the mirror-image
 * reason: a workflow cannot run without a Trigger firing, the Host supplies Run
 * Context to every execution, a parameter is filled by the caller before the
 * Block starts, and a variable is Board-scoped rather than positional.
 *
 * The two Boards offer different things, and the difference IS the contract:
 *
 * | | root Board | a Block's |
 * | --- | --- | --- |
 * | `run.*` | Run Context | the same — the one thing that crosses |
 * | `triggers.*`, `TRIGGER` | the parameter contract | absent |
 * | `params.*` | absent | the parameter contract |
 * | `var.*` | the workflow's | the Block's, rebuilt per call |
 *
 * A Block cannot read the workflow's variables or ask which Trigger fired.
 * Run Context is the single exception because nothing in the document declares
 * it: the Host supplies it to every execution, so it is exact on every path of
 * every Board with no intersection to compute (ADR-0013).
 *
 * It exists as its own function because the Board panel needs scope without a
 * Step to ask about. `scopeFor` is this plus the upstream Steps, so the two
 * readers share one definition of the unpositioned half rather than drifting.
 */
export function boardScope(
  doc: WorkflowDefinition,
  board: BoardId = null,
  manifests: readonly Manifest[] = [],
  context: readonly ContextKey[] = [],
): ScopeEntry[] {
  const block = board === null ? undefined : blockOf(doc, board)
  if (board !== null && !block) return []
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

  if (block) {
    // First-wins, the way `run.` above resolves a repeat and the way every
    // other reader of a declaration resolves one. Two entries under one path
    // are two completion rows for one value and two siblings under one React
    // key in the reference tree.
    const named = new Set<string>()
    for (const param of block.params ?? []) {
      if (named.has(param.k)) continue
      named.add(param.k)
      entries.push({
        path: `params.${param.k}`,
        kind: 'param',
        label: param.label,
        type: declarationToType(param),
      })
    }
  } else {
    for (const trigger of doc.triggers ?? []) {
      entries.push({
        path: `triggers.${trigger.id}`,
        kind: 'trigger',
        label: trigger.name ?? trigger.id,
        type: outputsToType(byUse.get(trigger.use)?.outputs ?? []),
      })
    }

    /*
     * Needed because several triggers may declare different payloads, so an
     * expression has to be able to branch on which one started this run.
     *
     * Absent on a Block's Board for the reason `triggers.` is: a Block cannot
     * ask which Trigger fired, because it cannot see the Triggers at all. A
     * Block that needs to know takes it as a parameter.
     */
    if ((doc.triggers?.length ?? 0) > 1) {
      entries.push({
        path: TRIGGER_BUILTIN,
        kind: 'builtin',
        label: 'Which trigger fired',
        type: { type: 'text' },
      })
    }
  }

  // The Board's own variables: the workflow's at the root, the Block's inside
  // one. A Block called twice starts clean both times, because these are
  // rebuilt per invocation rather than carried.
  for (const variable of block ? (block.vars ?? []) : (doc.vars ?? [])) {
    entries.push({
      path: `var.${variable.key}`,
      kind: 'var',
      label: variable.key,
      type: variableToType(variable),
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
  ref: StepRef,
  manifests: readonly Manifest[] = [],
  context: readonly ContextKey[] = [],
): ScopeEntry[] {
  return scopeAt(doc, ref, manifests, context, new Set(), new Map())
}

/**
 * `scopeFor`, plus the set of loops already being resolved and what has already
 * been worked out.
 *
 * `item` is typed by reading the loop's own `list` field, which means typing an
 * expression against the loop step's scope — so building one Step's scope can
 * ask for another's. The walk terminates on its own, because a Step's upstream
 * is always strictly earlier in the tree than the Step itself and a loop can
 * therefore never be its own. `resolving` is not that argument: it is the guard
 * for a document where two Steps share an id, which the schema permits into a
 * file and `STEP_ID_DUPLICATE` reports rather than refuses.
 *
 * **Terminating is not the same as finishing.** Every loop in the upstream is
 * typed, and typing one asks for the scope at it — which types every loop
 * upstream of THAT. Without `elements`, a chain of n loops costs 2ⁿ: twenty of
 * them take minutes, and `validateDefinition` runs on every keystroke.
 */
function scopeAt(
  doc: WorkflowDefinition,
  ref: StepRef,
  manifests: readonly Manifest[],
  context: readonly ContextKey[],
  resolving: ReadonlySet<string>,
  elements: ElementMemo,
): ScopeEntry[] {
  const byUse = new Map(manifests.map((manifest) => [manifest.use, manifest]))

  return [
    ...boardScope(doc, ref.board, manifests, context),
    ...upstreamOf(doc, ref).map(
      (step): ScopeEntry => ({
        path: `steps.${step.id}`,
        kind: 'step',
        label: step.name ?? step.id,
        type: stepOutputType(doc, ref.board, step, byUse.get(step.use), {
          manifests,
          context,
          resolving,
          elements,
        }),
      }),
    ),
  ]
}

/**
 * The type one path names, read out of a scope, or null when nothing declares
 * it.
 *
 * Longest prefix first, because a scope path is dotted and is one entry rather
 * than two: `steps.s2` is an entry and `steps` is not, so `steps.s2.messages`
 * has to try three segments before two. That is the same rule `validate.ts`
 * walks a Member chain by, restated here for a caller that has a path and no
 * expression — reading a *declared* type is not checking one, and reaching for
 * the checker would mean manufacturing diagnostics nobody asked for in order to
 * throw them away.
 */
export function typeAtPath(scope: readonly ScopeEntry[], path: string): TypeNode | null {
  const segments = path.split('.')
  for (let take = segments.length; take > 0; take--) {
    const entry = scope.find((candidate) => candidate.path === segments.slice(0, take).join('.'))
    if (!entry) continue

    let node: TypeNode = entry.type
    for (const name of segments.slice(take)) {
      // `Object.hasOwn`, for the reason `own` exists: a member called
      // `constructor` would otherwise resolve off `Object.prototype` and give a
      // shape nothing declared, which Go — having no prototype — would not.
      if (!node.members || !Object.hasOwn(node.members, name)) return null
      node = node.members[name] as TypeNode
    }
    return node
  }
  return null
}

/**
 * What one element of a `core.for_each`'s list is, or null when the document
 * does not say.
 *
 * This is the whole of `t: item`. The loop's `list` is a `ref` field, so its
 * declared type is `unknown` and the ordinary Slot check learns nothing from
 * it; the shape is one level below whatever it points at, which is exactly the
 * `of:` the source output declared. Null when `list` is missing, is not a plain
 * Reference, names nothing, or names something that is not a list — and null
 * means `item` stays `item`, which the checker treats as matching anything.
 * Guessing `object` instead would be a shape nothing declared.
 */
export function loopElementType(
  doc: WorkflowDefinition,
  board: BoardId,
  step: Step,
  manifests: readonly Manifest[] = [],
  context: readonly ContextKey[] = [],
  resolving: ReadonlySet<string> = new Set(),
  elements: ElementMemo = new Map(),
): TypeNode | null {
  const key = stepKey({ board, id: step.id })

  // `null` is an answer and `undefined` is "not asked yet", which is why this
  // reads the Map rather than testing truthiness.
  const known = elements.get(key)
  if (known !== undefined) return known

  const template = own(step.with as Record<string, unknown> | undefined, FOR_EACH_LIST_FIELD)
  if (typeof template !== 'string') return remember(elements, key, null)

  const path = sourceReference(template)
  if (path === null) return remember(elements, key, null)

  /*
   * Not remembered. This null is a fact about the walk that reached here — a
   * Step already being resolved further up — rather than about the Step, so
   * storing it would let one path's guard answer for a path that has no cycle
   * in it.
   */
  if (resolving.has(key)) return null

  const scope = scopeAt(
    doc,
    { board, id: step.id },
    manifests,
    context,
    new Set([...resolving, key]),
    elements,
  )
  const node = typeAtPath(scope, path)
  if (!node || node.type !== 'list') return remember(elements, key, null)

  /*
   * A list that declares no `of:` says nothing about its elements, and a list
   * of scalars — `tags`, `recipients` — is exactly that. `elementOf` would hand
   * back a memberless `{type: 'object'}`, which is the shape nothing declared
   * that the paragraph above refuses: `{{ steps.<loop>.item }}` fed to a `text`
   * field would then read as an object against text and be reported as a
   * conflict on a workflow with nothing wrong with it.
   */
  if (!node.members) return remember(elements, key, null)

  return remember(elements, key, elementOf(node))
}

/**
 * What one loop's element resolves to, for the length of one top-level walk.
 *
 * A Step's element type is a property of the document, so one walk asking for
 * the same loop twice is asking the same question twice — and the walk asks for
 * it once per path that reaches it, which is what makes the cost exponential
 * without this. The map is created per `scopeFor` rather than held in the
 * module: the document is an argument, and a cache outliving the call would be
 * answering about a document that has since been edited.
 */
type ElementMemo = Map<string, TypeNode | null>

const remember = (memo: ElementMemo, key: string, node: TypeNode | null): TypeNode | null => {
  memo.set(key, node)
  return node
}

/**
 * What a Block's outputs are, as a scope entry's type at the call site.
 *
 * Read where the Block is declared rather than from a manifest, which is what
 * makes a call type-check before its body is written: the declaration is the
 * contract, and `core.return` only binds values to it.
 */
export function blockOutputType(block: Block | undefined): TypeNode {
  // Null-prototype, because every key here is a name out of the document: a
  // declaration keyed `__proto__` would otherwise swap the object's prototype
  // instead of storing a member.
  const members: Record<string, TypeNode> = Object.create(null)
  for (const output of block?.outputs ?? []) {
    if (output.k in members) continue
    members[output.k] = declarationToType(output)
  }
  return { type: 'object', members }
}

/**
 * A declaration's type. Spelled `{k, label, t, of}`, so this is three lines
 * rather than a second traversal — the same shape a manifest output and a Run
 * Context key carry, read by the same tree, checker and completion list.
 */
function declarationToType(declaration: Declaration): TypeNode {
  const members = declaration.of ? declarationMembers(declaration.of) : undefined
  return { type: declaration.t, ...(members ? { members } : {}) }
}

const declarationMembers = (declarations: readonly Declaration[]): Record<string, TypeNode> => {
  const members: Record<string, TypeNode> = Object.create(null)
  for (const declaration of declarations) members[declaration.k] = declarationToType(declaration)
  return members
}

/**
 * A workflow variable's type, read from its declaration.
 *
 * Read from `t` rather than from the value beside it, which is the decision
 * `core.set_var` forced. A var's value is only its FIRST value: once a Step can
 * write it, a type inferred from the literal in the document is a claim about
 * one moment in an execution rather than about the var — the builder would say
 * `text` while the runner produced a number, and every downstream check was
 * answered against that. `of:` carries the shape of an object's members or a
 * list's elements, spelled exactly as a declaration's does (ADR-0013).
 */
function variableToType(variable: Variable): TypeNode {
  const members = variable.of ? declarationMembers(variable.of) : undefined
  return { type: variableType(variable), ...(members ? { members } : {}) }
}

/**
 * A step's outputs, as a type.
 *
 * `core.map` is one of two components whose outputs a manifest cannot declare,
 * because they are whatever the user named. It is the third verb Hatua
 * interprets structurally, alongside `core.fork` and `core.for_each` — and the
 * only one that does so by reading a field's *value* rather than its position
 * in the tree.
 *
 * A `block.*` call is the other, and it reads neither: its outputs are declared
 * once, where the Block is, and every call site shares that one declaration.
 */
function stepOutputType(
  doc: WorkflowDefinition,
  board: BoardId,
  step: Step,
  manifest: Manifest | undefined,
  through: {
    manifests: readonly Manifest[]
    context: readonly ContextKey[]
    resolving: ReadonlySet<string>
    elements: ElementMemo
  },
): TypeNode {
  if (step.use === MAPPING_VERB) return mappingOutputType(step)

  const called = blockIdOf(step.use)
  if (called !== null) return blockOutputType(blockOf(doc, called))

  const declared = outputsToType(manifest?.outputs ?? [])
  if (step.use !== FOR_EACH_VERB) return declared

  /*
   * A loop's binding, and the one output whose type is not in the manifest.
   *
   * `item` is substituted here rather than in `outputsToType` because it is a
   * property of the STEP and not of the declaration: two `core.for_each` steps
   * share one manifest and iterate two different lists. Only a top-level output
   * is substituted — `item` nested inside another output's `of:` would be a
   * loop's element appearing as a member of something that is not the loop,
   * which no manifest can mean.
   */
  const element = loopElementType(
    doc,
    board,
    step,
    through.manifests,
    through.context,
    through.resolving,
    through.elements,
  )
  if (!element) return declared

  const members: Record<string, TypeNode> = Object.create(null)
  for (const [key, node] of Object.entries(declared.members ?? {})) {
    members[key] = node.type === ITEM_BINDING ? element : node
  }
  return { type: 'object', members }
}

function mappingOutputType(step: Step): TypeNode {
  const members: Record<string, TypeNode> = Object.create(null)
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
  const members: Record<string, TypeNode> = Object.create(null)
  for (const key of keys) members[key.k] = contextKeyToType(key)
  return members
}

/** Manifest outputs are a list of `{k, t, of}`; the checker wants a tree. */
function outputsToType(outputs: readonly Output[]): TypeNode {
  const members: Record<string, TypeNode> = Object.create(null)
  for (const output of outputs) members[output.k] = outputToType(output)
  return { type: 'object', members }
}

function outputToType(output: Output): TypeNode {
  // `of:` describes an object's members, or the fields of each list element —
  // one shape for both, which is exactly what a TypeNode carries.
  const members = output.of ? outputsToType(output.of).members : undefined
  return { type: output.t, ...(members ? { members } : {}) }
}
