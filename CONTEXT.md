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
Editing a **Workflow Definition** graphically — adding, moving and configuring **Steps** on the flow
map, and mapping outputs to inputs. There is nothing to *connect*: reachability is nesting, so the
canvas has no connect affordance, no exit handles and no endpoint a user can attach anything to. It
does draw a line between one **Step** and the next, which is a different claim — the line is chrome
that says "then", carries no data, and is derived from the tree like every other position on the map.
One **Board** is drawn at a time; a **Block** call is a doorway into another, never its body expanded
in place.
_Avoid_: visual mode, graph editor, builder, drawing connections

**Text Mode**:
Editing the same **Workflow Definition** as raw YAML text inside Hatua's own UI.
_Avoid_: code mode, source view, raw editor

**Step**:
One node of a **Workflow Definition** — an instance of a **Component**, carrying an `id` that is
stable and unique within its **Board**, a display name, and its field values under `with:`. Steps
form a *tree*, nesting through branches and loops; they are never an arbitrary graph.
_Avoid_: node, task, action, block

**Board**:
One drawable **Step** tree together with the root that gives it its parameters — the *root Board*,
whose root is the **Triggers**, or a **Block**'s, whose root is its declared contract. A
**Workflow Definition** holds one root Board plus one per **Block**. A Board is the unit scope is
computed against: a **Step** sees only what its own Board offers, plus the **Run Context**, which is
the one thing every Board shares. **Canvas Mode** draws one at a time.
_Avoid_: canvas, graph, sheet, scope

**Component**:
A step *type*, addressed by a verb whose root says who declares it — `core.fork` is Hatua's,
`component.email.send` is a **Host**'s, `block.archive_entry` is this document's. A **Step** is an
instance of one. Adding a Host component is adding a **Component Manifest** entry; no screen-level
code follows.
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
payload, or a variable — `{{steps.s2.messages[].subject}}`, `{{triggers.nightly.triggered_at}}`,
`{{var.digest_to}}`. Every path begins with one of six roots — `run.`, `triggers.`, `params.`,
`steps.`, `var.` and the built-in `TRIGGER` — so a name a user chooses always sits below a root and
can never collide with one. Stored verbatim in the YAML, so a **Step** can be renamed without
breaking one.
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
what distinguishes it from the **Template** it holds. **The type is never inferred from the
expression**, and it comes from one of three places: the **Component Manifest**'s field, a
declaration in the document (a **Block**'s `params`/`outputs`, a **Variable**'s `t`), or the
language — a **Branch**'s `when` and a **Repeat**'s `until` are boolean because a condition is.
_Avoid_: binding, target, assignment, field value

**Variable**:
Named mutable state declared under a **Board**'s `vars:` and read anywhere on it as `{{var.<key>}}`,
regardless of where it was written — which is what lets a **Repeat**'s body carry something back to
a **Step** that runs before it. **Its type is declared, in `t`, never read off its value**: `value`
is only the *initial* value, because `core.set_var` writes the same variable from a **Step**. A
Board's variables are its own — the workflow's at the root, a **Block**'s inside one, rebuilt on
every invocation — so a `core.set_var` can never reach out of the Board it is on.
_Avoid_: state, global, parameter, field

**Mapping**:
A **Step** (`core.map`) whose outputs are the entries the user wrote into it rather than anything
its **Component Manifest** declares. It is the one verb Hatua interprets structurally by reading a
field's *value* rather than a position in the tree — `core.fork`, `core.for_each`, `core.repeat` and
`core.try` are all read from where their children sit. Each entry is a key, a **Template** and a declared type, so a downstream
**Step** addresses `{{steps.s8.headline}}` and type-checks against it like any other output.
_Avoid_: transform, set variables, assign, formula step

**Block**:
A named, reusable sequence of **Steps** declared once in a **Workflow Definition** under `blocks:`
and invoked as `use: block.<slug>`, taking declared parameters and publishing declared outputs via
`core.return`. It is what serves reuse and what keeps a deep workflow readable — extracting one
flattens the tree exactly as extracting a function does. A **Block** is reachable from many call
sites without making the model a graph, because it reads only what it declares: its own **Board**
and the **Run Context**, never the workflow's **Triggers** or variables. A Block may call a Block;
recursion is refused.
_Avoid_: subflow, subroutine, group, macro, function

**Fork**:
A container **Step** (`core.fork`) holding two or more **Branches**, in either `condition` mode
(first match wins, last branch is the fallback) or `parallel` mode.
_Avoid_: conditional, switch, if-node, gateway

**Branch**:
One labelled child path of a **Fork**, with an optional `when` condition and its own nested steps.
Order is meaningful in a condition fork.
_Avoid_: path, case, leg

**Repeat**:
A container **Step** (`core.repeat`) that runs its children, then evaluates its `until` condition,
and runs them again while that is false. **The body always runs at least once**, which is what
distinguishes it from `core.for_each` — a list may be empty — and what lets one discharge a
**Block**'s obligation to reach a `core.return`. `until` sits beside `steps:` rather than under
`with:`, because a **Component Manifest** field carries a rendering kind and cannot say "a
**Template** that must produce a boolean". It binds nothing: a counter is a **Variable**, written
by `core.set_var`. Nothing in the document bounds the iterations — a runner imposes its own ceiling.
_Avoid_: while, do-while, until-loop, retry

