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
│ Workflow      │  the root node on top        │                       │
│ (Flow)        │                              │                       │
└───────────────┴──────────────────────────────┴───────────────────────┘
```

**The canvas is how a workflow is built.** That is the change of emphasis from the original handoff,
which put a Step *list* in a tab and left the canvas as one of three things a tab could show. A
canvas that is visible only while one tab is open, and never beside the panel it is edited from, is
not a canvas — `views/README` and ADR-0011 both make this argument about version navigation for the
same reason.

**The Flow tab is not in `<Build>`'s default set.** `<StepList>` is a real region and a dense,
scannable, keyboard-reorderable view of the tree; a Host that wants it mounts it, and
`apps/playground/src/host.tsx` does. Hatua's own screen does not, because the canvas can now select a
Step, fold a container, open a call, and take an inserted or dropped one — which was the whole of what
the list was still standing in for.

`packages/react/src/layouts/README.md` argued for a while that the two were both on screen and
neither replaced the other. That was written before the canvas had a `+` on it; what it was really
saying is that a Host may want both, which is why the region is still exported and still mounted bare
by the playground.

### Which tabs, in which view

| View | Tabs |
| --- | --- |
| Build | **Workflow**, **Components** |
| Runs | **Workflow** (read-only), **Runs** |

`<TabbedPanel>` arranges regions and owns none of them, so which tabs exist is the caller's
decision. A Host mounting one region gets no tab strip at all.

---

## Flow map geometry

The numbers `@hatua/layout`'s `LAYOUT` carries, and what each one has to satisfy. The package cites
this section; change one in either place and the other is wrong.

| Constant | Pixels | What it measures |
| --- | --- | --- |
| `nodeWidth` | 236 | A card's width. Every card is the same width, on every Board and at every depth. |
| `nodeHeight` | 64 | A card with a name and nothing else. |
| `nodeHeightWithMeta` | 100 | A card that also carries the meta row. |
| `verticalGap` | 96 | Between one card's bottom and the next card's top, down a column. |
| `branchGap` | 44 | Between two Branch columns. |
| `regionLabel` | 28 | Reserved above a child region for the label naming it. |
| `joinMarker` | 26 | Reserved below a Fork's Branches for the mark where they converge. |
| `regionInset` | 14 | Between a Band's edge and what it holds, and between a Nest's edge and its Bands. |
| `emptyRegion` | 72 | The height of a Band with no Steps in it. |
| `nodeLid` | 32 | How far below a card's top its Nest's edge crosses it. |

**Cards are a fixed size, and only two heights exist.** A card sized to its content makes a column's
rhythm a function of how long somebody's Step names are, and makes the map reflow when one is
renamed. Every card carries the Component's icon, the Step's name and its verb; the taller one also
carries a **meta row** of the Step's filled **Slots**, as chips — the connection first, then each
value in the order the manifest declares it.

So a card is the taller one exactly when it has a filled Slot, which is `slotsFor` against the
Component Manifest. **Not `isContainer`**: `core.fork` declares `fields: []` and has nothing to say
below its name, so a Fork is the short card while a `core.for_each` — which declares `list` — is the
tall one. Both nest. What decides is whether there is anything to show, and the same predicate decides
the height and the contents so a short card cannot end up with a row in it.

That makes the map a function of the document **and the catalogue**, which is worth saying out loud.
ADR-0001's promise still holds — the catalogue changes what a card says about itself, never where
anything sits relative to anything else — and a Board laid out before the manifests land is the same
map with shorter cards.

**What the gaps have to satisfy.** `verticalGap` exceeds `nodeHeight`, so the space between two cards
reads as a run of the flow and not as a crack between two cards that nearly touch. `branchGap` is
much smaller than `nodeWidth`, so two columns read as siblings under one Fork rather than as two
separate maps; it is what stops adjacent columns touching and is the only thing keeping them apart,
so it cannot be zero. `regionLabel` fits one legend's line box, and every child region gets one.

`regionInset` is what makes a nested region visibly inside the one holding it, so it must be large
enough to read as a margin rather than as a doubled border — and small enough that depth is affordable,
because a card at depth *n* costs `2n × regionInset` of width. `emptyRegion` exceeds `regionLabel`
because a Band with nothing in it is where a Step gets *added*, and at a label strip's height the `+`
inside it is a target to aim at rather than something to drop onto. It has to hold that `+` with room
around it, which is the same argument that sizes the drop target itself. `nodeLid` is under half of `nodeHeight`, so the card's name
stays above its Nest's edge and only the quiet half of the card is enclosed.

### Regions

**Every region of a Step is a column, in one row, in document order** — separated by `branchGap`,
over a `joinMarker`'s worth of room for the mark where they converge. A loop is one column, a
`core.try` two, a Fork *n*, and a Step carrying `branches:`, `steps:` and `handler:` at once is
*n* + 2. The geometry never reads a region's `kind`: that decides a word and an edge style, never a
shape (ADR-0015).

Side by side means **sibling regions of one Step, and the flow leaves through one of them** — which
is what the model already said a `core.try`'s two regions are, sharing the Fork's scope rule and the
Fork's all-branches reasoning. What separates a Fork from a try is *what decides which region runs*:
a Branch's `when`, evaluated before anything ran, against a failure, which is only knowable part-way
through. That is a caption, not a layout.

**The edge style is what tells a Fork from a try**, on the rule a Branch's dashes already stated —
*which one runs is a question the document answers at run time.* Asked of what each region
guarantees rather than of the verb that owns it, a Branch is dashed, a try's body is solid because it
always starts, and a try's handler is dashed. So a Fork is *n* dashed columns and a try is one solid
column beside a dashed one. The rule is scoped to sibling columns and does not reach a loop: dashed
already means *placeholder* here — the `+` is a dashed circle, an empty region a dashed box — and it
survives that only beside a solid sibling, which a lone loop body has not got.

**The label band is what tells regions apart** — `attempt` and `on failure` over a `core.try`'s two,
`loop` over a loop's one, `if` / `else if` / `and` over a Branch's. Every child region gets a band, so
the second region of a `core.try` costs no shape the first did not already have, and a loop body and
a protected body are told apart by the word over them rather than by their geometry. `<StepList>`
gives the same answer with the chip over each region; the two surfaces draw differently but they do
not disagree about which regions there are or what they are called.

They cannot, because the word is `Region.keyword` from `regionsOf` and both read it there. It was
computed twice inside `<StepList>` — `keywordFor` for a Branch, `bodyKeywordFor` for a body — and the
canvas would have been a third answer to a question with one right answer.

**`attempt`, not `try`.** Every one of these words renders inside somebody else's product, to people
who have never written code (`.agents/rules/rendered-copy-is-written-for-the-hosts-users.md`). `if`,
`else` and `loop` are ordinary English that happen also to be keywords; `try` is only a keyword, and
`on failure` beside it is already plain — half a pair in English and half in a language reads as
neither. The **verb** stays `core.try`, because that is an identifier somebody types in Text Mode
rather than a sentence anybody reads, and it is mirrored in Go and pinned by the conformance corpus.
The same argument runs through the built-in catalogue: the Component is **Attempt** and its blurb
says "do something else if they fail" rather than naming a handler.

**The bands are geometry, and `layout` hands them over.** `FlowMap.bands` carries one `Band` per
region — its rect, its `kind`, its `keyword` and the `StepRef` that owns it — `FlowMap.nests` one per
container Step, and `FlowMap.joins` one per Fork. A band's rect is the region's own drawn edge, with
`regionLabel` reserved *above* it for the word that names it; inside, the list is padded by half a
`verticalGap` at each end, because the first and last gaps of a region's list are between a card and
a frame rather than between two cards and the `+` sitting in one has to clear the edge. The canvas
may not work these out for itself —
`packages/react/src/layouts/README.md` has that tier draw what it is handed and compute no geometry of
its own — and there is one place it could not work them out at all, which is a region with nothing in
it, where the band is the only thing on screen.

**A region is a drawn edge, not a wash.** A Band with a `--border-subtle` hairline and a 22%-opacity
fill is invisible against `--surface-sunken`, and an invisible extent is an extent that says nothing:
nesting reads as one smudge, and a `+` belongs to no list you can see. Two dots 64px apart on one
spine — the last gap of a loop's body and the next gap of the try holding it — are then two circles
with nothing between them, which reads as a rendering fault rather than as two different places to
insert. `<StepList>` reached the same defect and fixed it the same way: an indent guide and trailing
padding, because *nothing on screen said where a nested list ended*. This is that fix in two
dimensions. Every Band is inset by `regionInset` from whatever holds it, so a card sits inside its
Band, its Band inside its Nest, and every `+` falls inside the frame of the list it inserts into with
a drawn edge between it and the next one out.

**A Nest is the container's extent; a Band is one region's.** Two extents, because a `core.try` owns
two regions and only one of them is protected — a single frame would claim either too much (the
handler, which is not protected) or too little (the body alone, which leaves the handler outside the
Step that owns it). Every container has both at every arity: a loop is one Band in a Nest, a try is
two, a Fork is *n* — which is what stops a Fork being a special shape, and why a Step's Join sits
inside its Nest rather than beneath it.

**The card sits astride its own Nest.** The Nest's top edge crosses the card `nodeLid` from the card's
top, so the card is half in and half out of the container it owns. Nothing is drawn between a Step and
its regions at all, which is the point: on this map a line means "then", and a line from a card to its
own body would give one idiom two meanings. Containment becomes *overlap*, which no other relationship
here uses. `nodeLid` is a fixed distance from the card's top and never half its height — a card is
`nodeHeight` or `nodeHeightWithMeta` depending on whether it shows a meta row, so "the middle" would
put the lid in a different place on two cards side by side.

**A line is drawn between one card and the next.** ADR-0013 refuses an edge a user can attach
anything to — no connect affordance, no exit handles — and CONTEXT.md refuses a Connection as a thing
in the model. Neither refuses a *line*, and the map needs one: at `verticalGap` of 96px, two cards
that follow each other read as two unrelated things. The line is what says "then". It holds nothing,
nothing on it takes a pointer, and it is derived from the tree like every other position here.

A **Link** is one gap: the point the flow leaves, the point it arrives at, and — on all but a join —
the **InsertPoint** a Step goes to if one is added there. There is one per gap in every step
list, which is one more than the list is long and is exactly the count `<StepList>` draws between its
rows. That is the property that makes the canvas a surface a workflow can be built on: a `+` sits on
every link that names a position, including the stub after the last Step and the one under the root
node of an empty Board, which is the only way to add the first Step to a new workflow.

**Columns are one height where they are lists, and each its own width.** Every column showing a list
is as tall as the deepest of them, so their bottom edges line up and the lines into the mark are
symmetric. Width is a consequence of content, here as everywhere else on this map — a column as wide
as its widest sibling puts an empty frame the width of a nested Fork beside it, which is dead space
no reader can account for.

**A column not showing a list is a box.** Two things make one — a region with nothing in it, and a
region collapsed — and they take `emptyRegion` rather than their siblings' height. An empty handler
beside a 2000px body would otherwise be a 2000px empty frame, which is the same dead space in the
other axis; and it is the common case, because `bornRegionsOf` gives a new `core.try` an empty body
*and* an empty handler, so a try added from the catalogue is a card over two small boxes. The two
boxes read differently: an empty one carries the `+` that is the only way to fill it, a collapsed one
carries how many Steps it is holding back.

Bottom edges are level among the lists and ragged where a box sits beside one, and that is accepted:
the line to the mark leaves each Band's bottom edge rather than the last card inside it, so a box
converges from where it actually ends. The alternative is a path that runs and draws no line, which
is an absence carrying meaning. A column's last gap stays inside its frame, which is where a `+`
belongs; a line from the last card *through* the frame to the mark would cross an edge it is not
leaving.

**Collapse is per region, not per Step.** A wide Fork has the problem a big `core.try` has, so any
sibling column folds to a box and the card's chevron folds all of a Step's at once. A collapsed
region's children get no geometry at all, on the same argument that governs a collapsed container —
so it offers no insert point, because nothing on screen would say where a Step landed. It is chrome:
the document has no key for it, `<FlowMap>` lifts it through `collapsedRegions` /
`onCollapsedRegionsChange` beside the `collapsed` trio that folds whole Steps, and a region is named
by a `RegionRef` for the reason a Step is named by a `StepRef`. Two sets and not one, because the
chevron's relief is different from the legend's: folding a Step draws no Nest at all, while folding a
column leaves its siblings drawn.

**An empty column offers no fold at all**, and `@hatua/layout` ignores one named in the set. There is
nothing behind it: the box is the same size either way, and a folded box carries a count where an
empty one carries the `+` that is the only way to fill it. Honouring the fold draws a third state
that is neither — a box reading "0 steps" with nothing to be done with the region. The legend's
chevron keeps its space so the word stays the same distance from its frame's left edge whether or not
the column folds; that inset is what says how deep a region is, and it must not also encode this.

**A legend names the Step it hangs under**, to a screen reader and not on screen. `on failure` alone
is the same button on every `core.try` on the Board, and the card the region hangs under already says
whose it is in ink. The `+` on every gap and the join mark both name their owner for the same reason.

Folding and unfolding **animate**, for 140ms, because a box changing size with no motion reads as a
different map rather than the same one. The transition is on the boxes — `left`, `top`, `width`,
`height`, which is what `boxOf` writes — so the map tweens with no animation code.

The connectors cannot follow, because an SVG path's `d` does not transition: they are redrawn at the
new geometry in one frame while every box is still on its way there, and at full strength that is a
line ending in open canvas — off by the whole fold distance at the start of it, for the length of the
transition. So they **fade in over the same 140ms** and are solid the frame the boxes stop. The fade
is triggered by a fold and by nothing else, so the lines do not blink whenever something else on the
canvas moves. Under `prefers-reduced-motion` there is neither transition nor fade: unlike a toast's
countdown bar this is decoration, and freezing it loses nothing.

**Not every gap is a line.** A gap between two Steps is drawn and says "then". The gaps at a region's
two ends are not: a line from a card to its own body would give the one idiom on this map a second
meaning, and containment is already said by overlap. So a region's frame is what a reader follows in
and out of it, and the only lines are between Steps, and from a Branch to the mark.

**The word over a region sits above that region's own top edge**, flush with its left, in the strip
`regionLabel` reserves above the Band. Not at a fraction along the entering line, because both
of a Fork's branch links leave the same point and any fraction near the start is the same place twice.
Not straddling the edge either: a legend that sits on a border has to mask the line behind it, and a
Band with a translucent fill has no one colour to mask with — the border reads straight through the
word. Flush left rather than centred because a Band is inset from whatever holds it, so the words
staircase with depth and the alignment itself says how deep a region is; centred, every word on a
column of nested regions lands at nearly the same x and encodes nothing.

The word carries the Branch's `label` and its `when` with it. There is still exactly one thing saying
one word over one region — the legend is the Band's, and no pill floats on the line as well. Two things
saying one word over one region would be the duplication this repo refuses everywhere else.

**Both draw every region the document carries, and neither reads the verb to decide.** A `handler:`
on a `core.fork` is meaningless and has no runner, but it is not invisible: `walkSteps` yields the
Steps inside it, so every generic rule reports against them by name — a `COMPONENT_UNKNOWN` naming a
Step no surface draws is a problem a user cannot go and fix, because they cannot reach the Step it
names. Refusing to draw a region does not make it not exist; it makes it undeletable. What the verb
decides is the *word* over the region, not whether there is one.

### Which Board is on screen

One Board at a time, with a call as a doorway into another (ADR-0013). A call site's card carries an
**Open** control; a Block's body is never drawn inline at its call sites, which would hand back
everything extracting it bought and draw a Block called from three places three times.

The way back, and the way anywhere else, is a **tab strip** (ADR-0017). A breadcrumb was the first
shape and it draws a path — but a Block called from three places has no single parent, so the `›`
names whichever call site the user happened to click, which is a fact about the session rather than
about the document. Boards are peers, so the canvas keeps a working set with one in front.

| | |
| --- | --- |
| The root Board | always present, always first, no close control |
| A Block's tab | opens on **Open**, or when the Block is declared |
| Closing | any Block tab; the root takes focus, because it is the one tab always there |
| A deleted Block | its tab goes, resolved against the document every render |
| Opening an open Board | brings its tab forward; one tab per Board, never per call site |

The strip is drawn only once a Block's Board is open. A strip holding nothing but the root names the
one Board the canvas can draw, which is chrome saying what the map already is.

It sits over the canvas rather than in a row above it, exactly as the toolbar does: the map is
clipped to the whole of the viewport and pans underneath everything, so a strip in the flow would be
a band the map could never occupy. `pointer-events` are off on the strip and on again for each tab,
so a card behind the gaps stays clickable and draggable.

**Each tab keeps its own pan, zoom and selection.** Coordinates are Board-local, so a pan carried
*across* Boards lands in empty space — and a pan carried *back* to the Board it was made on lands
where it was left. Keyed per Board rather than reset, a tab therefore holds its place without
anything having to notice the Board changed. This is what ADR-0016's "opening a Block's Board resets
the viewport" becomes: still true when a tab is opened, no longer true when one is returned to.

Which Board is active is **chrome** — the document has no key for it, on the same argument that keeps
node positions out. `<FlowMap>` holds it and lifts it into a caller through `boardId` /
`onBoardChange`, the way `<TabbedPanel>` lifts which tab is open, and `<StepList>` takes a plain
`board` prop. A Host mounting both gets one Board for both, because two surfaces showing two
different Boards at once is the same defect as the map and the list disagreeing about a region.

**Which Boards are open is not lifted**, and that is the same call the viewport makes: every other
piece of chrome here is a controlled trio because a second reader appeared for it, and nothing
outside the canvas has tabs.

The strip is a `nav` and not a `role="tablist"`. A `tablist` promises a `tabpanel`, and the canvas is
deliberately not one — it carries `tabIndex={-1}` so it can take focus after a pointer press without
becoming a stop in the tab order, and a `tabpanel` is a stop by contract. Switching Board replaces
what the canvas draws, which is navigation, so each tab is a button carrying `aria-current="page"`.

Selection and collapse are named by a **`StepRef`** for the reason a Placement is: ids are
Board-local, so a bare `ret` selects a Step on two Blocks and folds a container on both.

### The root node

The canvas draws one node above the first Step: the Triggers on the root Board, the Block's contract
inside one. It is **chrome, not a `steps[]` entry**, which is what makes `once:`/`fixed:` unnecessary
and keeps `removeStep`, `walkSteps` and `unknownComponents` from needing a case for it.

So it names no Step, and `FlowMap` carries it as a plain `Rect` beside the `Placement[]` rather than
as a `Placement` with no id. A `Placement` whose Step reference were optional would push "sometimes
there is no Step here" into every consumer's type to spare exactly one field here.

### Collapse

**Collapse is an input to the layout, and the only one that is not a function of the document.** It is
chrome — the document has no key for it, because a view state in the file is a diff in the Host's
repository every time somebody folds a loop shut.

A collapsed container's children get **no geometry at all**, rather than geometry the canvas then
hides. Laying them out anyway would leave the map's total width and height describing a map nobody is
looking at, and everything reading a total — fit-to-screen, a minimap — would be reading a number
that is wrong whenever anything is folded.

### Navigating the map

**The canvas pans and zooms, and it never scrolls** (ADR-0016). The clipped box is fixed and the
drawn surface carries a transform. Scrollbars on a map are a browser affordance rather than a canvas
one, and a scroll container can only ever show a screenful of a large workflow at whatever size it
happens to be drawn at.

| Gesture | What it does |
| --- | --- |
| Two-finger trackpad scroll | pan |
| ⌘/Ctrl + wheel, and a trackpad pinch | zoom, about the pointer |
| Space + drag, middle-button drag | pan, from anywhere |
| Drag on empty canvas | **nothing** |
| Drag on a card | moves the Step |

A plain drag on empty canvas is left doing nothing on purpose. It is the gesture **marquee selection**
belongs to, and panning has two homes that cost nothing — space and the middle button — while a
trackpad pans with no gesture at all. Zoom is about the **pointer**, because zooming to inspect
something means zooming to where you are looking.

**10% to 400%, continuous.** `+`, `−`, the wheel and a pinch multiply the current scale and land
wherever they land — 83%, 144% — clamped at the ends. At 10% a card is 24px and the map is a minimap;
at 400% it is 944px. A fixed ladder was rejected for the trackpad: a pinch that snaps instead of
tracking your fingers reads as a fault.

**The toolbar floats at the canvas's lower right**: `−`, the current percentage, `+`, and fit. The
percentage opens a menu of **absolute** levels — 50%, 100%, 200% — and `100%` snaps to exactly 1
rather than stepping towards it, which is what makes it the way back to a known state. **Fit lives on
its own button and nowhere else**, because one command gets one home. Fit fills the viewport up as
well as down: a three-Step workflow is enlarged rather than left small in the middle of the screen.

**First paint is 100%, the root centred, the top of the map in view.** Opening fitted was rejected —
a large workflow would open at a scale where nothing is readable, and the first thing anybody does is
zoom back in.

**Where somebody is looking is chrome**, one level out from the node positions ADR-0001 keeps out of
the document: a viewport in the file is a diff in the Host's repository every time anyone scrolls. It
is not a controlled prop either. `<FlowMap>` holds it and offers **two** props and not three —
`defaultViewport`, read once on mount, and `onViewportChange`, an observer. That is enough for a Host
to put somebody back where they were and not enough for a caller to drive the canvas into a state it
cannot get itself out of. Opening a Block's Board resets it, because coordinates are Board-local.

**Anything that takes focus pans the view to it.** That is not an enhancement: a scroll container
brought a focused child into view for free, a transform inside a clipped box has nothing to scroll,
and without a replacement most of a large map is unreachable without a mouse. The clipped box is
`overflow: clip` rather than `hidden` for the same reason — `hidden` is still a scroll container, and
a browser scrolls one of those on its own to reveal a focused child, which desyncs every measurement
the pan and the zoom are worked out from. `⌘+` / `⌘−` were considered and deferred: they are the
browser's own page zoom, and taking them means overriding a system shortcut nobody has asked for.

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

Everything scoped to a **Board** rather than to a Step. Three sections, one divider between each.

**The tab shows the active Board, and its label says which kind.** At the root Board it is
*Workflow*; on a **Block**'s it is *Block* — the kind of thing, never which one, because the canvas's
tab strip already names the Block and repeating it here spends the panel's width twice and breaks a
two-tab strip on a long name. The Board arrives as a prop, the way `<StepList>` takes one: which
Board is on screen is chrome, and the canvas is the only surface with a doorway in it.

|   | Root Board | Block Board |
| --- | --- | --- |
| 1 | Identity — the workflow's name and slug | Identity — the Block's name and slug |
| 2 | Triggers | Contract — parameters and outputs |
| 3 | Variables — the workflow's | Variables — the Block's |

### Every row is a card, and every box says what it is

One shape across the three sections: a **Trigger**, a parameter, an output and a variable are each a
bordered card, and every box inside one carries an uppercase caption — `NAME`, `KEY`, `TYPE`,
`VALUE`. Without both, the sections are boxes of identical shape stacked at one gap: a parameter's
name, its key and its type read as a single run, and four parameters are twelve boxes with no
structure.

The caption is a `<span>` rather than a `<label>`. Every control already carries an accessible name
saying which row owns it — `Name of thread`, `Type of digest_to` — and a real label would put four
controls on one panel all answering to "Name". The caption is what a reader sees, the `aria-label` is
what a reader hears, and the first is a prefix of the second.

The **bin sits on the caption's line**, not beside the box. Beside it, it took 32px off a key, a
**Template** and a friendly name alike, and it is a property of the row rather than of one box in it.

**Every card folds**, from a chevron on the same line. Folded it is one line carrying the name and
the one fact that identifies the row elsewhere in the document: `Thread · thread · text` for a
declaration, `digest_to · text` for a variable, and a **Trigger**'s id — never its Component's name,
because a Trigger named after its own Component would fold to its name printed twice. This is the
panel saying what the canvas already says with `2 params · 1 output`.

A card **opens expanded**. Folding is a user managing clutter; a tab that opened folded would hide
the editor from somebody who came to edit, and a Block with one parameter would hide its only field
for nothing. The state is each card's own — nothing outside this panel draws a declaration, so there
is no second surface to keep in step, which is exactly why the canvas's collapse is lifted into
`views/Build` and this is not.

A row's **diagnostic sits outside the fold**. Folding manages height; it does not silence the
checker, and a folded row that hid its own problem would let someone tidy it off their screen.

At 304px a folded line cannot always hold three facts, and **the prose name is what gives way** — it
ellipses and carries a `title`, while the key beside it stays whole. A key truncated to nothing is
the row losing the thing that identifies it; a shortened label is a hover and an unfold away.

### 1. Identity

The name and the slug, as labelled `Input`s. This is the first region that edits the document
outside the Step tree.

A 304px panel with two labelled fields is a better place to rename a workflow than an inline-edited
breadcrumb, and it keeps the top bar to display.

On a Block's Board the two fields are `setBlockName` and `renameBlock`. **The slug goes stale
without rewriting what names it** — every `use: block.<slug>` keeps the old spelling and the checker
reports it, the same rule a variable key follows and for the same reason. `renameBlock` *throws* on a
slug another Block already answers to, and `EditingStore.apply` turns a throw into a silent no-op, so
the field detects the collision itself, declines to commit and says why. A box that reverts and says
nothing is indistinguishable from one that is broken.

A renamed Block is one nothing resolves under its old id, which every reader — the canvas included —
reads as a *deleted* Block. So the region reports the rename, and whoever holds the Board follows it
rather than dropping the user back to the root mid-edit.

### 2. Triggers

The workflow's `triggers[]`. Add, remove, and edit each one's fields; picking a *type* reads the
same manifest store, filtered to `kind: 'trigger'`.

**A Trigger is not a Step.** `doc.triggers[]` is a top-level list; `scopeFor` emits `triggers.<id>`
per trigger, plus a `TRIGGER` builtin when more than one exists so an Expression can branch on which
one fired. A single `core.start` Step cannot express two Triggers, and ADR-0006 makes the schema the
source of truth, so `core.start` is retired.

The canvas still draws a **root node** above the first Step, derived from `doc.triggers[]`. Drawing
it as chrome rather than as a `steps[]` entry is what makes the original handoff's `once: true` and
`fixed: true` flags unnecessary: `removeStep` cannot find it, `walkSteps` does not yield it, and
`unknownComponents` does not flag it. The guarantees come from the model instead of from two
booleans.

### 2b. Contract — on a Block's Board

**A Board's root *is* its contract** (CONTEXT.md), which is why one section serves both: the
Triggers at the root, a Block's parameters and outputs inside one. The canvas has been drawing both
in one `<RootNode>` all along — *Triggers* / `1 trigger` at the root, the Block's name and
`2 params · 1 output` inside one — and this is that slot's editor.

One section holding two labelled groups, **Parameters** and **Outputs**, rather than two sections: a
divider between them would cut through the middle of the thing the section is naming. A row is a key
(mono, because it is what a Template writes), a friendly label, and a declared type — the three the
schema requires, which is why a new row is written with all three rather than added blank.

**Appended, never inserted above.** A call site's fields are drawn in declaration order, so a new
parameter landing at the top reorders a form somebody is already looking at.

**A new row is named from its key** — `new_parameter_2` becomes *New parameter 2*. Seeded with the
key in both boxes it is two identical boxes holding identical text, and the caption is then the only
thing telling them apart; seeded with a constant, two new rows arrive under one name.

**`of` has no control.** A `list` or an `object` may declare the shape of its members; the row says
what type it is, and Text Mode is where a shape is written.

A key that another declaration on the same side holds is refused and said, exactly as the slug is —
every reader resolves the first match, so two rows under one key make the second row's bin button
delete the first row's declaration.

### 3. The Board's variables

The workflow's at the root, the Block's inside one — rebuilt on every invocation and invisible
outside it, so a `core.set_var` can never reach out of the Board it is on. Every variable command has
taken a Board since it was written; this is the editor for the other half.

A card per variable — its key, its declared type and its value — then
`Button size="sm" variant="secondary" icon="plus"` **Add variable**. A variable's key *is* its name:
it carries no friendly label, because `{{ var.digest_to }}` is what the builder shows and there is
nothing else to call it.

**A variable's value is a Template**, not a literal. It may hold `{{ … }}`, so the value input is a
[Template input](#the-template-input) like any other, and it gets the same completion.

What it can read is the **unpositioned scope** of the Board it is on: Run Context, then the
Triggers or the Block's parameters, then that Board's variables. Never Step outputs — a variable has no position in the tree, so no Step is guaranteed to have run. That
subset already exists inside `scopeFor`, which computes it before appending upstream Steps; extract
it as `boardScope(doc, board, manifests, runContext)` and let `scopeFor` be that plus the Steps, so the two readers
share one definition.

**A variable declares its type**, read from `t` rather than from the value beside it, because
`core.set_var` writes the same variable from a Step — so the literal in the document is only what it
*starts* as, and a type inferred from it would be a claim about one moment in an execution
(ADR-0013).

What that buys on this tab is the **completion list**, not a marking on the field: passing
`expectedType` is what lets the picker rail the candidate rows that fit, where a variable's value
input could rail none. Nothing is ever marked wrong — neutral covers "does not fit" and "cannot be
judged" alike — so the field itself looks the same either way. The declared type also shows beside
every `var.*` row in the reference tree, where an expression-valued variable previously read
`unknown`.

**The type control is the one edit on the row that re-types downstream Expressions**, and the value
box is not. That needs a test on both halves: retyping `threshold` from number to text changes the
verdict of a number field reading it, and editing its value does not. It runs through
`@hatua/expressions` with `scopeFor` output — not through the validation store, which checks
required fields, unknown components and malformed containers, and does no expression type-checking
at all.

A row's controls therefore map one to one onto commands: `renameVariable`, `setVariableType`,
`setVariableValue`, `removeVariable`. `addVariable` writes `t: text` rather than leaving it out, for
the reason it mints a key rather than leaving one blank — the schema requires it, so a row without
one is a document that stops projecting the moment it appears.

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

**Delivered as a fourth manifest kind** — `kind: context`, its own schema file, served through the
existing `ManifestSource` alongside components, triggers and functions. Settled in
[ADR-0012](adr/0012-run-context-is-a-fourth-manifest-kind.md), which extends ADR-0010's argument
rather than passing over it; the shape it settles on is

```yaml
kind: context
keys:
  - { k: id,     label: Run id, t: text,   description: Identifies this execution. }
  - { k: tenant, label: Tenant, t: object, of: [{ k: name, label: Tenant name, t: text }] }
