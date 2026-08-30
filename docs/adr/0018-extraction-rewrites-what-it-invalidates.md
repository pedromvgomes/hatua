# Extraction rewrites what it invalidates

Extracting a **Segment** — a contiguous stretch of sibling **Steps** in one region — into a
**Block** moves them onto a new **Board**, works out what the Segment reads from outside and
publishes back, and replaces it with a call. ADR-0013 names this
twice as the reason `blocks:` exists — "extracting the middle into a Block leaves a root of three
lines, exactly as extracting a function does" — and `blocks.ts` and `tree.ts` both say their seams
were cut for it.

**It rewrites every Reference it invalidates.** That contradicts a rule stated in `renameBlock`'s
docstring and again in `docs/handoff.md`, and the rule is not weakened: this records why extraction
is not an instance of it.

## What the never-rewrite rule is actually about

> Rewriting every Template on a keystroke would edit the user's file in places they are not looking,
> and mid-typing every intermediate key is a rename too.

Three properties do the work in that sentence, and none of them is "an edit reached a Template the
user was not looking at".

The edit is **continuous** — there is no moment that is the change, because every intermediate
keystroke is as much a rename as the last one. It is **ambiguous** — `arch` on the way to `archive`
is indistinguishable from `arch`, so the mechanism cannot know which renames to propagate. And it is
**unnamed** — there is nothing to put on an undo entry, and nothing for a user to undo *to*.

Extraction has none of the three. It is one gesture with one moment, one unambiguous before and
after, and one `sequence()` — which exists for exactly this, "several commands as one undoable
change", all-or-nothing, with `EditingStore.apply` restoring the document's previous **text** when
any member throws. One undo, labelled, puts every Template back.

## Not rewriting is not the conservative option

A stale Reference after a rename is one Reference, and the user broke it on purpose — they retyped a
key knowing what it was named. The checker reports it and they fix it, which is a fair trade for not
editing a file mid-keystroke.

Extraction is not that trade. It is defined as **behaviour-preserving**: the workflow runs the same
steps in the same order before and after, and the only thing that changed is where they are written.
A non-rewriting extraction breaks **every** downstream consumer at once, as an unavoidable side
effect of a gesture whose entire purpose is to change nothing about behaviour — and it breaks them in
proportion to how useful the extracted Segment was. It would be the one gesture in the product
guaranteed to leave the document worse than it found it, and the user's repair is to retype by hand
exactly the mapping the gesture already computed.

Declining to rewrite here does not preserve the rule. It preserves the letter of the rule by making
the feature not work.

## What is rewritten, exactly

Inside the Segment, against ADR-0013's contract rule — "a Block sees its own Board and the Host's Run
Context, and nothing else … Anything else a Block needs, it takes as a parameter":

| Reference in the extracted Segment | Becomes |
| --- | --- |
| `run.*` | unchanged — Run Context is on every Board |
| `steps.X.*`, `X` inside the Segment | unchanged — `X` moved too, and ids are Board-local |
| `steps.X.*`, `X` outside the Segment | a parameter, rewritten to `{{ params.<k> }}` |
| `triggers.*`, `TRIGGER` | a parameter |
| `var.*` | a parameter |
| `params.*` | a parameter |

Outside the Segment, on the Board it left: `{{ steps.X.y }}` naming an `X` that moved becomes an output,
rewritten to `{{ steps.<call>.<k> }}`. A `core.return` is appended to the new Board binding each
output to `{{ steps.X.y }}`, which still resolves because `X` moved in. One appended return
discharges `BLOCK_PATH_WITHOUT_RETURN` on every path, because sibling regions converge (ADR-0015).

**A declaration's `t` is the type of the field the Reference feeds, not the type of the Reference.**
The Slot at the original site already carries `expectedType`, so this needs no inference pass — and
it is the half that matters: a Fork's `when:` is boolean because a condition is (CONTEXT.md), so a
parameter carrying it that was declared `text` would raise `EXPR_TYPE_MISMATCH` the moment the
extraction landed. Extraction manufacturing a diagnostic on a workflow that had none is the failure
this rule exists to prevent. `text` is the fallback where a template holds literal text around the
hole, where two fields disagree, or where the field declares nothing — the same fallback and the same
reason as `addVariable`'s: the schema's `t` has six values and no `unknown`.

## What is refused rather than repaired

**A Segment containing a `core.return`.** Extracted, that return would bind to the *new* Block's
`outputs:` and silently publish something else. There is no repair that preserves behaviour, so the
gesture is not offered.

**Anything that is not a Segment.** A Block's Board is a list, so what is extracted has to be one: a
non-contiguous pick would reorder execution, and a pick spanning two regions has no single list to
become. That is why **Segment** is the shape the canvas's gesture builds rather than a check applied
to a looser one (CONTEXT.md) — there is no selection this rule can be handed that it has to refuse.
A Segment of one is allowed, because a single container with its whole body is the flattening case
ADR-0013 leads with.

The word is **Segment** and deliberately not *run*: `run.` is a namespace root, the **Run Context**
is the scope every Board shares, and a `run` **Link** on the flow map is the gap *between* two
Steps. A **Workflow Execution** already refuses the word.
