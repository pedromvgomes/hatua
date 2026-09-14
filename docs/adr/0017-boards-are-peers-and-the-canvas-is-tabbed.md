# Boards are peers, and the canvas is tabbed

A **Workflow Definition** holds one root Board plus one per **Block**, and the canvas draws one at a
time (ADR-0013). Something has to say which one, and how to get to another. A breadcrumb was the
first shape — *Triggers › Archive an entry*, with a Back that returns to the root. It is replaced by
a **tab strip**: the canvas holds a working set of open Boards, one of which is active.

## A breadcrumb makes a claim the model refuses

A breadcrumb draws a **path**, and a path has one parent per node. Boards do not.

A Block is *called*, possibly from three places. It sits under all three and under none, and there is
no fact of the matter about which one the breadcrumb's `›` refers to — it names whichever call site
the user happened to click, which is a property of the session rather than of the document. Two users
looking at the same Block would be shown two different ancestries, and neither is wrong, because the
question has no answer.

That is not a cosmetic mismatch. ADR-0013 spends its length establishing that **reachability is
nesting** *for Steps* — a Step runs because of where it sits in the tree — and that a Board is
reached by the one cross-link the model permits, a call with a contract. Drawing Boards in a
hierarchy re-tells, in chrome, exactly the shape that ADR refused in the model. A tab strip says what
is true: Boards are peers, and one of them is in front.

## What the strip is

A **working set**, not an index.

| | |
| --- | --- |
| The root Board | always present, always first, cannot be closed |
| A Block's tab | opens when a call site is opened, or when the Block is declared |
| Closing | any Block tab, at any time; the root takes focus |
| A deleted Block | its tab closes, and the root takes focus |
| Opening an already-open Board | focuses that tab; never opens a second |

**One tab per Board, never per call site.** A Block called from three places has one Board, so it has
one tab. A tab per call site would reintroduce the breadcrumb's error wearing a different control —
three tabs for one Board, differing only in how the user arrived.

A tab for every declared Block, permanently, was the alternative. It removes the lifecycle entirely
and doubles as a complete Board index, and it was rejected on what it does to a document with ten
Blocks: ten permanent tabs, none of which says which two are being worked on, inside a region that is
embedded in somebody else's product. The strip exists to say what is in hand.

## A tab holds its own viewport and its own selection

This amends ADR-0016, which says opening a Block's Board resets the viewport, because coordinates
are Board-local. That remains what happens when a tab is *opened*; it is no longer what happens when
one is **returned to**. A tab keeps the pan and zoom it had, because returning to a Board and
finding it re-centred discards the only thing the user did to it.

Selection is per tab for the reason `StepRef` carries a Board: a selection names a Step *and* the
Board it is on, so it is meaningless anywhere else. Held per tab, going to another Board and coming
back leaves the selection where it was, and the step editor is never handed a Step from a Board
nobody is looking at.

None of it reaches the document. Which Boards are open, which is active, and what each is scrolled
to are all the same kind of thing as a node position (ADR-0001) and a viewport (ADR-0016): a fact
about a session, and a diff in the Host's repository for nothing.

## What it costs

**A third strip of chrome.** The side panel is tabbed, the Host's own product very likely is too, and
this adds one more inside the canvas. That is the real price and it was paid deliberately: the
alternative that avoids it — keeping one canvas and upgrading the breadcrumb's leaf into a Board
switcher menu — navigates just as well and still cannot show a working set, which is the thing a
user editing a Block and its caller together actually needs.

**Overflow.** A working set is small by construction, but it is not bounded, and a strip narrow
enough to embed will run out of room before the set does.

**Side-by-side is still refused**, and this does not open the door to it. Two Boards drawn at once is
the thing ADR-0013 rejects: drawing a Block's body inline at its call site was the alternative it
weighed and refused. A tab strip is a way to *switch*, which is the opposite claim. It needs its own
decision, and does not get one here.
