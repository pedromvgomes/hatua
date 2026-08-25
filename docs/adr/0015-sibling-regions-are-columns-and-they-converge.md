# Sibling regions are columns, and they converge

The flow map drew a `core.fork`'s **Branches** side by side and everything else stacked under the
card that owned it, so a **Try**'s protected body sat above its handler on one spine. We decided
instead that **every child region of a Step is a column in one row, and they converge on a Join** —
a loop is one column, a try two, a Fork *n* — and that what distinguishes a Fork from a Try is the
edge style of each region rather than the arrangement of them.

## Why the drawing was wrong and the model was right

`CONTEXT.md` § Try and this repo's own ADR-0013 already describe the two regions as **siblings**:

> The two regions are **siblings**, so the body cannot see the handler and the handler cannot see the
> body's Steps — and this needs no code, because it is the rule that already keeps a **Fork**'s
> branches out of each other's scope.

and, on a **Block**'s obligation to reach a `core.return`:

> That is the **Fork**'s all-branches reasoning asked of two regions, one of which is conditional.

So scope and validity had already answered "what is the relationship between a try's two regions" —
the same one a Fork's Branches have. Only the geometry answered differently, and it was the newest
of the three.

Stacking said the wrong thing twice. Top-to-bottom means **then** everywhere else on this map, which
is the one thing a handler never does — it runs *instead*. The design of record tried to carry that
on an absence: *"the gap between two Bands is what says or else."* An absence is the weakest signal
available, and it decays with distance — on a real document a handler's top edge sat some 1700px
below the card that owned it, with nothing on screen associating them. Columns cannot decay: both
regions begin at the same y under the card, however large the body grows.

## What replaced the Fork's shape

The cost is real and was taken deliberately: two frames side by side under one card used to mean
"alternatives, one of them runs", and a two-Branch Fork and a Try are now the same drawing. The
distinction moved to an edge style, on a rule the stylesheet already stated for a Branch — *which
one runs is a question the document answers at run time.* Applied to what each region actually
guarantees rather than to the verb that owns it:

| Region | Always runs? | Edge |
| --- | --- | --- |
| A **Branch** | no — depends on its `when` | dashed |
| A **Try**'s body | yes — it always starts | solid |
| A **Try**'s handler | no — only on failure | dashed |

So a Fork is *n* dashed columns and a Try is one solid column beside a dashed one: different at a
glance, from a rule that says something true about each region.

**The rule is scoped to sibling regions and does not reach the loops**, though `alwaysReturns` draws
the same line there (a `core.for_each`'s body may never run; a `core.repeat`'s always runs once).
Dashed already means *placeholder* in this codebase — the `+` is a dashed circle and an empty region
is a dashed box — and it survives that collision here only because it sits beside a solid sibling.
A lone loop body has nothing to be read against, so a dash there would read as unfinished.

## Consequences

**A Join is a Step's, not a Fork's.** It exists because columns need to be told where they end, which
is a fact about columns and not about forking; and refusing a Try one would make "no mark here" the
signal that separates it from a Fork, which is the same absence-as-meaning this decision removes.
Flow does resume below a Try whether the body finished or the handler ran, so there is a real
convergence there and nothing drew it.

**A region is addressable.** Collapse becomes per-region rather than per-Step, for any sibling column
— a wide Fork has the same problem a big Try does — so `@hatua/model` gains a `RegionRef` beside
`StepRef`, and `<FlowMap>`'s `collapsed` prop names regions.

**Width is the price.** A Try is now one column wider than the list it protects, and that compounds
with depth. It is paid down by a column that is not showing a list — collapsed or empty — taking a
short box rather than matching its siblings' height, which also keeps a fresh Try compact: born with
`steps: []` and `handler: []`, it is a card over two small boxes.

**`<StepList>` does not follow.** A list has one dimension and no width problem, and it already folds
per Step. The two surfaces have never had to draw alike — only to agree about which regions exist and
what they are called, which they do through `regionsOf`.
