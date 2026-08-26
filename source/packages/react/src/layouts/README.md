# layouts

The regions a screen is assembled from — `TopBar`, `StepList`, `Components`,
`Workflow`, `Data`, `FlowMap`, `Inspector`, and the `TabbedPanel` that arranges
the side panel.

`views/Build` puts them in the shape the design handoff specifies: the toolbar
across the top, then three columns that are all on screen at once.

```
+-------------------------------------------------------------+  TopBar, 56px
| TabbedPanel      | FlowMap                    | Inspector    |
| 304px            | 1fr                        | 404px        |
| Components       | the canvas                 | the editor   |
| Workflow, (Flow) |                            |              |
+-------------------------------------------------------------+
                     min-width 1240px; below that the screen
                     scrolls sideways rather than collapsing
```

Each is exported individually from `@hatua/react`, and each mounts alone. That
is the whole point of the tier: `views/Build` is a convenience, and a Host that
wants its own arrangement imports the regions, wraps them in `<HatuaProvider>`
and puts them wherever it likes. `apps/playground/src/host.tsx` is that Host,
and `layouts/regions.test.tsx` mounts every region outside `<Build>` so the
container cannot quietly become required.

**Rule:** these are the components that may call `@hatua/services`. `Components`
subscribes to the manifest store through `useSyncExternalStore` and holds
nothing but the text in its filter box. `StepList` subscribes to the editing
store the same way — the parsed **Workflow Definition** in, a tree out, and
every structural change back through the store as a command against the document
(ADR-0001). `Workflow` is the first region other than validation to read *both*,
because the document says which Triggers a workflow declares and only the
catalogue says what a Trigger's fields are — and a third, `ConnectionStore`,
because a `conn` field offers what the Host says it has established. It reads
the catalogue twice over: the Component Manifests decide which Trigger types can
be added, and the Run Context declaration in the same flat array decides what a
Template on the tab may read.

### The Workflow tab shows the active Board

`Workflow` takes a `board` prop, the way `<StepList>` does and for the same reason: which Board is on
screen is chrome, the canvas is where the doorway is, and a region that reached for it would be a
second answer to a question `views/Build` already holds one answer to. Absent means the root, so a
Host that never opens a Block mounts it exactly as before.

**A Board's root IS its contract** (CONTEXT.md), so its middle section is the Triggers at the root
and a Block's `params`/`outputs` inside one — one slot, said twice. `boardTabLabel(board)` is
exported beside the region because `views/Build` puts the same string on the tab above it, and a
landmark and its tab label that disagree are one region with two names. The tab's **id** does not
move with the label: an id that changed on every doorway would reopen the Components tab each time.

Renaming a Block's slug is the one edit here that changes what a caller is holding. `renameBlock`
leaves every `use:` naming the old slug — the rule a variable key follows — and the Block is then
one nothing resolves under its old id, which the canvas reads as a *deleted* Block. So the region
emits `onBoardRename`, and `views/Build` follows it into the new id with the selection held on that
Board. Without it, committing the slug drops the user back to the root and closes the tab they were
editing in.

`TabbedPanel` still owns no data. It gained a controlled `tabId`, which is a
different thing: the tab that is open is still chrome, and lifting it into a
caller is what lets `views/Build` open the Components tab when an insert point
is chosen in the Flow tab. None of it reaches the document.

`views/Build` reaches `@hatua/services` as well, for exactly one thing: the
`addStep` command it applies when the Components tab and the Flow tab are wired
together. It reads nothing — it does not subscribe to the store, because a
re-render of the whole screen on every keystroke is the opposite of why the
store is external.

`HatuaProvider` reaches `@hatua/services` too, and is the one component outside
this tier that may. It is not a region — it is the composition root, and what it
does with the package is build the stores from the Host's ports, not read them.
See `theme/HatuaProvider.tsx`.

## Where a region's data comes from

Not from props. `Components` takes no manifests, `Workflow` takes no document,
`Inspector` will take no Step, and
that is forced rather than chosen: `apps/playground/src/host.tsx` mounts each
region bare and `regions.test.tsx` renders every one of them with nothing above
it, so a required data prop would break both. Everything a region reads arrives
through `<HatuaProvider>` — the Host's ports go in, and the stores that read
them come out.

**Chrome is not data, and does come in.** `TabbedPanel` takes `tabId`, `FlowMap`
takes `boardId`, `StepList` and `Workflow` take a `board`. None of it is in the
Workflow Definition and the editing store has no opinion on any of it — which is
exactly why it can be lifted into a caller without reaching the document. Every
one of them is optional and falls back to its own answer, so a region still
mounts bare.

What regions still send *out* is props. `Components` takes an optional `onSelect`
and `StepList` an optional `onInsert`; neither adds the Step. That is not a
missing feature — it is the only place the two halves can meet. `StepList` knows
where a Step would go and nothing about the catalogue; `Components` knows the
Components and nothing about the tree. Something above both has to introduce
them, and `views/Build` is that something.

