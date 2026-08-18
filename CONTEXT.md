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

**Reference**:
A `{{source.path}}` token inside a field value that reads an earlier **Step**'s output, a
**Trigger**'s payload, or a workflow variable — `{{s2.messages[].subject}}`,
`{{triggers.nightly.triggered_at}}`, `{{var.digest_to}}`. Stored verbatim in the YAML, so a **Step**
can be renamed without breaking one. There is no "workflow input": a **Trigger**'s declared outputs
are the parameter contract.
_Avoid_: binding, expression, interpolation, variable

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
