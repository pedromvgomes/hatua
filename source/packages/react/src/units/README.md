# units

Presentational domain units — `NodeCard`, `Connectors`, `InsertDot`, `LinkLabel`,
`RegionBand`, `JoinMarker`, `RootNode`, `IconCoin`, and the `boxOf` helper that
turns a `Rect` into the style that puts a box where it says.

**Rule:** props in, events out. No reaching into `@hatua/services`. Enforced by
`noRestrictedImports` in the workspace `biome.json`.

Named `units` rather than `blocks` because a **Block** is a domain term — a named,
reusable sequence of Steps invoked as `use: block.<id>` — and one word for two
things in one repo is the *Flow tab* / `FlowMap` collision this repo has paid for
once already. Nothing in here is a Block, and a Block is not drawn by anything in
here.

Not exported from `@hatua/react`, the same as `compounds/`. The seam a Host
writes against is a region; a card is how one region happens to be drawn.

## They compute no geometry

Every box comes from `@hatua/layout`: a `Rect` for a card and the root node, a
`Band` for a region, a `Join` for where a Fork's Branches converge. That is the
layouts tier's rule — "this tier draws what it is handed and computes no geometry
of its own" — and it holds one level down for the same reason. A unit that worked
out where it went would be a second implementation of `layout.ts`, in the half of
the codebase with no tests over coordinates.

`boxOf` is where a `Rect` becomes CSS, minted once so four units cannot pick two
conventions. It is deliberately `left`/`top` rather than the logical properties
this repo uses everywhere else: flow-map coordinates are physical by definition,
and a logical inset would mirror the whole map under an RTL Host while the
numbers stayed the same — drawing a Fork's first Branch last.

## What each unit is

| Unit | What it is |
| --- | --- |
| `NodeCard` | One Step's card: the icon, the name, the verb, the chips row, the chevron, and the doorway on a call site. |
| `Connectors` | Every line on one Board, in one SVG behind everything else. |
| `InsertDot` | The `+` on a link: where a Step is added, and where one is dropped. |
| `LinkLabel` | The word on the line entering a region. |
| `RegionBand` | One child region's extent: a frame, and no text. |
| `JoinMarker` | Where a Fork's Branches come back together. |
| `RootNode` | The node above the first Step — the Triggers, or a Block's contract. |
| `IconCoin` | A Component's icon, as the Host serves it, in a fixed square. |

`RootNode` is not a `NodeCard` variant, for the same reason `FlowMap.root` is a
`Rect` and not a `Placement`: **it names no Step.** An optional Step on the one
component every card goes through would push "sometimes there is no Step here"
into every reader, to spare a file.

`IconCoin` is shared with `layouts/Components`, which drew the same coin with its
own copy of the broken-URL fallback. One answer to "what does a Component look
like as an icon", used by the catalogue and by the canvas.

## The word and the frame are two different jobs

`LinkLabel` says **what** a region is — `if`, `else`, `loop`, `try`,
`on failure` — on the line that carries a reader into it, which is where they are
already looking. `RegionBand` says **how far it reaches**, as a quiet frame with
no text in it at all.

Two things saying one word over one region would be the duplication this repo
refuses everywhere else. The frame earns its place by saying the thing the word
cannot: where the region stops, which matters most for a `core.try`'s two regions
stacked on one spine.

Every word comes from `regionsOf` through `Region.keyword`, so the chip here and
the chip `<StepList>` puts over the same region are one string from one function.

## There is a `Connector`, and it draws no edge

An earlier plan listed one and this file once argued it should never exist. That
argument was wrong, and the screen is what settled it: at `LAYOUT.verticalGap` of
96px, a map with no lines is cards floating in a void, and the claim that "the gap
already reads as a run of the flow" does not survive looking at it.

What ADR-0013 refuses is an **attachable** edge — "no connect affordance, no exit
handles and no drawn connectors the user can attach anything to" — and what
CONTEXT.md refuses is a **Connection** as a thing in the model. A line that says
"then" is neither. Nothing on it takes a pointer, nothing is stored, and its two
endpoints come from `@hatua/layout` like every other position on the map; only the
curve between them is this tier's, because a curve is how a line looks getting
somewhere rather than where anything is.

`StepRow` was on the same list and is not here. It lives inside `<StepList>`,
which is its only reader; extracting a component for one call site buys a file and
an indirection. It moves here when something else needs it.

## Every unit has a test and a story

`units.test.tsx` covers them all plus `boxOf`; each has a `*.stories.tsx` beside
it. `layouts/stories.fixtures.test.ts` scans this directory as well as `layouts/`
and asserts each one yielded story files, so a fixture holding a Workflow
Definition is covered here the day one appears.