A region that emits an event stays mountable alone; a region that requires a
handler does not, so every such prop is optional. `apps/playground/src/host.tsx`
is the proof: it mounts the Flow tab with no `onInsert` at all, and the region
simply renders no insert controls — while removing and reordering still work,
because neither needs a catalogue.

## What each region is

| Region | What it is |
| --- | --- |
| `TopBar` | The toolbar. |
| `StepList` | The tree as a dense, ordered list. A region a Host may mount; not in `Build`'s tab set. |
| `FlowMap` | The canvas: one Board's tree as a map of cards and the regions around them, filling the middle column. Not a tab. |
| `Inspector` | The step editor. |
| `Components` | The Component Manifests a Host serves, as cards. Components only — a Trigger is not a Step, and adding one is the Workflow tab's job. |
| `Workflow` | Everything scoped to a **Board** rather than to a Step: the name and slug, the Board's root, the variables. |
| `Data` | The reference tree the step editor expands into. Not a tab. |

`Fields` is not a region and is never exported: it is the form for one Component
Manifest's fields, over one set of values. A Trigger's fields and a Step's are
the same shape declared by the same schema, differing only in which key of the
document they are written back to — so `Workflow` mounts it today and the step
editor mounts the same component when it lands.

Every mappable field kind in it gets `<TemplateInput>` from `compounds/`. What
this tier contributes is the two things that widget cannot work out for itself:
what the field may read — `boardScope` here, `scopeFor` in the step editor —
and what its value has to produce.

That is the point worth keeping: **which surface edits a thing is a rendering
decision, not a document one.** Clicking the canvas's derived start node can
open this form in the step editor without `triggers[]` moving into `steps[]`,
which is what would otherwise force `once`/`fixed` back and a special case into
`removeStep`, `walkSteps`, `unknownComponents` and the layout.

A run drawer belongs to `views/Runs`, not to `Build`. A **Workflow Execution**
is read-only history; nothing in the designer edits one.

### The shape of each region on the map

`@hatua/layout` decides where every card goes; this tier draws what it is handed
and computes no geometry of its own. What each child region looks like is
settled in `docs/handoff.md` § Flow map geometry, and the answers this tier has
to agree with are: **every** region of a Step is a **column** in one row, in
document order, and they converge on a **Join** (ADR-0015) — a loop is one
column, a `core.try` two, a Fork *n*. Each is a **Band** with the word that names
it over its own top edge, dashed when whether it runs is a run-time fact and
solid when it always runs, which is what tells a Fork from a `core.try` now that
their shapes are the same.

Columns showing a list are one height, so their bottom edges line up under the
mark; each is its own width, because size is a consequence of content here as
everywhere else on this map. A column **not** showing a list — empty, or
collapsed — is an `emptyRegion` box instead, carrying a `+` when it is empty and
a count when it is folded.

A container's Bands sit inside one **Nest**, which is that Step's whole extent.
Two frames and not one, because a `core.try` owns two regions and only the body
is protected. The card sits astride its Nest's top edge — nothing is drawn
between a Step and its regions, because a line here means "then" and a Step does
not run after its own body, so containment is drawn as *overlap* instead.

`<StepList>` says the same thing in a list, with the chip over each region — the
two surfaces draw differently and must not disagree about which regions a
container has or what they are called.

**Neither surface reads the verb to decide whether a region exists.** A
`handler:` on a `core.fork` is meaningless and no runner reads it, but it is not
invisible: `walkSteps` yields the Steps inside it, so the generic rules report
against them by name, and a `COMPONENT_UNKNOWN` naming a Step that nothing draws
is a problem the user cannot go and fix. Refusing to draw a region does not make
it absent from the document — it makes it unreachable. What the verb decides is
the *word* over a region.

**Three readers, one enumeration.** `regionsOf` in `@hatua/model` is where a
Step's regions are enumerated, and all three of them get theirs from it:
`@hatua/layout` walks it to place cards and to emit a `Band` per region,
`<StepList>` walks it to render the nested lists, and `<FlowMap>` draws the bands
the layout emitted. The word over a region is `Region.keyword` — `if` / `else if`
/ `else` / `and`, `attempt`, `loop`, `on failure` — computed there too, so the chip in
the list and the legend on the map are the same string from the same function
rather than two spellings that agree by inspection.

`regionsOf` answers what a Step nests; `bornRegionsOf` answers what a *new* one
should nest, which no reading of the keys can. A container written with neither
key nests nothing at all, so it draws no Band, offers no `+`, and can never be
filled in.

