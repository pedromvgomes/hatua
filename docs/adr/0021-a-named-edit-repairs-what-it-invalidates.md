# A named edit repairs what it invalidates

Renaming a **Block**'s slug, a **Variable**'s key, or a **Block**'s parameter or output key rewrites
every **Reference** that named it. The rule this replaces — that a rename goes stale and the checker
reports it — was written against a danger the input widget had already removed.

> Hatua repairs the References an edit invalidates when the edit is **discrete**, **unambiguous** and
> **named**. It never rewrites continuously, in the background, or on load.

## The rule it replaces rested on a fact that is not true

ADR-0018 states the never-rewrite rule's actual content, and it is three properties rather than "an
edit reached a Template the user was not looking at". The edit is **continuous** — every intermediate
keystroke is as much a rename as the last one. It is **ambiguous** — `arch` on the way to `archive`
is indistinguishable from `arch`. And it is **unnamed** — there is nothing to put on an undo entry.

No rename in this product has any of the three. `CommittedInput` writes on **blur or `Enter`** and
reverts on `Escape`; nothing calls a rename command per keystroke, and nothing ever did. So there is
one moment that is the change, one unambiguous before and after, and one `sequence()` to put on the
undo stack.

The rule was a correct answer to a question the widget stopped asking.

## What not rewriting costs

A rename that does not rewrite breaks every consumer at once, as an unavoidable effect of a gesture
whose purpose is to change a name and nothing else. The user's repair is to retype by hand exactly
the substitution the command already knew how to make.

The three properties are what carry that, and **unambiguous** is the one that does the work.
A rename is *given* its answer: the new name is supplied, every site that read the old one is
mechanically determined, and the rewrite invents nothing.

Extraction is given none of that, which is where this rule stops. Which of a Segment's outside
References should become parameters, what each is called, and what it carries are decisions the
document does not hold, so extraction moves the Steps and leaves the contract to the author
(ADR-0018). It is this rule's **boundary** and not an instance of it: Hatua repairs what it can
derive, and refuses to invent what it cannot.

## What the surviving half of the rule forbids

Hatua touches a **Template** only as part of one gesture the user made and can undo in one step.

No repair pass when a document is opened, no rewriting a **Reference** the user did not ask about,
nothing in the background. A **Workflow Definition** lives in the **Host**'s repository and may be
hand-written (ADR-0001); an edit the user cannot point at is a diff they cannot explain.

## Rewriting is by span, and declines rather than guesses

ADR-0008 gives the expression grammar two generators and no AST→text. So a rewrite never reconstructs
an expression from its tree: it copies the source through and swaps out stretches it has checked
character for character, which is the discipline `expressionChip` already follows to draw a
**Reference** as a pill.

`renamePath` lives in `@hatua/expressions` because it needs the grammar and the node offsets and
nothing else — no document, no **Board**, no projection. That last one is load-bearing: an
`EditCommand` must work on a document that does **not** project (ADR-0019 is about what a command may
produce, not what it may assume), so every "where are the Templates" answer in `@hatua/model` is
unavailable to it. `@hatua/services` walks the YAML AST and decides *which* scalars are in scope;
`@hatua/expressions` decides what a path is. Three rename commands need it and none of them owns
the grammar, so building it beside any one of them would mean building it three times.

The walk is over `Name` and `Member` nodes, not over whole Templates. `{{ var.x + 1 }}` is not a
**Reference** — `isReference` is false — and it names the variable exactly as much as `{{ var.x }}`
does. A rewrite keyed on whether the Template *is* a Reference would miss every computed hole.

**Where the source and the tree disagree, that occurrence is left alone.** `{{ var . digest_to }}`
parses, but the characters at the node's offset are not the path the tree reports, and there is no
way to know which stretch to replace without writing text the grammar cannot produce.

Partial rewriting is safe here in a way it usually is not, because it is **strictly better than the
behaviour it replaces in every case and worse in none**: today no occurrence is repaired and all of
them go stale and are reported; now most are repaired and the few that cannot be verified go stale
and are reported by the same diagnostic. A left-behind occurrence can only be *broken*, never
silently wrong — the rename refuses a key that is taken, and the old key is gone once it lands, so
the stale path names nothing and raises. Renaming `a` to `b` and later `b` back to `a` is the one
sequence that could make a missed occurrence resolve again, and it is not worth designing against.

## Scope is the model's, not the mechanism's

A name means something because of where it sits, so each rename rewrites a different reach.

| Rename | What is rewritten | Confined to |
| --- | --- | --- |
| **Variable** key | `{{ var.<key> }}` | that **Board** only — a Board's variables are its own, so a **Block** with its own `var.x` is untouched |
| **Block** `params` key | `{{ params.<k> }}`, and the `with:` **key** at every call site | inside that Block, and each call site |
| **Block** `outputs` key | `{{ steps.<call id>.<k> }}` | the Board each call sits on, per calling **Step** |
| **Block** slug | `use: block.<slug>` | anywhere — `block.` is not an expression root (ADR-0014) |

A parameter's key at a call site is a **mapping key**, not a **Reference**, so that half is a
structural edit and not a substitution. Finding the call sites is an AST walk for `steps:` entries
whose `use:` is `block.<slug>`, because `callSitesOf` takes a projection a command may not have.

## What this opens

`renameStep` and `renameTrigger` do not exist, and the reason they were unattractive was that a Step
id rename breaks every `{{ steps.<id>.… }}` that named it. This removes that objection. Neither is
decided here.
