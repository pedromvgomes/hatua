# Hatua

An embeddable workflow designer. Hatua edits and renders workflow YAML inside a **Host**
application; it has no runtime, no storage and no server of its own.

It is not, however, front-end only: Hatua also ships SDKs so a **Host**'s runner can read the same
contract and evaluate the same **References** the builder wrote. Hatua still never executes a
workflow — it provides libraries, not a runtime.

## Language

**Workflow Definition**:
The declarative description of a workflow — its steps, the mapping between one step's typed outputs
and the next step's inputs, branches and loops. Read *and* written by Hatua.
_Avoid_: workflow, spec, pipeline, DAG

**Workflow Execution**:
The record of one past or in-flight run of a **Workflow Definition**, handed to Hatua by the **Host**
and rendered as run history. Read-only — Hatua never produces one.
_Avoid_: run, history, trace, instance

**Host**:
The application embedding Hatua. Owns the **Workflow Definition** file, its storage, the
**Component Manifest** set, and the runner that executes workflows. Hatua is a guest in it.
_Avoid_: consumer, client, parent app

**Component Manifest**:
The **Host**-supplied declaration of a step type available to a **Workflow Definition** — its
identity and its typed input and output contract. Hatua treats these as given and never invents them.
_Avoid_: node type, block, plugin, component spec

**Canvas Mode**:
Editing a **Workflow Definition** graphically — dragging steps, drawing connections, mapping outputs
to inputs.
_Avoid_: visual mode, graph editor, builder

**Text Mode**:
Editing the same **Workflow Definition** as raw YAML text inside Hatua's own UI.
_Avoid_: code mode, source view, raw editor

**Step**:
One node of a **Workflow Definition** — an instance of a **Component**, carrying a stable `id`, a
display name, and its field values under `with:`. Steps form a *tree*, nesting through branches and
loops; they are never an arbitrary graph.
_Avoid_: node, task, action, block

**Component**:
A step *type* declared by a **Component Manifest** — `email.send`, `core.fork`. A **Step** is an
instance of one. Adding a component is adding a manifest entry; no screen-level code follows.
_Avoid_: block, plugin, node type, activity

**Template**:
The whole value of a mappable field — literal text with **Expression** holes in `{{ … }}`. What the
evaluator is handed, always together with the type the field expects it to produce.
_Avoid_: interpolation, string template, format string

**Expression**:
The code inside one `{{ … }}`, evaluated to a single typed value. A **Reference** is its simplest
form; the rest of the language exists so a **Template** can choose, compare and reshape without the
**Host** writing code.
_Avoid_: formula, script, code, binding

**Reference**:
An **Expression** that is exactly one path, reading an earlier **Step**'s output, a **Trigger**'s
payload, or a workflow variable — `{{s2.messages[].subject}}`, `{{triggers.nightly.triggered_at}}`,
`{{var.digest_to}}`. Stored verbatim in the YAML, so a **Step** can be renamed without breaking one.
It is a *shape*, not a syntax: no marker distinguishes one, so what makes a **Reference** special is
that it names a value and nothing more — which is exactly what lets the builder draw it as a pill
the user can retarget. There is no "workflow input": a **Trigger**'s declared outputs are the
parameter contract.
_Avoid_: binding, interpolation, variable

**Function**:
A named operation an **Expression** may call, always as `namespace.name(…)` — `dt.now()`,
`text.upper(s1.subject)`. Hatua ships a core set and a **Host** declares its own in a function
manifest; the format is identical and the only difference is who wrote the file. Hatua never
implements a **Host**'s function: it reads the signature so the builder can offer and check it, and
the **Host**'s runner supplies the code. The `(` is what distinguishes a call from a path, which is
why a namespace needs no reserved word and a step may still be called `crm`.
_Avoid_: helper, macro, formula, built-in

**Slot**:
A named **Template** together with the type it must produce — `{name: "to", template: "{{
var.digest_to }}", expectedType: text}`. It names the *place* something is resolved into, which is
what distinguishes it from the **Template** it holds. The type is always the field's, declared by
the **Component Manifest** or — for a **Branch**'s `when` — by the language; it is never inferred
from the expression.
_Avoid_: binding, target, assignment, field value

**Mapping**:
A **Step** (`data.map`) whose outputs are the entries the user wrote into it rather than anything
its **Component Manifest** declares. It is the third verb Hatua interprets structurally, alongside
`core.fork` and `core.for_each` — and the only one read from a field's *value* rather than from its
position in the tree. Each entry is a key, a **Template** and a declared type, so a downstream
**Step** addresses `{{s8.headline}}` and type-checks against it like any other output.
_Avoid_: transform, set variables, assign, formula step