That is why the word lives in the model at all. It was computed twice, in
`keywordFor` and `bodyKeywordFor` inside `<StepList>`, and the canvas would have
been the third answer to a question with one right answer. `StepList.test.tsx`
§ "the list draws every region the document carries" and `FlowMap.test.tsx`
§ "draws one band per region, saying what `regionsOf` calls it" hold both
surfaces to that enumeration on a Step carrying all three keys at once.

### The lines between the cards

A line is drawn from one card to the next, and it is chrome the geometry places.
ADR-0013 refuses an edge a user can attach anything to and CONTEXT.md refuses a
**Connection** as a thing in the model; neither refuses a line, and at
`LAYOUT.verticalGap` of 96px the map needs one — two cards that follow each other
read as two unrelated things without it. Nothing on the line takes a pointer and
nothing is stored.

`@hatua/layout` emits a `Link` per gap: where the flow leaves, where it arrives,
the `InsertPoint` a Step goes to if one is added there, and where the `+` for it
sits. **One per gap in every step list** — one more than the list is long, and
the same count `<StepList>` draws between its rows. `units/Connectors` draws the
curve between the two ends; `units/InsertDot` draws the `+` where `dotAt` says.
That count is the property that makes this region a surface a workflow is built
on rather than a picture of one, and `layout.test.ts` holds it over every
fixture.

**Not every gap is a line.** A `run` is between two Steps and is the only kind
that means "then". The gaps at a region's two ends are `enter` and `leave`, and
they draw nothing — each sits inside the Band it belongs to, which is what puts
every `+` inside the frame of the list it inserts into with a drawn edge between
it and the next one out. A `join` is drawn, and leaves a Branch's Band rather
than the last card in it.

### One Board at a time, and a call is the doorway

`<FlowMap>` draws one Board and `<StepList>` lists one. A call site's card
carries an **Open** control and the canvas's breadcrumb is the way back, which is
ADR-0013's "one Board at a time, with a call as a doorway into another" arriving
with an implementation.

Which Board is on screen is **chrome**, like selection and collapse and which tab
is open: the document has no key for it, because a view state in the file is a
diff in the Host's repository. `<FlowMap>` holds it and lifts it into a caller
through `boardId` / `onBoardChange`, exactly as `TabbedPanel` lifts `tabId`;
`<StepList>` takes a plain `board` prop, because nothing in a list is a doorway.
`views/Build` holds one Board for both, so **the Flow tab follows the canvas.**
Two surfaces showing two different Boards at once is the same defect as the map
and the list disagreeing about a region — one screen, two answers to "what am I
looking at".

**Selection and collapse are named by a `StepRef`, not a bare id.** Step ids are
Board-local, so two Blocks may each hold a Step called `ret`; a bare id selects
both and folds both. That was latent while nothing could reach a Block's Board
and stops being latent here. `layout`'s `collapsed` option still takes bare ids,
because a Board is already its argument — `<FlowMap>` filters the set down to the
Board on screen, and that is the only place the two spellings meet.

### The canvas is how a workflow is built

Mounting it as one of the tabs is the arrangement to avoid, and the one this
repo shipped once: it would be visible only while that tab was open and never
beside the panel it is edited from, and a canvas you have to leave the catalogue
to look at is not a canvas. It has the middle column, it is always on screen, and
the side panel is what a Step is chosen from.

**The Flow tab is not in `Build`'s default set.** The design of record says the
canvas is how a workflow is built, and it now is: every card, every `+`, the
chevron, the doorway into a Block's Board, and the drop target a Component card
is dragged onto. `<StepList>` stays exported and stays mounted bare by
`apps/playground/src/host.tsx`, which is a Host that wants both — but Hatua's own
screen leads with the canvas and the side panel is **Components** and
**Workflow**.

An earlier draft of this file argued the two were both on screen and neither
replaced the other. That was written when the canvas could not select a Step, let
alone take one; what survives of it is that a Host may want the list, which is
why the region is still a region.

### Names and labels

The tab labels and the component names are deliberately not forced into one
list, but they must not *collide*: **Flow** is a label a user reads and it opens
`StepList`, while `FlowMap` is the region beside it, named `Flow map` as a
landmark. Two landmarks answering to "Flow" is exactly how the canvas ended up
in the tab strip. `Components` and `Workflow` are named for their labels
exactly — one word each, and the same word a user reads — which is what stops
the same drift happening twice.

`TabbedPanel` is chrome and owns no data, which makes it the odd one in a tier
described as "the regions that own their data". It lives here rather than in
`primitives/` because it exists for exactly one screen: it takes `{id, label,
content}` and knows nothing else, but a primitive is a component we owe a
general API to, and this is not one.

## Column edges belong to the container

No region draws its own divider. `Build` puts the borders on the wrappers that
place them, because a region that drew its own edge would only sit correctly in
a container shaped like this one — `apps/playground/src/host.tsx` puts the
Inspector on the *left*, where a `border-inline-start` of its own would be a
line down the middle of nothing.
