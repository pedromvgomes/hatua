# units

Presentational domain units — `NodeCard`, `RegionBand`, `JoinMarker`, `RootNode`,
and the `boxOf` helper that turns a `Rect` into the style that puts a box where
it says.

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
| `NodeCard` | One Step's card: its name, a container's summary, the chevron, and the doorway on a call site. |
| `RegionBand` | One child region: the frame around it and the word over it. |
| `JoinMarker` | Where a Fork's Branches come back together. |
| `RootNode` | The node above the first Step — the Triggers, or a Block's contract. |

`RootNode` is not a `NodeCard` variant, for the same reason `FlowMap.root` is a
`Rect` and not a `Placement`: **it names no Step.** An optional Step on the one
component every card goes through would push "sometimes there is no Step here"
into every reader, to spare a file.

`RegionBand` covers what an earlier plan called `BranchLabel`. Every child region
gets a band and not only a Branch's — the band is *what tells regions apart*, so
a `core.try`'s body and handler and a loop's body are the same shape under
different words. A unit that only labelled Branches would have left the other
two regions with nothing naming them.

## There is no `Connector`, and there will not be

An earlier plan listed one. It should not exist.

ADR-0013 refuses an *attachable* edge — "no connect affordance, no exit handles
and no drawn connectors the user can attach anything to" — and CONTEXT.md
resolves that "there are no connections to draw". Neither of those on its own
refuses a plain rule between two cards, so this is a decision rather than a
consequence: **nothing is drawn between cards.**

The reason is in the geometry. `LAYOUT.verticalGap` exceeds `nodeHeight` so that
"the space between two cards reads as a run of the flow and not as a crack
between two cards that nearly touch" (`docs/handoff.md` § Flow map geometry) —
the gap is already carrying it. Every card on a spine is the same width and
centred on it, so a line down that spine restates an adjacency the reader can
already see. Where the flow does something a column cannot say — alternatives,
and where they end — `RegionBand` and `JoinMarker` say it, and both are boxes
`@hatua/layout` computed rather than ink a canvas invented.

`StepRow` and `InsertPoint` were on the same list and are not here either. They
live inside `<StepList>`, which is their only reader; extracting a component for
one call site buys a file and an indirection. They move here when something else
needs them.

## Every unit has a test and a story

`units.test.tsx` covers all four plus `boxOf`; each has a `*.stories.tsx` beside
it. `layouts/stories.fixtures.test.ts` scans this directory as well as `layouts/`
and asserts each one yielded story files, so a fixture holding a Workflow
Definition is covered here the day one appears.
