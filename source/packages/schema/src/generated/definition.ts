// GENERATED — do not edit.
// Source: schemas/workflow-definition.schema.yaml
// Regenerate: pnpm --filter @hatua/codegen build
import { z } from 'zod'

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
    id: z.string().min(1),
    /**
     * The manifest verb, e.g. `core.schedule` or a Host-supplied `email.received`.
     */
    use: z.string().min(1),
    /**
     * Display name.
     */
    name: z.string().optional(),
    get with() { return values.optional() },
  })
export type Trigger = z.infer<typeof trigger>

/**
 * A list of key/value objects rather than a map, so a `type` or `label` can be added later without a breaking change to every existing file.
 */
export const variable = z.strictObject({
    key: z.string().min(1),
    /**
     * A literal, or an expression evaluated by the SDK's shared evaluator.
     */
    value: z.unknown(),
  })
export type Variable = z.infer<typeof variable>

export const step = z.strictObject({
    /**
     * Stable, and what References point at. This is why renaming a step never breaks a mapping.
     */
    id: z.string().min(1),
    /**
     * The manifest verb, e.g. `email.send`. Hatua treats most of these as opaque, but interprets the control-flow verbs structurally: `core.fork` creates branches, `core.for_each` nests and exposes `item`, and both drive reference scope and derived layout.
     */
    use: z.string().min(1),
    name: z.string().optional(),
    get with() { return values.optional() },
    /**
     * Fork children. Only meaningful on `core.fork`.
     */
    get branches() { return z.array(branch).optional() },
    /**
     * Loop children, nested directly with no branch wrapper. Only on `core.for_each`.
     */
    get steps() { return z.array(step).optional() },
  })
export type Step = z.infer<typeof step>

export const branch = z.strictObject({
    label: z.string(),
    /**
     * Condition expression. Absent on the fallback branch of a condition fork — order matters there, first match wins, and the last branch may be unconditional.
     */
    when: z.string().optional(),
    get steps() { return z.array(step) },
  })
export type Branch = z.infer<typeof branch>

/**
 * Field values keyed by the manifest's `FieldSpec.k`. References remain `{{…}}` strings so the document round-trips and a step can be renamed without breaking a mapping.
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
    get connections() { return z.array(connection).optional() },
    /**
     * What starts the workflow. Triggers are NOT steps: they live here rather than in `steps`, and they replace the older `core.start` step entirely. A workflow may declare several; a step addresses one by name as `{{triggers.<id>.<field>}}`, and the built-in `TRIGGER` holds the id of whichever one actually fired.
     * A trigger's declared outputs ARE the workflow's parameter contract — which is why there is no separate `inputs` section.
     */
    get triggers() { return z.array(trigger).optional() },
    /**
     * Mutable workflow-scoped state, readable as `{{var.<key>}}` and written by `data.set_var`. Distinct from trigger payloads, which arrive from outside. A value may be a literal or an expression, so a var can normalise differently-shaped trigger payloads into one shape.
     */
    get vars() { return z.array(variable).optional() },
    /**
     * The root sequence. Every step is an instance of a Component declared by a manifest.
     */
    get steps() { return z.array(step) },
  })
export type WorkflowDefinition = z.infer<typeof workflowDefinition>
