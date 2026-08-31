# Extraction moves the Steps; the author wires the contract

Extracting a **Segment** — a contiguous stretch of sibling **Steps** in one region — into a
**Block** moves those Steps onto a new **Board** and leaves a call where they were. ADR-0013 names
this twice as the reason `blocks:` exists — "extracting the middle into a Block leaves a root of
three lines, exactly as extracting a function does" — and `blocks.ts` and `tree.ts` both say their
seams were cut for it.

**It moves and it calls. It does not invent a contract.** The new Block declares no parameters and
no outputs, and every Template travels exactly as the author wrote it. What the Segment used to read
from around it now names nothing on the Board it landed on, and the author declares the parameter,
points the Template at it, and fills it at the call site.

## What survives the move for free

Step ids are **Board-local** (ADR-0013), and a Segment moves as a set. So `{{ steps.X.y }}` naming
an `X` that moved with it keeps resolving, and keeps resolving to the same thing — which is most of
what a cohesive stretch of Steps reads. That is not a repair; it is a property of ids being local to
a Board, and it is why extracting a *cohesive* Segment is nearly free while extracting an arbitrary
one is not.

Everything else stops resolving:

| Reference in the extracted Segment | After the move |
| --- | --- |
| `steps.X.*`, `X` inside the Segment | resolves — `X` moved too, and ids are Board-local |
| `run.*` | resolves — the Run Context is on every Board |
| `steps.X.*`, `X` left behind | names nothing |
| `triggers.*` | names nothing — a Block does not see the workflow's Triggers |
| `var.*`, `params.*` | names nothing — both are read from the Board the Step sits on |

And symmetrically, on the Board the Segment left: `{{ steps.X.y }}` naming an `X` that moved now
names nothing.

**Nothing is lost.** The Template is carried across unaltered, so the expression the author wrote is
still on screen to read and to copy. The repair is to declare a parameter, change the Template to
`{{ params.<k> }}`, and put the original expression in the call's `with:` — three edits against text
that is all still in front of them.

## Why it does not infer the contract

ADR-0021 repairs the References an edit invalidates when the edit is **discrete, unambiguous and
named**. Extraction is discrete and it is named. It is not unambiguous, and that is the whole of it.

A rename has exactly one right answer. The new name is *given*, every site that reads the old one is
mechanically determined, and the rewrite invents nothing — which is why repairing it is repair.

Extraction has no answer written down anywhere. Turning `{{ triggers.overnight.message.subject }}`
into a parameter is three decisions the document does not contain: that it should be a parameter at
all rather than something the Block derives or a Trigger the Block's caller already has in hand;
what it is called; and, where the field it feeds declares nothing or two fields disagree, what type
it carries. The outputs half is more speculative still — it reads the Board the Segment left and
decides, on the author's behalf, which of the values it produced were part of a contract and which
were incidental.

So the boundary is: **Hatua repairs what it can derive, and refuses to invent what it cannot.** A
name Hatua chose is written into a file Hatua does not own (ADR-0001), and a parameter called
`subject` where the author meant `thread` is a wrong answer wearing the shape of a right one — the
author has to read a generated contract closely to find out, which is more work than filling in a
gap that is pointed at.

## Why the gap is safe to leave

Only because it is **reported**. Design-time checking already knows that a Reference naming nothing
is an error — `EXPR_UNKNOWN_REFERENCE`, with the rest of the `EXPR_*` family beside it — and
`validateDefinition` carries that family as a rule alongside the ones about components, fields,
containers and blocks. So the moment the Steps land, the Board says which Templates need wiring and
where, in the same marks the author already reads for everything else.

Extraction that broke References silently would be a different gesture entirely: a clean-looking
canvas over a workflow that no longer runs, discoverable only at run time. The gesture and the rule
are one decision, and an extraction offered without the rule in place is the failure this section
exists to prevent.

## What is refused rather than offered

**A Segment containing a `core.return`.** Moved, that return binds to the *new* Block's `outputs:` —
which are empty — so it publishes nothing and ends a Block the author did not mean it to end. No
diagnostic names that, because there is nothing malformed about it, and no repair preserves
behaviour. The action is drawn and **disabled**, carrying the reason: a control that vanished as the
selection grew would leave the author with no way to learn what they did, and a zoom limit is
self-evident from a readout where this is not.

**Anything that is not a Segment.** A Block's Board is a list, so what is extracted has to be one: a
non-contiguous pick would reorder execution, and a pick spanning two regions has no single list to
become. That is why **Segment** is the shape the canvas's gesture builds rather than a check applied
to a looser one (CONTEXT.md) — there is no selection this rule can be handed that it has to refuse.
A Segment of one is allowed, because a single container with its whole body is the flattening case
ADR-0013 leads with.

The word is **Segment** and deliberately not *run*: `run.` is a namespace root, the **Run Context**
is the scope every Board shares, and a `run` **Link** on the flow map is the gap *between* two
Steps. A **Workflow Execution** already refuses the word.

## The alternative that was rejected

Inferring the whole contract and rewriting every Reference to match: parameters minted from each
outside Reference's last path segment, typed from the `expectedType` of the Slot the Reference
feeds; outputs derived from what the Board it left still reads; a `core.return` appended binding
each one; and every Template rewritten so the workflow behaves identically before and after.

Its advantage is real and should be recorded: extraction would preserve behaviour exactly, and the
author would have nothing to fix. Against a gesture whose purpose is to change *where* Steps are
written and nothing else, that is the natural shape.

It is rejected because the inference is authoring rather than repair, and authoring done silently.
Every key it writes is a name no one chose, in a file in the author's repository; the type is
derivable only where the field declares one, which leaves `text` as a fallback in exactly the cases
where the guess matters most; and the outputs half decides what a Segment's contract *was* from
evidence that only says what happened to read it. A contract the author writes after being shown
precisely what is missing is better than one they have to audit — and the machinery that shows them
is a rule the checker already had and nothing was calling.