```

A key is `{k, label, t}` with `of` nesting the same way an output's does — the spelling the reference
tree, the completion list and the type checker already read — plus `description`, the sentence the
completion list shows under the focused row. No `use`, no `name` and no catalogue wrapper: there is
exactly one Run Context per execution, so the file declares keys directly rather than naming a type
someone instantiates.

Its own *file*, not a fourth `kind:` inside the Component Manifest: a conditional manifest shape
would need the JSON-Schema-to-zod generator to grow `if`/`then`, which ADR-0006 keeps deliberately
narrow. Its own *port* was the alternative and buys nothing — a second store, second loading and
failure states, second wiring — for a payload that is a handful of typed keys, when `ManifestSource`
already returns a flat array whose entries carry `kind`. The port's element type widens to
`ManifestEntry`, a union every arm of which carries a required literal `kind`; the hazard `ports.ts`
names is an *undiscriminated container arm*, which this does not have.

---

## Expression editing

The substantial half of the builder, and the part the original handoff specified least.

Four places hold a Template, and all four use the same widget:

| Site | Where it is edited |
| --- | --- |
| A Step's mappable `with:` fields, including `map` entries | Step editor |
| A Branch's `when` | Step editor, via its Fork |
| A `core.repeat`'s `until` | Step editor, via its Repeat |
| A variable's value | Workflow tab |

The two conditions are one row twice over. Both are a structural key on a container rather than a
field under `with:`, so neither is reached through the **Component Manifest** and both are typed
`boolean` by the language — which is why they are edited through the container that owns them rather
than as a field of their own. Whatever surface holds one holds the other; a builder that could
author a repeat's condition and not a fork's would be a worse gap than having neither.

**A `core.try` adds no row, and that is the point of where its retry policy sits.** A container with
a structural key needs a surface of its own; a container whose configuration is ordinary `with:`
fields does not. An attempt count and a backoff are numbers, `number` is a mappable field kind, and
the argument that pushed a condition out of `with:` was about booleans — so a try's fields are edited
in the Step editor exactly as any Component's are, and the table stays four rows long.

### The Template input

`min-height` 40px (76px for textarea), `--radius-md`, 1px `--border-strong`, `--surface-card`,
`padding: 8px 10px`, `cursor: text`, mono. A single-line field holds one line and scrolls, exactly as
an `<input>` does; only the textarea wraps. **Its height belongs to the field kind, never to the
value** — a manifest declaring `kind: text` gets a 40px control and `kind: textarea` gets 76px, and a
field that resized itself from its content would take that decision away from the declaration and
hand it to whatever somebody happened to type.

That leaves a long value with most of itself out of reach, and at rest there is no focus with which
to scroll it, so the whole value is offered through a `Tooltip` — showing the same chips, wrapped
over as many lines as it takes, because re-describing them as raw text answers a different question
from the one the chips were asked. A field that grew a second line as you typed would be the
only one on the screen that did, and the box changing height under the caret is the part that gets in
the way. Border `--border-accent` while focused or on drag-over
(fill `--accent-wash`), `--status-error` when the field has an issue.

The text is the editing surface, and while it is showing it is marked the way every editor anyone
reaches for marks syntax: **by colour, with no box.** The path takes `--text-accent`; `{{` and `}}`
take `--text-muted`, because they are how a Template *spells* a hole rather than part of what it
names, and they step back to let the path read. A hole nobody can read takes a wavy `--status-error` underline —
whether it is missing its closing braces or simply does not parse, because the two are the same fact
to whoever has to fix it. Except the one being written: `{{ s2.` is not a mistake, it is the third
keystroke of a path, and marking it while the completion list is open offering the rest of that path
teaches people to stop looking at marks. It is never replaced by a widget you cannot type through.

A fill and a border were specified here and are gone. The strong mark for *this names a value* is the
chip below, which is what shows whenever nobody is editing — a box under it while editing is emphasis
paid for twice, and a border drawn round a token is something the eye reads past on the way to the
text this field exists to let someone edit. It also retires a class of fault rather than fixing
instances of it: a box has geometry — an overhang, a radius, a fill box centred on the font's content
area rather than on the line — and every piece of that had to be made to behave like a glyph inside a
mirror standing in for an `<input>`. Colour has no geometry, so there is nothing left to slide out of
alignment or to clip.

**At rest, every hole that parsed is drawn as a chip.** A hole is a hole whether or not it names one
value, and one drawn as bare text among the words around it is the only thing on the line that does
not look like what it is. What differs is what the chip can *say*: a **Reference** names exactly one
value, so its chip carries that value's source and its kind's mark; anything computed —
`{{ s2.count + 1 }}` — has no single source to name, so its chip shows its own text, and the absence
of a mark is what tells the two apart without inventing a symbol for "computed". **The References
inside it are still named**: `s2` is a Step's id, and one field showing "Fetch emails › count" beside
a raw `s2.count` is two vocabularies at once, of which the raw one is the half nobody chose. They are
substituted by span and only where the source agrees character for character — rebuilding the
expression from its tree would be AST→text, which is ADR-0008's argument in another costume. A Reference whose
path has gone stale falls to the same treatment, which keeps the path the checker will name on
screen. A hole that does not parse at all keeps its characters, because they are the only thing that
can be edited back into shape.

**A Reference's chip says what it names, and where it is from.** A chip carries a
mark for its kind, then the source in `--text-secondary` and the value in `--text-accent`:
`▢ Fetch emails › count`, `≡ Variable › digest_to`. The source is always there, because a label
alone loses the half that matters — `var.digest_to` reduced to "digest_to", and two chips reading
"digest_to" and "count" say nothing about where either value is from. Where the path passes through
a named entity that entity supplies the source; where it does not, the kind's own word does, so
`run.id` reads "Run context" and never "run". Unfocused there is no caret to keep
aligned, so the mirror painting the highlight is free to be a different width from the field behind
it — which is precisely what showing `Fetch emails count` in place of `{{ s2.count }}` requires.
Focus puts every character back, braces and all, so the sentence above holds wherever it means
anything — and a click at rest is translated through the visible text rather than through the
characters behind it, or the word after a chip would put the caret several characters earlier,
inside the hole. Clicking a chip itself lands at the end of its expression, which is where an edit
starts. Two conditions, both the parser's to answer: the hole is a **Reference** (`isReference()`
reads the parsed shape, and `{{ s2.count + 1 }}` names no single target), and the path is still in
scope — a stale one keeps showing the path, because that is what the checker names and what has to
be edited.

### Four ways in, one set of candidates

| Trigger | What opens |
| --- | --- |
| Typing `{{` | The hole closes itself, and inline completion opens — ghost text plus a list, anchored at the caret. Typing the closing brace steps back over the closer, which is one keystroke instead of three arrow presses |
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
- **It judges the hole, not the field.** A hole that is the whole value resolves to the field's
  value and keeps the expression's own type, so the field's declared type is what it must produce. A
  hole inside mixed text is concatenated into a sentence, so it has only to render — which is
  `text`, and `match()` already spells that out as *any scalar fits*. This is what `validate` already
  does: for a Template with more than one segment, `checkTemplate` infers each hole and then judges
  *the template* as text, saying nothing about what any individual hole produces. Marking such a hole
  against the field's type would withhold the rail from rows the checker is perfectly happy with, and
  the rail's only signal is that a row fits **here**. It is not a loosening to nothing: a list or an
  object in a sentence stays unmarked, which is ADR-0009's own line that softness "does not extend to
  non-scalars".
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
| `ManifestSource` | Components, Triggers, and Run Context declarations — one flat array of `ManifestEntry`, every entry carrying `kind` |
| `WorkflowStore` | The Draft, its lease, versions, publish/release/discard |

Every field on `HostPorts` is optional and a region whose port is missing degrades rather than
throws. **Two absences are different states**: "the Host wired nothing" and "the Host declared
nothing" have different fixes and different copy.

The **Workflow tab** is the first region other than validation to read **two** stores: the document
says which Triggers a workflow declares, and only the catalogue says what a Trigger's fields are. The
Data panel is the second, because scope needs both. A Host supplying one and not the other is a real
case; render it as an empty state, not a crash.

Function Manifests have a format and no port. The first surface to read Host-declared Functions is
the completion list, and that is when the port becomes justified — a port with no reader is a shape
guessed at rather than one a screen forced.

---

## Copy

`.agents/rules/rendered-copy-is-written-for-the-hosts-users.md` governs every string that reaches the
DOM. In short: **misconfiguration copy** can only reach the integrator and should name Hatua and the
prop; **runtime copy** renders in a correctly-wired product and must name neither Hatua nor Host,
port or manifest.

The Components tab is where the distinction is drawn twice over: an empty catalogue and one holding
only Triggers are both *No components are available yet.* — runtime copy, said to the person looking
at it — while a catalogue whose entries carry no `kind` this region reads is a wiring mistake and
names the key that fixes it.

---

## What the original handoff got wrong

Recorded here so the two documents cannot disagree quietly. ADR-0011 already lists the first three.

| The original said | What holds instead |
| --- | --- |
| `inputs[]` on the document | Retired. A Trigger's declared outputs are the parameter contract |
| `dirty` enables **Save changes** | Editing autosaves (ADR-0005). No Save button, no flag |
| "Are manifests served by the Host?" — open | Answered: yes, through `ManifestSource` |
| Trigger is a Step: `core.start`, `once`, `fixed` | `doc.triggers[]` is top-level. The canvas draws a derived root node; `once`/`fixed` become unnecessary |
| The **Data tab** — reference tree over a variables editor | Split. The tree moves beside the step editor; variables move to the Workflow tab. One panel held two scopes, and listed every variable twice |
| The tab strip is **Flow / Library / Data** | **Workflow / Components**. Flow is optional; Data is not a tab |
| "Library" | "Components" — the glossary term, and the region's name |
| The picker inserts References | It inserts References **and Functions**, with parameter descriptions and signature help |
| Leaf rows carry a dot, accent for lists | A left rail, green when the row fits the field's type |
| The ⚡ picker is the only alternative to dragging | Typing `{{` and `Ctrl`+`Space` are the primary paths; the picker is the browsable one |

---

## Open

- **Host-declared Functions** need a port. The completion list ships reading `CORE_FUNCTIONS` and
  `CORE_NAMESPACES`; a Host's own namespaces have no route in yet, and that is the PR that justifies
  the port's shape.
- **`Ctrl`+`Space`** conflicts with input-source switching for multilingual macOS users. `Ctrl`+`.` is
  the fallback if it bites.

Two that were open here are now settled and recorded above: the **Run Context schema**, in
[ADR-0012](adr/0012-run-context-is-a-fourth-manifest-kind.md) and under [Run Context](#run-context);
and **mixed text and the type marking**, under [The type marking](#the-type-marking).
