// GENERATED — do not edit.
// Source: schemas/workflow-definition.schema.yaml
// Regenerate: pnpm codegen
import { z } from 'zod'

/**
 * A name that has to survive being a path segment. Every user-chosen name sits one segment below a reserved root — `steps.<id>`, `triggers.<id>`, `var.<key>`, `block.<id>` — so a name the expression grammar cannot parse is a name nothing can ever address. Refused here rather than accepted into a file and reported as a broken Reference on every use of it.
 */
export const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
export type Identifier = z.infer<typeof identifier>

/**
 * One Board: a step tree whose root is this contract rather than the workflow's triggers.
 * Step ids are scoped to the block, so `{{steps.put}}` inside one names that block's `put` and two blocks may each have a step by the same name. A block's `vars` are its own and are rebuilt on every invocation, which is why a block called twice carries nothing between calls.
 */
export const block = z.strictObject({
  /**
   * The slug a call writes as `use: block.<id>`. Renaming it does not follow the call sites: they go stale and are reported, exactly as a renamed var key's References are.
   */
  get id() {
    return identifier
  },
  /**
   * Display name.
   */
  name: z.string().optional(),
  /**
   * What the block takes, read inside it as `{{params.<k>}}`. Spelled exactly as a manifest output is, so `outputsToType` types `{{params.entry.headline}}` with no new code and `params.` is a precise mirror of `triggers.` on the root Board.
   * It is also what a call site's fields are derived from, which is why a call needs no UI of its own: each parameter becomes a Slot in the calling step's `with:`.
   */
  get params() {
    return z.array(declaration).optional()
  },
  /**
   * What the block publishes, read at the call site as `{{steps.<call id>.<k>}}`. Declared rather than inferred, because the call site must type-check before the body is written — that is the whole difference between a call and a jump.
   * `core.return` binds the values; the declaration is the contract.
   */
  get outputs() {
    return z.array(declaration).optional()
  },
  /**
   * The block's own variables, read as `{{var.<key>}}` inside it and written by `core.set_var`. Rebuilt on every invocation, and invisible outside the block — the workflow's `vars` are a different set that a block cannot see.
   */
  get vars() {
    return z.array(variable).optional()
  },
  get steps() {
    return z.array(step)
  },
})
export type Block = z.infer<typeof block>

/**
 * One parameter or one output. Spelled `{k, label, t, of}` exactly as a Component Manifest's output and a Run Context key are — ADR-0012 rejected inventing a second spelling for an idea the contract already has one of, and the reasoning holds here unchanged.
 */
export const declaration = z.strictObject({
  /**
   * Read inside the block as `{{params.<k>}}` and, for an output, at the call site as `{{steps.<call id>.<k>}}` — a path segment like every other user-chosen name, and held to the same rule.
   */
  get k() {
    return identifier
  },
  /**
   * Friendly name, shown in the reference tree and on the call site's field.
   */
  label: z.string().min(1),
  /**
   * `item` is deliberately absent. It is the for-each escape hatch, resolved by following a loop's `list` back to its source output, and a block's parameter is not the output of anything — so it could never resolve. Refused by the schema rather than warned about at run time.
   */
  t: z.enum(['text', 'number', 'boolean', 'datetime', 'object', 'list']),
  /**
   * Shape of each list element or object member.
   */
  get of() {
    return z.array(declaration).optional()
  },
})
export type Declaration = z.infer<typeof declaration>

export const connection = z.strictObject({
  /**
   * Workflow-local name. Steps reference this, never the ref.
   */
  id: z.string().min(1),
  /**
   * Opaque handle minted by the Host, resolved by it to credentials at run time. Nothing human-readable is cached alongside it: everything shown to the user comes from `ConnectionDescriber.describe(ref)`, so nothing here can go stale when a connection is renamed.
   * Deliberately named `ref` rather than `token`. A Workflow Definition is a file that lives in the Host's repository, usually in git, and a field called `token` invites someone committing a real credential into it.
   * `null` means the connection was never established. That blocks publish, but not editing — you can build a workflow before wiring up its connections.
   */
  ref: z.string().nullable(),
})
export type Connection = z.infer<typeof connection>

export const trigger = z.strictObject({
  /**
   * Addressed as `{{triggers.<id>.<field>}}`, and matched by the `TRIGGER` built-in.
   */
  get id() {
    return identifier
  },
  /**
   * The manifest verb, e.g. `core.schedule` or a Host-supplied `component.email.received`. See `step.use` for what the three roots mean.
   */
  use: z.string().min(1),
  /**
   * Display name.
   */
  name: z.string().optional(),
  get with() {
    return values.optional()
  },
})
export type Trigger = z.infer<typeof trigger>

/**
 * A list of key/value objects rather than a map, which is what let `t` be added here without inventing a second spelling for a variable.
 * NOT a `declaration`. A declaration is a contract with nothing in it; a variable carries a value, and its key is its own label — the builder shows `var.digest_to`, not a friendly name. `t` and `of` are spelled identically to a declaration's so one function reads both, but three shared fields out of five is not one idea.
 */
