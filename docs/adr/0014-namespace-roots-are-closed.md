# Namespace roots are closed

Two namespaces in Hatua were open at the root: an **Expression**'s paths, where a **Step** id sat
beside `triggers` and `var`, and a **Component**'s verb, where `email.send` sat beside `core.fork`.
Both are now closed. Every path begins with one of six roots, every verb begins with one of three,
and **a name a user chooses always sits one segment below a root** — so it can collide with nothing.

```
run.*        the Host's Run Context           core.*       Hatua ships it
triggers.*   the root Board's contract        block.*      this document declares it
params.*     a Block Board's contract         component.*  the Host declares it
steps.*      this Board's Steps
var.*        this Board's variables
TRIGGER      which Trigger fired
```

## The problem an open root has

An open root means every structural idea Hatua adds is a name taken away from users. `core.for_each`
exposing `item`, a **Block** needing somewhere to put its parameters, a future verb needing anything
at all — each one either steals a bare word or is refused for lack of one. The cost is invisible when
the set is small and unpayable later, because the word was already legal and documents already use
it.

ADR-0010 made exactly this argument for functions and stopped one level short: *"Namespacing also
removes the need for reserved words… `crm` is a perfectly good step id right up until someone writes
`crm(`."* That is right, and it is right for the same reason one level up. A namespace is what lets
a contract grow without a reserved-word list growing with it.

ADR-0012 hit the wall from the other side and recorded it as a consequence: `run` *"is a root of its
own in the evaluator… Not a reserved step id: a step may legitimately be called `run`, and resolving
one root by looking in two places is how a workflow starts depending on which of them the runner
checked first."* Under an open root that promise costs a special case in every resolver. Under a
closed one it is free — `steps.run` and `run.id` cannot be confused, because they are not in the same
place.

## The root says who declares it

This is the whole rule, and it is why the verb roots are what they are rather than a longer list of
vendors.

- `core.*` — **Hatua ships it.** Not "it is control flow": `core.schedule`, `core.manual` and
  `core.end` were never control flow, and describing the root by the subset one decision happened to
  add is how a rule acquires an exception it did not need. `data.map` becomes **`core.map`**, which
  costs the `data.` grouping and buys a root that means one thing.
- `block.*` — **this document declares it.** A **Block** is invoked as `use: block.<slug>`, resolved
  against `blocks:` rather than against the manifest set.
- `component.*` — **the Host declares it.** `email.send` becomes `component.email.send`, and the
  Host's own namespacing continues below the root, untouched and unconstrained.

The reader gains something the old spelling could not give: **where a verb comes from is visible
without knowing the manifest set.** Under a flat namespace, `email.send` and `core.fork` look alike
and behave differently, and telling them apart means already knowing which one Hatua ships.

## Why the Host's verbs are prefixed too, which is the expensive half

Reserving `core.` and `block.` alone would have been two words and almost free. It was refused
because it leaves the namespace open — the exact state this decision exists to end — and because the
collision is not hypothetical: `block` is an ordinary domain word, and a Host with content blocks
ships `block.render` on its first day.

The price is paid in full and stated plainly: **`component.email.send` is longer than `email.send`,
on every card, in every file, forever.** It buys a language in which Hatua reserves no bare word at
all, so no component a Host will ever declare can be refused because Hatua got to the name first.

## `TRIGGER` is the one bare token, and the closure is what permits it

Nothing else sits at the root, so `TRIGGER` cannot be shadowed by anything a user names. It was safe
by convention before — nobody writes a Step id in screaming case — and closing the namespace makes it
safe by construction, without moving.

Both alternatives re-open a collision this decision just shut. `triggers.FIRED` puts it under a root
whose second segment is a user-chosen **Trigger** id, so a Trigger called `FIRED` collides.
`run.trigger` reads well but every other `run.` key is declared by the Host's context manifest, so a
Host declaring `trigger` collides — and that one would be Hatua declaring a key in the Host's
namespace, which is the arrangement `run.` exists to avoid.

## Consequences

- **Every existing document, fixture and manifest is rewritten.** `{{s2.count}}` becomes
  `{{steps.s2.count}}`; `use: email.send` becomes `use: component.email.send`. There is no fallback
  spelling, no deprecation window and no version bump: Hatua is unreleased, no Host has a document on
  disk, and accepting both spellings would put a second definition of every root into the language on
  the day it was closed.
- **The expression language itself is unchanged.** Scope reaches `@hatua/expressions` as
  `ScopeEntry[]`, and `validate.ts` already resolves dotted paths generically by prefix — that is how
  `triggers.nightly` has always been "one entry, not two". Closing the roots changes what `scopeFor`
  writes into `path` and nothing about the parser, the resolver or the checker.
- **A Step may be called anything.** `run`, `var`, `triggers`, `params` and `block` are all legal
  Step ids, because a Step id is never at a root. This is ADR-0010's promise about `crm`, extended to
  every word in the language.
- **`unknownComponents` splits by root.** *"Nothing declares this. It may no longer be available."*
  is the right sentence for a `component.*` verb the Host has dropped and the wrong one for a
  `block.*` name three lines further down the same file, so the two get separate codes and separate
  messages.
- **A Host cannot collide with Hatua, in either direction.** `component.core.queue` and
  `component.block.render` are ordinary verbs. Nothing needs reserving below a root, which is
  ADR-0010's sentence about functions holding one level up.
