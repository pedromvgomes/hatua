# Comments describe the code, not its history

A comment explains what the code does and why it is shaped that way. It is read by
someone looking at the code as it is now, who has no idea what it looked like
before and no reason to care.

Never narrate the change you are making. The commit message, the PR description and
`git log` are where a change is explained; a comment that describes one is stale the
moment the next change lands, and it costs every future reader a paragraph about a
version of the file they will never see.

## Never write

- **PR or ticket numbers** — `(PR 4)`, `retired in PR 2 and is back`, `TICKET-113 fixed this`
- **"used to" / "previously" / "no longer"** — `this used to be a loose record`,
  `the resolve path previously published whatever arrived`
- **"Regression:" preambles** — `// Regression: pivot ignored descriptors entirely`
- **Roadmap and lifecycle** — `the editing store arrives later`, `waited for a reader`,
  `has promised since it was written`, `this is new`, `for now`, `will be replaced by`
- **Corrections addressed to a past author** — `An earlier version of this table said…`,
  `which is what this used to say`, `both halves were wrong`
- **Change bookkeeping** — `Added`, `Updated`, `Moved from X`, `Renamed`

## Instead

State the rule, the invariant, or the failure mode — in the present tense, as a
property of the code.

```ts
// ✗ Regression: toString() previously keyed off a `dirty` flag nothing ever set,
//   so it always replayed the CST and silently discarded every AST edit.

// ✓ toString() detects edits by comparing serialisations, not by a `dirty` flag a
//   caller has to remember to set. A flag nobody sets means the CST is replayed
//   and every AST edit is silently discarded.
```

```ts
// ✗ A container's <li> wraps its children's, so the keydown bubbled and this
//   handler ran again at every enclosing level — one keypress moved two Steps.

// ✓ A container's <li> wraps its children's, so without stopPropagation the
//   keydown bubbles and this handler runs again at every enclosing level: one
//   keypress moves two Steps.
```

The test is simple: **could a reader who has never seen an earlier version of this
file act on the comment?** If it only makes sense as a diff against something that is
no longer here, rewrite it.

## The one thing worth keeping

The *failure mode* a guard exists to prevent is valuable and belongs in the comment —
that is why the guard is there. Keep the mechanics, drop the history. "Without this,
X happens" is a property of the code. "This used to do X" is a changelog entry.

The same applies to test names and test comments: a test says what behaviour it
protects, not which bug prompted it.

## Applies to

Every comment and docstring in the repository — `.ts`, `.tsx`, `.css`, `.md`, `.yaml`
— including test files, Storybook stories, fixtures, ADRs and READMEs.

ADRs are the one partial exception: an ADR records a decision and may state the
alternative that was rejected and why, because that *is* the decision's content. It
still does not narrate which PR changed what.