export const variable = z.strictObject({
  get key() {
    return identifier
  },
  /**
   * The type every `{{var.<key>}}` is checked against, and the type `core.set_var` must write. Declared rather than inferred from `value`, because `value` is only the FIRST value: a `core.set_var` writing a number into a var that started as `""` would make an inferred `text` a lie, and every downstream type check was answered against it. Required rather than defaulted, for the reason ADR-0014 rewrote every document at once — a fallback spelling is a second definition of the thing on the day it was declared.
   * `item` is absent, for the reason it is absent from a declaration: it is the for-each escape hatch, resolved by following a loop's `list` back to its source output, and a variable is not the output of anything.
   */
  t: z.enum(['text', 'number', 'boolean', 'datetime', 'object', 'list']),
  /**
   * Shape of each list element or object member, spelled as a declaration's `of` is.
   */
  get of() {
    return z.array(declaration).optional()
  },
  /**
   * The initial value: a literal, or an expression evaluated by the SDK's shared evaluator. Checked against `t` like any other Slot when it is a Template.
   */
  value: z.unknown(),
})
export type Variable = z.infer<typeof variable>

export const step = z.strictObject({
  /**
   * Stable, and what References point at, addressed as `{{steps.<id>.<field>}}`. This is why renaming a step never breaks a mapping.
   * Unique within its Board, not within the document: a block's steps are its own, so two blocks may each hold a step called `ret` and `{{steps.ret}}` means the one on the Board it is written on.
   */
  get id() {
    return identifier
  },
  /**
   * The manifest verb. Its root says who declares it and there are only three: `core.` is Hatua's, `component.` is the Host's, `block.` names a Block in this document. Nothing sits at the root itself, so a Host may declare `component.block.render` and collide with nothing — see ADR-0014.
   * Hatua treats most verbs as opaque, but interprets six structurally: `core.fork` creates branches, `core.for_each` nests and exposes `item`, `core.repeat` nests and carries an `until:` condition, `core.try` nests TWICE — a body under `steps:` and a fallback under `handler:` — `core.map` derives its outputs from its own `entries` field rather than from its manifest, and `core.set_var` writes one of the Board's `vars` and is typed by that var's declaration rather than by a manifest field.
   * The four nesting verbs drive reference scope and derived layout; `core.map` drives reference scope alone; `core.set_var` drives neither and is here because its `value` is a Slot no manifest can type.
   * Two of them BIND a name for the children they own, and both bind it the same way: as an output of the container Step itself, read as `{{steps.<container id>.<k>}}`. A loop's `item` and a try's `error` therefore cost no namespace root and no bare token — ADR-0014 closed the roots precisely so a structural idea could not take a word away from users — and two nested containers cannot shadow each other, because two Steps cannot share an id on one Board.
   * `core.map` is the one component whose outputs a manifest cannot declare, because they are whatever the user named. Its `with.entries` is a list of `{key, value, type}`, and a downstream step addresses them as `{{steps.<id>.<key>}}` with the declared type — which is what lets the type checker treat a mapping step exactly like any other.
   */
  use: z.string().min(1),
  name: z.string().optional(),
  get with() {
    return values.optional()
  },
  /**
   * Fork children. Only meaningful on `core.fork`.
   */
  get branches() {
    return z.array(branch).min(1).optional()
  },
  /**
   * Loop children, nested directly with no branch wrapper. On `core.for_each` and `core.repeat`, and a `core.try`'s protected body.
   */
  get steps() {
    return z.array(step).optional()
  },
  /**
   * A `core.try`'s fallback region, and only meaningful there. The body under `steps:` runs; if it fails, this runs instead of the rest of it.
   * A key beside `steps:` rather than a pair of `branches:` under reserved labels. A Branch's identity is its `label`, which is free text the user renames — putting "which region is this" into a string a user edits makes the meaning of the document depend on a display name, and it costs the schema its first reserved word. A key cannot collide with anything a user chooses, because nothing inside a step is user-named.
   * The failure is exposed to THESE children and to nothing else, as `{{steps.<try id>.error}}` — the container's own output, which is how `core.for_each` already exposes `item`. The body cannot see it, because the body is what produces it; a Step after the try cannot either, because whether there was a failure at all is a run-time fact.
   * Handler children cannot read the body's Steps. The body failed somewhere, and which of its Steps completed is not a property of the document — offering them would make scope an intersection over paths, which is the exact analysis ADR-0013 refuses edges to avoid. It is the same rule that keeps a Fork's sibling branches out of each other's scope, and it needs no code of its own: the two regions are siblings.
   * Error-type matching needs no matcher: a `core.fork` inside the handler branches on `{{steps.<try id>.error.type}}`.
   */
  get handler() {
    return z.array(step).optional()
  },
  /**
   * A `core.repeat`'s termination condition, and only meaningful there. The body runs, then this is evaluated; false runs it again. So a repeat ALWAYS runs its children at least once — which is what lets one discharge a block's return obligation where a `core.for_each` cannot, and what makes a pre-tested loop expressible as a body that starts with a fork while the reverse costs a duplicated body.
   * A structural key beside `steps:` rather than a field under `with:`, for the reason a Branch's `when` is one: a manifest field carries a rendering `kind` and no type, so the expected type is recovered from `FIELD_KIND_TYPES` — and that vocabulary cannot express "a Template that must produce a boolean" at all. Under `with:` the condition would type-check as text, which is the whole half of the contract it exists to carry.
   * Nothing bounds the iterations, and that is deliberate rather than missing: whether an `until` ever goes false depends on run-time values, so unlike recursion it is not a property the document has. Hatua does not execute, so a bound written here would be a number no reader could enforce. Bounding is the Host runner's obligation — see ADR-0013.
   */
  until: z.string().optional(),
})
export type Step = z.infer<typeof step>