**Try**:
A container **Step** (`core.try`) with **two** child regions where every other container has one: a
protected body under `steps:`, and a fallback under `handler:` that runs if the body fails.
**Wrapping one Step is retry; wrapping a region is fallback**, so one verb serves both. The two
regions are *siblings* — the body cannot see the handler, and the handler cannot read the body's
**Steps**, because which of them completed before the failure is not a fact the document holds. Its
retry policy lives under `with:` as ordinary **Component Manifest** fields, because a count and a
delay are numbers and `number` is a mappable field kind — the argument that put a **Repeat**'s
`until` beside `steps:` was about booleans and does not reach here. It discharges a **Block**'s
obligation to reach a `core.return` only when *both* regions return. Error-type matching needs no
matcher: a **Fork** inside the handler branches on the failure's `type`.
_Avoid_: catch, rescue, error handler, on-error branch

**Binding**:
A name a container puts into the scope of the children it owns — a **Loop**'s `item`, a **Try**'s
`error`. **A binding is an output of the container Step itself**, read as
`{{steps.<container id>.<k>}}`, which is one mechanism rather than two and costs no namespace root
and no bare token: ADR-0014 closed the roots precisely so a structural idea could not take a word
away from users, and a **Step** id already sits one segment below `steps.`. Nesting needs no
shadowing rule, because two containers are two Step ids.
_Avoid_: variable, loop variable, context, implicit

**Item**:
A **Loop**'s **Binding**: one element of the list its `list` field names, read as
`{{steps.<loop id>.item}}`. Declared `t: item` in the **Component Manifest**, which is the one type
whose meaning depends on the **Step** declaring it — the shape is not in the manifest at all, but is
resolved by following `list` to its source output's `of:`. Where it cannot resolve, `item` stays
`item` and matches anything, and the wrongness is reported against the *list* rather than guessed
into a shape.
_Avoid_: element, current, each, loop var

**Derived Layout**:
The rule that a **Step**'s position on the flow map is computed from the tree on every render and
never persisted. This is what guarantees a hand-edited **Workflow Definition** and the map can never
disagree.

A **Placement** is one Step's box on the map, named by the **Board** it is on and its id together —
never by a bare id, which two **Blocks** may share. The map is laid out one **Board** at a time
(ADR-0013), and what it takes besides the Board is which containers are drawn collapsed: chrome, the
one input that is not a function of the document, and the reason the totals describe the map that is
actually on screen rather than one with folded regions counted into it.

Cards are not all of it. A **Link** is one gap — where the flow leaves one thing and arrives at the
next, and where a Step goes if one is added there; a **Band** is one child region's extent; a **Join**
is where a **Fork**'s **Branches** come back together. All three are computed here, because the canvas
draws what it is handed and works nothing out for itself. That is what makes the rule checkable
rather than merely stated: a region with nothing in it has no card to infer a box from, so a canvas
without a Band would have had to invent one.

There is **one Link per gap in every step list**, which is one more than the list is long — the same
count `<StepList>` draws between its rows. That is what makes the canvas a surface a workflow can be
built on rather than a picture of one.

Positions are the builder's and nobody else's. A **Host** runner never lays anything out, so this is
the one cross-cutting rule in the repo implemented once rather than in both languages.
_Avoid_: auto-layout as a mere feature name — it is a constraint, not a convenience; node position
as something a document could carry

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

**"Drawing connections"** — the **Canvas Mode** entry described a graph editor, contradicting **Step**
and **Derived Layout** in this same file. Resolution: there are no connections to draw. Control flow
is expressed by containers — `core.fork`, `core.for_each`, `core.repeat`, `core.try` — and a **Step**
runs because of where it nests. Reuse is a **Block**, not an edge into a shared node.

That refuses a connection as a *thing in the model*, and ADR-0013 refuses an edge a user can attach
anything to. Neither refuses a plain **line** between two cards, and the canvas draws one: at
`LAYOUT.verticalGap` of 96px, two cards that follow each other read as two unrelated things, and the
line is what says "then". It is chrome the geometry places, it holds nothing, and there is no endpoint
on it for a pointer to grab. Where the flow does something a column cannot say — a **Fork**'s
alternatives, and where they converge — a **Band** and a **Join** say it.

**"Block" the domain term vs the React presentational layer** — a layer of presentational units
(NodeCard, Connectors, RegionBand) shared the word with **Block**, which is the *Flow tab* / `FlowMap`
collision again: one word, two meanings, in one repo. Resolution: the domain term wins. That layer is
`packages/react/src/units/`, and a presentational unit is never called a block.
See [ADR-0013](docs/adr/0013-control-flow-nests.md), which also corrects ADR-0001's reason for the
constraint: cross-links break exact static scope, not derived layout.

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