**Fork**:
A container **Step** (`core.fork`) holding two or more **Branches**, in either `condition` mode
(first match wins, last branch is the fallback) or `parallel` mode.
_Avoid_: conditional, switch, if-node, gateway

**Branch**:
One labelled child path of a **Fork**, with an optional `when` condition and its own nested steps.
Order is meaningful in a condition fork.
_Avoid_: path, case, leg

**Derived Layout**:
The rule that a **Step**'s position on the flow map is computed from the tree on every render and
never persisted. This is what guarantees a hand-edited **Workflow Definition** and the map can never
disagree.
_Avoid_: auto-layout as a mere feature name — it is a constraint, not a convenience

**Published Version**:
An immutable, numbered snapshot of a **Workflow Definition**, carrying `status: published`. Exactly
one is live at a time; earlier ones become `archived` on the next **Publish** and are retained
because a **Workflow Execution** references the version it ran against.
_Avoid_: revision, release, snapshot

**Draft**:
The single mutable working copy of a **Workflow Definition** — a real version file numbered
`base + 1` and carrying `status: draft`. At most one exists per workflow: two would guarantee the
second **Publish** fails, forcing either a merge or the loss of someone's work. Discarding one frees
its number, because a number only becomes permanent at **Publish**.
_Avoid_: working copy, unpublished version, WIP

**Publish**:
Promoting the **Draft** to a new **Published Version**. The moment a version number becomes
permanent, the outgoing version is archived, and the **Host** rejects the whole operation if the
version the draft branched from is no longer the live one. Conflict is detected here and nowhere
else, because only publish can collide.
_Avoid_: commit, release, deploy, save

**Trigger**:
What starts a workflow. A **Trigger** is *not* a **Step** — it lives in its own section of the
**Workflow Definition**, and its declared outputs are the workflow's parameter contract. A workflow
may declare several, addressed by name.
_Avoid_: start node, entry point, event, hook

**Connection**:
A workflow-local name bound to an opaque handle for something the **Host** already connected — a
mailbox, a model. Hatua never establishes one: it has no server, so it can hold no client secret and
receive no redirect. Everything shown about a **Connection** comes from asking the **Host** to
describe its handle.
_Avoid_: credential, integration, account, connector

## Flagged ambiguities

**"Expression" vs "Reference"** — these were one term with the other on its avoid list, which
stopped working the moment `{{ … }}` held more than a path. Resolution: they are now distinct and
nested. An **Expression** is the code inside one `{{ … }}`; a **Reference** is an **Expression**
that is exactly one path and nothing more. The distinction is structural, not syntactic — no marker
tells them apart, and `isReference()` answers by looking at the parsed shape. That is also why the
`REFERENCE_PATTERN` regex was retired: it was a second definition of the same term, and it already
disagreed, matching `{{ a + b }}` and calling the whole thing a path.

**"Reads and writes YAML"** — the root README's phrasing hides that the two payloads flow in
opposite directions. Resolution: a **Workflow Definition** is read and written; a **Workflow
Execution** is only ever read. Never say "the YAML" without naming which.

**"We don't own the file"** — means Hatua does not own its *formatting or lifecycle*, not that it
never writes. Hatua does write **Workflow Definitions**; it must return them with the **Host**'s and
the user's comments, key order and style intact.

**"Tumika" vs "Hatua"** — the design handoff names the product *Tumika workflow builder* and its
design system *Tumika*. Tumika is a self-hostable personal assistant that runs scheduled routines;
Hatua is this repo, the embeddable builder. Their tokens are byte-identical (ink `#232d47`, accent
`oklch(0.63 0.115 195)`, Space Grotesk), so Hatua's brand is cut from Tumika's system.
Resolution: Tumika is **one possible Host**, nothing more — Hatua ships its own primitives and
depends on no Tumika code (see [ADR-0002](docs/adr/0002-hatua-ships-its-own-primitives.md)). Say
**Host** when meaning "the app embedding Hatua"; name *Tumika* only when meaning that specific
product. The design handoff's instruction to build from "the Tumika component library" does not
apply here.

## Example dialogue

> **Dev:** If someone drags a step on the canvas, do we regenerate the YAML file?
> **Domain expert:** We rewrite it, but we don't get to reformat it. That file might be hand-written
> and sitting in their git repo with comments all over it.
> **Dev:** So a canvas edit has to land as a surgical change to their text, not a fresh serialisation?
> **Domain expert:** Right. And remember they can be editing that same text in our own Text Mode, so
> both directions have to agree.
> **Dev:** And a Workflow Execution — could someone edit one of those?
> **Domain expert:** No. That's history. We render what the Host hands us and that's it.