export const branch = z.strictObject({
  label: z.string(),
  /**
   * Condition expression. Absent on the fallback branch of a condition fork — order matters there, first match wins, and the last branch may be unconditional.
   */
  when: z.string().optional(),
  get steps() {
    return z.array(step)
  },
})
export type Branch = z.infer<typeof branch>

/**
 * Field values keyed by the manifest's `FieldSpec.k`. Templates remain `{{…}}` strings so the document round-trips and a step can be renamed without breaking a mapping.
 * A `map` field holds a list of `{key, value, type}` objects rather than a scalar — see `core.map` on `use`. That shape is deliberately NOT declared as a `$def` here: which key holds a map field is decided by the Component Manifest, not by this schema, so JSON Schema cannot reach it. It is checked where the manifest is known, in `@hatua/model` and the Go SDK, and an unreferenced definition would be a promise this file does not keep.
 * `key` is how downstream steps address the entry — `{{<step id>.<key>}}`. `type` is declared rather than inferred from `value`, for the same reason every other field's type is: the expression is checked against the declared type, never the reverse.
 */
export const values = z.record(z.string(), z.unknown())
export type Values = z.infer<typeof values>

/**
 * The declarative description of a workflow — its steps, the mapping between one step's typed outputs and the next step's inputs, branches and loops. Read AND written by Hatua, unlike a Workflow Execution which is only ever read.
 * Steps form a TREE, nesting through `branches` (forks) and `steps` (loops); they are never an arbitrary graph. There is deliberately no position data anywhere in this document: node placement is computed from the tree on every render, which is what makes it impossible for a hand-edited file and the flow map to disagree. See ADR-0001.
 */
export const workflowDefinition = z.strictObject({
  /**
   * Stable identity of the workflow, unchanged across every version.
   */
  id: z.string().min(1),
  /**
   * Human name. Free to change; nothing references it.
   */
  name: z.string(),
  /**
   * Monotonic, allocated by Hatua at publish. A Workflow Execution references a workflow by this number, which is why published versions are immutable and retained. A draft carries `base + 1`; discarding it frees that number for reuse, because a number only becomes permanent at publish.
   */
  version: z.number().int().min(1),
  /**
   * A workflow has at most one `published` version and at most one `draft` at any time. Publishing promotes the draft and automatically moves the outgoing published version to `archived`. Two concurrent drafts are forbidden because the second publish would always fail, forcing either a merge or the loss of someone's work.
   */
  status: z.enum(['published', 'draft', 'archived']),
  /**
   * Connections are established OUTSIDE Hatua — it has no server, so it can neither hold a client secret nor receive an OAuth redirect. The Host returns already-established connections and Hatua only picks among them.
   */
  get connections() {
    return z.array(connection).optional()
  },
  /**
   * What starts the workflow. Triggers are NOT steps: they live here rather than in `steps`, and they replace the older `core.start` step entirely. A workflow may declare several; a step addresses one by name as `{{triggers.<id>.<field>}}`, and the built-in `TRIGGER` holds the id of whichever one actually fired.
   * A trigger's declared outputs ARE the workflow's parameter contract — which is why there is no separate `inputs` section.
   */
  get triggers() {
    return z.array(trigger).optional()
  },
  /**
   * Mutable workflow-scoped state, readable as `{{var.<key>}}` and written by `core.set_var`. Distinct from trigger payloads, which arrive from outside. A value may be a literal or an expression, so a var can normalise differently-shaped trigger payloads into one shape.
   * Its type is declared, never read off that value — a `core.set_var` writing it later means the value in the file is an initial value rather than a contract. See ADR-0013.
   */
  get vars() {
    return z.array(variable).optional()
  },
  /**
   * Named, reusable sequences of steps, each invoked as `use: block.<id>`. A block declares what it takes and what it publishes, and reads NOTHING else from the call site — not the workflow's triggers, not its vars. That contract is what lets a block be reached from many call sites while scope stays an exact walk rather than an intersection over paths; see ADR-0013.
   * A list of objects rather than a map, for the reason `vars` is one: a field can be added later without a breaking change to every existing file.
   */
  get blocks() {
    return z.array(block).optional()
  },
  /**
   * The root sequence — the root Board. Every step is an instance of a Component declared by a manifest, or a call to a block declared above.
   */
  get steps() {
    return z.array(step)
  },
})
export type WorkflowDefinition = z.infer<typeof workflowDefinition>
