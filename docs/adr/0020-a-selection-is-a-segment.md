# A Selection is a Segment

What the canvas selects is a **Segment** — a contiguous stretch of sibling **Steps** in one region of
one **Board** — and it is a Segment *by construction*. No gesture builds anything else, so nothing
anywhere has to check whether a selection is extractable, and nothing has to refuse one.

## Why the shape is forced

ADR-0018 defines extraction over a Segment and refuses everything else: a non-contiguous pick would
reorder execution, and a pick spanning two regions has no single list to become. Extraction is why
multi-select exists at all: it takes several Steps, and a canvas that selects one has no gesture that
names them.

So the shape of a selection was going to be answered by extraction whatever happened. The only open
question was **where the answer is enforced**, and there were three places to put it.

**A free set, and the action refuses.** A selection leaves this region — `<StepList>` highlights it
and the step editor is handed it — so a set that may or may not be extractable makes every consumer
re-answer "is this one?". That is one question with several answers living in several files, which is
the defect the map and the list have already disagreed over twice. It also ships an action bar whose
principal action is greyed out in the ordinary case, with the reason somewhere the user has to go and
find.

**A free set, and the canvas refuses at selection time.** Worse than either: the gesture is offered,
the user makes it, and nothing happens. A control that is live and does nothing reads as a fault —
the argument `CanvasControls` already makes about greying out the ends of the zoom range.

**By construction**, which is what this records. If the only additive gesture extends a range within
one sibling list, every selection the canvas can produce is already a Segment. There is no invalid
state to represent, no validation to write, and no refusal for a user to interpret.

## What it costs

**No ⌘-click, so no scattered multi-remove.** Three unrelated Steps are three removes. This is the
real price and it is paid deliberately: nothing has asked for scattered removal, while extraction —
which needs contiguity — is the entire reason the gesture exists.

**No marquee.** A marquee selects by *geometry*, and geometry cannot help crossing a **Band** edge or
skipping a card. Constrained to build only Segments it would have to select less than the user
dragged over, which is the dead-gesture problem above wearing a different control. It is also the one
gesture with no keyboard equivalent, and the catalogue's click path exists precisely because drag has
none.

## The gesture, and that it is reachable

Plain click selects one Step and sets the anchor. Shift-click extends from the anchor through the
sibling list they share. Shift-clicking into a *different* list is not a no-op — it does what a plain
click does and becomes the new anchor, so there is no click that leaves the user holding nothing.

`Shift`+`↑`/`↓` is the same operation from the keyboard: the anchor stays and the head moves, so one
keystroke both grows a Segment and shrinks it from the other end. Every card's name is already a
`<button>` and the cards are in document order, so `Tab` walks the Board and this extends from
wherever it stopped.

Bare arrow keys are deliberately **not** claimed. They are ambiguous on a two-dimensional map, `Tab`
already moves between cards, and Hatua is a guest in someone's page — the same reason the space-pan
handler fires only while the canvas is hovered or holds focus.

`Escape` clears, because an action bar needs a dismissal that is not "pick something else". That is
why `<FlowMap>`'s `onSelect` reports `undefined`, as `<StepList>`'s does: a caller holding the
selection has to hear that it is gone, or it keeps handing back Steps nobody has selected.

## A Segment is named by Steps, not by positions

`{ board, steps: string[] }`, and never a start index and a length.

Selection is **held** across edits. An index range would mean a Step added above the Segment
silently changes what is selected — the argument `RegionRef` already makes about `branchIndex`,
which it accepts only because a **Branch** has no id and a **Step** has one.

So contiguity is *derived* rather than stored: the region resolves the Segment against the Board it
is drawing, exactly as it already filters `collapsed` down to that Board. What the type does carry
structurally is the **one Board**, by hoisting it out of the Steps — `readonly StepRef[]` can
express a selection spanning two Boards, which is not a Segment and never can be.

## The word

**Segment**, not *run*. `run.` is a namespace root, the **Run Context** is the scope every Board
shares, a `run` **Link** on the flow map is the gap *between* two Steps — the near-opposite of this,
drawn on the same surface — and a **Workflow Execution** already lists the word on its `_Avoid_`
line. *Span* was the closest alternative and fails the same way: a **Workflow Execution** rendered as
a trace wants it. ADR-0018 says **Segment** throughout for the same reason.
