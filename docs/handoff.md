# Handoff: the workflow builder

This is the design of record. It replaces the original `design_handoff_workflow_builder` bundle,
which was written before the domain model existed and has been overtaken in several places — see
[What the original handoff got wrong](#what-the-original-handoff-got-wrong) at the end, which names
each one rather than leaving the two documents to disagree quietly.

Read `CONTEXT.md` first for the vocabulary. Every capitalised term here — **Step**, **Component**,
**Template**, **Expression**, **Reference**, **Function**, **Trigger**, **Slot** — is defined there
and is used in that sense and no other. `docs/adr/` holds the decisions that constrain what follows.

## Fidelity

Colours, type, spacing, radii and motion come from the bound design system and are final. Every
value below is a token; prefer the token over the literal. The one thing the system has no component
for is the **Template input**, and it is specified in full.

---

## The screen

Three regions under a toolbar. Positions on the canvas are **derived, never stored** (ADR-0001: a
file a user hand-edits must not gain keys about what a session had laid out where).

```
┌──────────────────────────────────────────────────────────────────────┐
│ TopBar    workflows / Nightly digest · nightly-digest · v5 · Draft   │
├───────────────┬──────────────────────────────┬───────────────────────┤
│ Side panel    │ Canvas                       │ Step editor           │
│ 304px         │ fills                        │ 372px                 │
│               │                              │  ← expands into the   │
│ Components    │  the Step tree, laid out     │    Data panel         │
│ Workflow      │  the start node on top       │                       │
│ (Flow)        │                              │                       │
└───────────────┴──────────────────────────────┴───────────────────────┘
```

**The canvas is how a workflow is built.** That is the change of emphasis from the original handoff,
which put a Step *list* in a tab and left the canvas as one of three things a tab could show. A
canvas that is visible only while one tab is open, and never beside the panel it is edited from, is
not a canvas — `views/README` and ADR-0011 both make this argument about version navigation for the
same reason.

**The Flow tab survives as an option, not a default.** `<StepList>` is a real region and a dense,
scannable, keyboard-reorderable view of the tree; a Host that wants it mounts it. Hatua's own
`<Build>` does not show it once the canvas can select a Step. **Until the canvas can select, the
Flow tab stays in the default set** — dropping it earlier leaves no way to choose a Step at all.

### Which tabs, in which view

| View | Tabs |
| --- | --- |
| Build | **Components**, **Workflow** |
| Runs | **Workflow** (read-only), **Runs** |

`<TabbedPanel>` arranges regions and owns none of them, so which tabs exist is the caller's
decision. A Host mounting one region gets no tab strip at all.

---

## TopBar

Left cluster carries identity: `workflows /`, the workflow's name, its slug, then the version
control — `v5 · Draft`, opening to a list from `listVersions`, newest first, paged, each with its
status spelled `draft | published | archived` as the schema spells it.

Right cluster carries **Build / Runs**, then **Publish**, **Release**, **Discard**.

There is no **Save changes** button. Editing autosaves (ADR-0005), and the flag behind that button
is not a thing to render.

**Version and status appear here and nowhere else.** ADR-0011 settled it: a property of the whole
document, shown behind a tab, is visible only while that tab is open, and the canvas, the step
editor and the run history would all still be showing v5 with nothing on screen saying so. The
Workflow tab *edits* the name and slug; the top bar *shows* them. Display and edit, one surface
each.

---

## Components tab

The Component Manifests a Host serves, as cards ready to be added to the Workflow Definition as
Steps.

Renamed from "Library". **Component** is the glossary term; "Library" appears nowhere in the domain
language, and the region is `<Components>` so the label and the region name are the same word. That
is not tidiness — Build.tsx and regions.test.tsx both document at length what happened when the tab
labelled *Flow* and the region called `FlowMap` became two different things wearing one name.

The rename is only honest because **Triggers move out**. The catalogue used to render two `kind`s;
adding a Trigger now happens in the Workflow tab, so this tab is Components and nothing else.

Layout: `Input size="sm" icon="search"` (*Search components*), then groups. Group heading is
`--type-overline`, uppercase, `--tracking-overline`, `--text-muted`. Cards are 1px `--border-subtle`,
`--radius-md`, `padding: 9px 10px`, `gap: 6px`, `cursor: grab`, hover `--border-accent` +
`--surface-sunken`. Each shows the icon coin, name (`--type-label`), a one-sentence blurb
(`--type-caption`, `--text-secondary`) and a mono line `5 inputs · 2 outputs · email.fetch`.

`once: true` Components already placed render at `opacity: 0.45` and refuse insertion with a toast.
When an insertion point is pending, a `--accent-wash` strip sits above the list: *Pick a component
to drop into the flow.*

---

## Workflow tab

Everything scoped to the workflow rather than to a Step. Three sections, one divider between each.

### 1. Identity

The name and the slug, as labelled `Input`s. This is the first region that edits the document
outside the Step tree.

A 304px panel with two labelled fields is a better place to rename a workflow than an inline-edited
breadcrumb, and it keeps the top bar to display.

### 2. Triggers

The workflow's `triggers[]`. Add, remove, and edit each one's fields; picking a *type* reads the
same manifest store, filtered to `kind: 'trigger'`.

**A Trigger is not a Step.** `doc.triggers[]` is a top-level list; `scopeFor` emits `triggers.<id>`
per trigger, plus a `TRIGGER` builtin when more than one exists so an Expression can branch on which
one fired. A single `core.start` Step cannot express two Triggers, and ADR-0006 makes the schema the
source of truth, so `core.start` is retired.

The canvas still draws a **start node** above the first Step, derived from `doc.triggers[]`. Drawing
it as chrome rather than as a `steps[]` entry is what makes the original handoff's `once: true` and
`fixed: true` flags unnecessary: `removeStep` cannot find it, `walkSteps` does not yield it, and
`unknownComponents` does not flag it. The guarantees come from the model instead of from two
booleans.

### 3. Workflow variables

Rows of two mono `Input size="sm"` — key 118px, value flexible — plus a ghost trash button, then
`Button size="sm" variant="secondary" icon="plus"` **Add variable**.

**A variable's value is a Template**, not a literal. It may hold `{{ … }}`, so the value input is a
[Template input](#the-template-input) like any other, and it gets the same completion.

What it can read is the **unpositioned scope**: Run Context, Triggers, and earlier variables. Never
Step outputs — a variable has no position in the tree, so no Step is guaranteed to have run. That
subset already exists inside `scopeFor`, which computes it before appending upstream Steps; extract
it as `workflowScope(doc, runContext)` and let `scopeFor` be that plus the Steps, so the two readers
share one definition.

**A variable field is the one input with no type marking**, because `varType` in `model/scope.ts`
infers a variable's type *from* its value. There is nothing to check it against.

Editing a variable therefore changes what downstream Expressions type-check against. That is
correct, and it needs a test: change a variable from text to a number and a field reading it changes
verdict. It runs through `@hatua/expressions` with `scopeFor` output — not through the validation
store, which checks required fields, unknown components and malformed containers, and does no
expression type-checking at all.

#### Renaming a key

A Reference is stored verbatim, so `{{ var.old_name }}` does not follow a rename.

**A rename is allowed and does not rewrite References.** The Reference goes stale and the checker
reports it, exactly as it does for a Step that was removed. Rewriting every Template on a keystroke
would edit the user's file in places they are not looking, and mid-typing every intermediate key is
a rename too. Warning without acting would be a dialog on every character.

The consequence — a stale Reference — is already a state the model has, already detected, and
already surfaced. This adds no new failure mode; it declines to invent a repair mechanism for one
that is visible.

---

## Run Context

**New concept.** Ambient values the Host supplies at run time and Hatua only reads: the run id, the
tenant, the caller's IP, when the run started, who triggered it.

Without it a workflow can read nothing the Host knows that did not arrive in a Trigger payload,
which forces every Host to stuff the same fields into every Trigger.

- **Addressed as `run.`** — `{{ run.id }}`, `{{ run.tenant }}`. It sits beside `triggers.` and
  `var.`, and it says what the values are: properties of *this execution*.
- **Directly readable by any Step.** Mapping it into a variable is optional normalisation, not a
  required gateway. One rule for every unpositioned source rather than a special case only Run
  Context has.
- **Unpositioned**, like Triggers and variables, so it is in scope everywhere — including inside a
  variable's own value.
- **A fourth `ScopeEntry.kind`**, `'context'`, beside `step`, `trigger`, `var` and `builtin`.

The Host declares the shape; Hatua never invents one. Same bargain as ADR-0007 (connections) and
ADR-0010 (functions): a declared shape Hatua reads so the builder can offer and type-check it, and
values the Host's runner supplies. Hatua still never executes.

**Delivered as a third manifest kind** — `kind: context`, its own schema file, served through the
existing `ManifestSource` alongside components and triggers. Its own *file*, not a third `kind:`
inside the Component Manifest: `function-manifest.schema.yaml` explains why a conditional manifest
shape would need the JSON-Schema-to-zod generator to grow `if`/`then`, which ADR-0006 keeps
deliberately narrow. Its own *port* was the alternative and buys nothing — a second store, second
loading and failure states, second wiring — for a payload that is a handful of typed keys, when
`ManifestSource` already returns a flat array whose entries carry `kind`.

---

## Expression editing

The substantial half of the builder, and the part the original handoff specified least.

Three places hold a Template, and all three use the same widget:

| Site | Where it is edited |
| --- | --- |
| A Step's mappable `with:` fields, including `map` entries | Step editor |
| A Branch's `when` | Step editor, via its Fork |
| A workflow variable's value | Workflow tab |

### The Template input

`min-height` 40px (76px for textarea), `--radius-md`, 1px `--border-strong`, `--surface-card`,
`padding: 8px 10px`, `cursor: text`, mono. Border `--border-accent` while focused or on drag-over
(fill `--accent-wash`), `--status-error` when the field has an issue.

The text is the editing surface. `{{ … }}` is highlighted in place — `--accent-wash` fill, 1px
`--border-accent`, `--text-accent` — and an unclosed hole takes a wavy `--status-error` underline. It
is never replaced by a widget you cannot type through.

### Four ways in, one set of candidates

| Trigger | What opens |
| --- | --- |
| Typing `{{` | Inline completion — ghost text plus a list, anchored at the caret |
| `Ctrl`+`Space` **inside** a hole | The same completion list |
| `Ctrl`+`Space` **outside** a hole | The picker, anchored at the caret |
| The ⚡ button (40px, right of the field) | The picker, anchored to the button |
| Double-click a `{{ … }}` | The picker, scoped to that hole — the choice **replaces** it |

Two surfaces, not one, and deliberately: a 392px tabbed panel appearing on every keystroke would be
unusable, and a compact caret-anchored list is a poor place to browse. What is identical is the
candidates and the insert semantics.

**Completion follows typing, never caret placement.** Clicking into a hole to fix a character must
not bury the field under a popup — that made an existing Template harder to edit than to write.

**`Ctrl` alone.** `Cmd+Space` is Spotlight and `Ctrl+Cmd+Space` is the Emoji picker; neither ever
reaches the page on a Mac. `Ctrl+Space` collides only with input-source switching, and only for
users with two or more sources. It is an accelerator, never the only route — ⚡ is Tab-reachable, so
a Host page or an OS swallowing the shortcut locks nobody out. If the collision proves real, `Ctrl+.`
is the fallback no macOS default claims. One binding, not two.

### The completion list

30px rows: the left rail, the mono label with the typed prefix in `--text-accent`, and the type at
the right in `--type-badge`/`--text-muted`. Selected row takes `--accent-wash`. A docstring strip
sits under the list showing the focused row's summary.

- **Top level** (before any dot) offers the scope roots — `run`, `var`, `triggers`, and each
  upstream Step — then the Function namespaces `dt`, `text`, `num`, `list`, `json`, **as a second
  block, not interleaved**. Sorted by label alone, `json`, `list`, `num` and `text` land in among the
  Step names and the list reads as unrelated rows rather than *what I can read* then *what I can
  call*. Nothing is hidden; one character narrows to whichever block was meant.
- **After a namespace dot** (`dt.`) offers that namespace's Functions, inserting `dt.now(` with the
  caret between the parens.
- **After a scope dot** (`s1.`) offers that node's members and no Functions. A `list` member yields
  two rows: the whole list, and `[]` — each element — which is navigable further.

**Ghost text and the list, not one or the other.** The ghost completes the common prefix and gives
the fast path; the list is how anyone discovers members of `s1.messages[]` they do not know. At a
dot with no common prefix there is no ghost, and the list alone is the answer.

Keys: `↑↓` move, `Enter` accepts, `→` accepts the ghost at end-of-value, `Esc` dismisses. **`Tab`
accepts only while the list is open** and otherwise falls through to focus movement — Hatua is a
guest in someone's page and cannot trap focus.

Accessibility: the input is a `combobox` with `aria-autocomplete="both"`, `aria-expanded`,
`aria-controls` and `aria-activedescendant` over a `listbox`. Ghost-text-and-Tab alone is invisible
to a screen reader.

### Signature help

While the caret is inside a call, a strip above it shows `dt.add(value: datetime, amount: number,
unit: text) → datetime` with the active parameter emphasised and its description beneath. Active
parameter is the comma count at depth zero.

### The picker

392px, `--surface-raised`, `--radius-lg`, `--shadow-overlay`, 9px padding. Header reads **Insert**;
the tabs carry the nouns, so a header restating them says it twice.

Rendered in a fixed-position layer anchored to the caret or the button's rect, **not inside the
scrolling step editor**. It flips above when there is less room below *and* more above — a fixed
threshold flipped it above a button with 460px of space and ran it off the top of the viewport — and
caps its body to the space that exists either way.

Two tabs, **Reference** and **Function**: the two shapes an Expression can take (CONTEXT.md — "a
**Reference** is an **Expression** that is exactly one path"). Not "Variable", which the glossary
lists on Reference's *Avoid* line and which would be wrong anyway: the tree holds Step outputs,
Trigger payloads and Run Context alongside variables.

A tab strip rather than opening onto References with a link across: three entry points and two
modes, and a link would bury the half that most needs discovering.

Both tabs open with **the same control in the same place** — a source `<select>`, then a sentence
describing the selection, then rows. A Step and a namespace are the same kind of choice. A `<select>`
rather than chips because five namespaces fit on one line and thirty Steps do not.

- **Reference** — sources are *Everything in scope* (default), then Run context, Workflow variables,
  Triggers, and each upstream Step. Rows are 30px, hover `--accent-wash`, carrying the mono path and
  the type. Group headers (icon coin, name, mono step id) show only under *Everything*; with one
  source selected the `<select>` already says which. Rows are `draggable`; clicking inserts.
- **Function** — sources are *All namespaces* (default) then each namespace, whose `summary` is the
  sentence beneath. Picking a Function opens the **inserter**.

### The inserter

One row per parameter: the name, its type as a badge, `optional` where it applies, **the parameter's
description as a sentence**, and an input. A live preview composes the call, with unfilled
parameters shown as `<name>`. **Insert** writes it at the caret.

It **inserts and never round-trips.** It composes text and writes it; it never reconstructs itself
from text already there. That distinction is what makes it safe: a round-tripping editor would need
AST→text, which the Peggy grammar does not provide — Peggy gives text→AST — and hand-writing it is a
second implementation of the grammar that will disagree with the first. Reopening the inserter starts
fresh. Should the round-trip ever be wanted, it deserves an ADR.

The parameter descriptions and the namespace summaries are the reason PR #13 exists; they are in
`CORE_NAMESPACES` and `ParamSpec.description`. **Read `CORE_FUNCTIONS`, never `coreFunctions()`** —
the latter builds the runtime registry and pulls all thirty-four implementations into a Host's
bundle, which is what `functions/registry.ts` warns about at the top of the file.

### The type marking

A **left rail** on every row in the completion list and both picker tabs, neutral by default and
`--status-ok` green when the row produces the type the field declares.

- **A rail, not a dot.** The dot the original handoff specified encoded *this is a list*, which the
  type column at the right already says in words.
- Draw it as a pseudo-element with its own geometry. An inset `box-shadow` follows the row's
  `border-radius` and bows into a bracket.
- **Exact match only.** ADR-0009 forbids coercion outright — `1 == '1'` is false — so there is no
  assignability lattice to consult.
- **Nothing is ever marked wrong.** Neutral covers *does not fit* and *cannot be judged* alike, which
  keeps `unknown` from being painted red. ADR-0009's line — errors block Publish, never editing —
  applies to the picker too. It guides; it does not refuse.
- No legend. The field label already carries its type badge, and a swatch-plus-sentence at the top of
  the panel attaches itself to the source description above it.

### Drag

Leaves are `draggable` and fields are drop targets. The payload:

| MIME | Content |
| --- | --- |
| `application/x-hatua-reference` | The bare path — `s1.messages[].subject` |
| `text/plain` | The wrapped Template — `{{ s1.messages[].subject }}` |

Two types because a drop into a Hatua field wants the path (the field decides the delimiters and
whether it appends or replaces), and a drop into any other editor on the page should still paste
something meaningful.

Dropped tokens are **spaced on both sides** when the neighbouring character is not already
whitespace. A leading-space rule alone welds the token to the following word.

`ref` fields — for-each's list, Filter's list — hold exactly one Reference and **replace** rather
than append.

### Composing a Reference

Compose the token from the `ScopeEntry` path. **Never pattern-match one.** `@hatua/expressions` owns
what a Reference is — `isReference()`, `sourceReference()` — and `reference.ts` states outright that
a regex would be a second definition that eventually disagrees. `REFERENCE_PATTERN` was retired for
exactly this.

---

## The Data panel

The step editor expands leftward into a read-only reference tree: the same component the picker's
**Reference** tab mounts, showing everything the selected Step can read, with workflow variables at
the top.

It stays open while the user works, so a run of mappings does not mean reopening a popover each time.
Drag out of it; do not edit in it. Variables are **edited** in the Workflow tab and **read** here —
one place to change a thing, one place to use it.

While it is open, leaves already referenced by the Step being edited are marked, and hovering a leaf
highlights the fields using it. Both are derivable from what exists: parse each Slot's Template, take
`referencePath()` over the AST, intersect with the scope paths.

This is what answers the original handoff's real weakness — that the reference tree sat in the left
panel while the fields it fills sit on the far right, a full canvas apart, with no visible
relationship between them.

---

## Selection

`selectedStepId` and `onSelect` as **props**, with the composition root holding the state, exactly as
`<StepList>` does today.

No selection context. A second mechanism for one piece of chrome state is how the parts stop being
independently mountable, and every region must mount alone — `layouts/regions.test.tsx` renders each
one bare, and `apps/playground/src/host.tsx` mounts them bare.

Selection is chrome and never reaches the document, the same line ADR-0001 draws around node
positions.

---

## Ports

| Port | Serves |
| --- | --- |
| `ManifestSource` | Components, Triggers, and now Run Context declarations — one flat array, entries carry `kind` |
| `WorkflowStore` | The Draft, its lease, versions, publish/release/discard |

Every field on `HostPorts` is optional and a region whose port is missing degrades rather than
throws. **Two absences are different states**: "the Host wired nothing" and "the Host declared
nothing" have different fixes and different copy.

The Data panel is the first region to read **two** stores — the document and the manifests, because
scope needs both. A Host supplying one and not the other is a real case; render it as an empty state,
not a crash.

Function Manifests have a format and no port. The first surface to read Host-declared Functions is
the completion list, and that is when the port becomes justified — a port with no reader is a shape
guessed at rather than one a screen forced.

---

## Copy

`.agents/rules/rendered-copy-is-written-for-the-hosts-users.md` governs every string that reaches the
DOM. In short: **misconfiguration copy** can only reach the integrator and should name Hatua and the
prop; **runtime copy** renders in a correctly-wired product and must name neither Hatua nor Host,
port or manifest.

`Library.tsx:150` is the known offender — it renders on `status: 'ready'` with an empty catalogue,
which an end user sees, and explains itself in terms of Component Manifests and "this Host". Fix it in
the Components rename.

---

## What the original handoff got wrong

Recorded here so the two documents cannot disagree quietly. ADR-0011 already lists the first three.

| The original said | What holds instead |
| --- | --- |
| `inputs[]` on the document | Retired. A Trigger's declared outputs are the parameter contract |
| `dirty` enables **Save changes** | Editing autosaves (ADR-0005). No Save button, no flag |
| "Are manifests served by the Host?" — open | Answered: yes, through `ManifestSource` |
| Trigger is a Step: `core.start`, `once`, `fixed` | `doc.triggers[]` is top-level. The canvas draws a derived start node; `once`/`fixed` become unnecessary |
| The **Data tab** — reference tree over a variables editor | Split. The tree moves beside the step editor; variables move to the Workflow tab. One panel held two scopes, and listed every variable twice |
| The tab strip is **Flow / Library / Data** | **Components / Workflow**. Flow is optional; Data is not a tab |
| "Library" | "Components" — the glossary term, and the region's name |
| The picker inserts References | It inserts References **and Functions**, with parameter descriptions and signature help |
| Leaf rows carry a dot, accent for lists | A left rail, green when the row fits the field's type |
| The ⚡ picker is the only alternative to dragging | Typing `{{` and `Ctrl`+`Space` are the primary paths; the picker is the browsable one |

---

## Open

- **The Run Context schema.** The shape of `kind: context` — a flat list of `{key, type, description}`
  is the obvious reading, and it should be settled against a real Host's needs before it is written.
- **Host-declared Functions** need a port. Deferred until the completion list ships and gives it a
  reader.
- **Mixed text and the type marking.** ADR-0009 keeps interpolation soft, so a scalar of any type
  renders into mixed text. The marking currently judges against the field's declared type, which is
  right for a whole-value Template and stricter than necessary for a hole inside a sentence.
- **`Ctrl`+`Space`** conflicts with input-source switching for multilingual macOS users. `Ctrl`+`.` is
  the fallback if it bites.
