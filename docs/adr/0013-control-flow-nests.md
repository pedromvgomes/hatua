# Control flow nests, and jumps are deferred

A **Step** may be reached from more than one place — three branches of a **Fork** that all end by
notifying the same person, a review that repeats until a human approves it. Every graphical workflow
builder answers this with edges: a user drags from one node's exit to another's entry, and
reachability becomes an arbitrary graph.

Hatua does not. **Reachability is nesting**: a Step runs because of where it sits in the tree, and the
only things that change control flow are *containers* — `core.fork`, `core.for_each`, `core.repeat`,
`core.call` and `core.try`. There is no edge to draw, so the canvas offers no connect affordance, no
exit handles and no drawn connectors the user can attach anything to.

## Why, and why not the reason ADR-0001 originally gave

ADR-0001 said arbitrary cross-links "would break this property", meaning derived layout. **That
reasoning is wrong and is corrected there.** AWS Step Functions is a hand-editable file with `Next:`
transitions, no stored positions, and a console that derives the picture; GitHub Actions does the
same with `needs:`. A graph does not force a file to carry coordinates.

The real cost is **exact static scope**, which is Hatua's and not those tools'.

`scopeFor` answers "what can this Step read?" by walking its ancestors. In a tree, in-scope *is* the
path from the root, and the answer is exact — which is what lets the picker offer a list that is
complete, the completion list rank against it, the reference tree group by it, and the type marking
say *this fits* before anything runs. Converge two branches on one Step and the question stops having
a static answer: that Step can safely read only what **every** inbound path produces, so scope becomes
an intersection over paths — a dataflow analysis rather than a walk, and one that degrades from
*exact* to *conservative*. n8n can allow edges because it never promised to tell you, before you run
it, that `{{s3.subject}}` exists.

The second cost is that **Hatua does not execute**. Structured containers are a contract any Host
runner and the Go SDK implement locally. Arbitrary transfer *into* a branch or *out of* a loop is a
control-flow semantics we would be imposing on every Host, in exchange for a shape the tree can
already express.

Because a tree with duplication expresses every reachability shape a DAG can — inline the shared tail
into each path — what edges actually buy is **deduplication, not expressiveness**. That is a real cost
and it is paid deliberately, and `core.call` pays most of it back.

## A call is a cross-link with a contract; a jump is one without

This is the whole distinction, and it is why `blocks:` is not a back door to the thing this ADR
refuses.

A **Block** is a named, reusable sequence declared once in the document and invoked with `core.call`.
It is reachable from three call sites and scope stays an exact walk, **because a Block reads only its
declared parameters and publishes only its declared outputs**. The contract is what replaces the
analysis. A jump target is reachable from three places with no contract at all, so there is nothing to
compute scope from except the intersection.

The same reasoning admits a further consequence: **early exit is safe.** A jump that only ever goes to
the *end* — a future `core.stop` or `core.fail` — adds no inbound path to any Step, so scope is
untouched. It is **joins** that break static scope, not jumps.

## Blocks are also the flattening tool

Deduplication is the obvious use and the smaller one. A workflow with a session loop around a
per-entry loop around a revision loop around a decision is four levels deep and hard to read on a
canvas; extracting the middle into a Block leaves a root of three lines, exactly as extracting a
function does. A jump would not flatten it — it would make a loop *look* flat while remaining as
cyclic, so a reader has to simulate execution to find what repeats and where it stops. Nesting is what
makes the boundary visible without running anything, and collapse already handles depth as chrome.

## The verbs

`core.fork`, `core.for_each` and `data.map` already exist. This decision adds three, keeping the set
small enough for a Host runner to implement. Named and given a role here because the refusal above is
meaningless without saying what carries the weight instead; each one's **shape is settled by the PR
that gives it a reader**, and amends this ADR when it does.

- **`core.repeat`** — repeats its children until a condition holds. The gap `core.for_each` leaves:
  it iterates a collection, and nothing repeated on a condition. This is what "send it back for
  another revision" is, and what "ask whether to process another batch" is — the target of both is
  the head of an enclosing container, which is why neither needs a jump.
- **`core.call`** — invokes a **Block** by name, taking declared parameters and publishing declared
  outputs. Blocks may call blocks; recursion is refused, because unbounded recursion is the jump
  problem wearing a contract's clothes.
- **`core.try`** — a region with a retry policy and a fallback handler. **Wrapping one Step is retry;
  wrapping a region is fallback**, so one verb serves both. Error-type matching needs no matcher of
  its own: a `core.fork` inside the handler branches on the failure.

`core.try` exposes the failure to its **handler** children and not to its body, the way
`core.for_each` exposes `item` — a container putting a binding into the scope of children it owns,
which the Fork's per-branch scoping already establishes.

The names are `core.*` because these are control flow. `error.handler` was the first draft and reads
like a Host namespace, which is the confusion the `core.` prefix exists to prevent.

## Loop state is a workflow variable

A repeated region usually has to carry something backwards — the reviewer's feedback reaching the
draft step that runs before it. Nothing positional can do that: the writer runs after the reader, so
it is not in scope. **`data.set_var` is the mechanism**, because `vars` are workflow-scoped and
readable anywhere regardless of where they were written.

The alternative was iteration state declared on `core.repeat` itself, initialised and advanced by the
container, typed, and reset structurally on re-entry. It was rejected for costing a second concept
where one already works.

The cost is real and is documented rather than designed away: **a var written inside a loop survives
into the next iteration of an enclosing loop**, so a workflow that must start each pass clean resets
it explicitly. Nothing type-checks that reset.

## Deferred, not refused

A jump is **not built**, and the condition that reopens this is written down rather than left to
taste: *a jump whose target is not the head of any enclosing container*. Neither of us could name one
— revising a draft, and asking whether to fetch more, both resolve to `core.repeat` — but neither of
us proved none exists.

Deferring costs little, which is why it is a deferral and not a wall. A jump verb is **additive**: a
`core.goto` with a `target:` is a new `use` like any other, needing no migration of existing
documents. It does not disturb layout either, provided it renders as a terminal chip with a
jump-to-target affordance rather than a drawn edge — the tree walk stays correct.

The one thing that does not come back is **the promise of exact static scope**. Once the picker and
the type marking say "these are the values you can read here, and this one fits", weakening that to
"unless a jump reaches this Step" is a user-visible regression. But that price is identical whenever
it is paid — it does not compound by waiting, and waiting buys real jump cases to design against
instead of a guessed shape. What does get harder is the runner contract: Hosts shipping against
structured control flow would need a version bump to accept transfer.
