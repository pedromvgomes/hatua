# A command may not break the projection

An `EditCommand` that turns a **Workflow Definition** which projects into one that does not is
refused, and the document is put back. `EditingStore.apply` enforces it for every command there is
and every command written later.

## Holding an invalid document and making one are different things

ADR-0001 makes the *text* the source of truth: a **Workflow Definition** lives in the **Host**'s
repository, may be hand-written, and Hatua must open it, hold it and give it back intact whether or
not it satisfies the schema. `EditingState` carries `definition: null` and `invalid` for exactly
that, and every region has a screen for it — *this document is not a valid Workflow Definition yet,
your text is intact*.

That is about a document Hatua **inherited**. It says nothing about one Hatua **produced**, and the
two were being treated as the same state.

They are not. An inherited invalid document is the user's file being wrong, and the user knows why —
they wrote it, in text, and they have the text in front of them. A manufactured one arrives with no
warning, from a gesture that looked ordinary.

## What it cost

Renaming a variable to `Variable 1` — a space, which `identifier` refuses.

Every surface reads `definition`. So one committed keystroke emptied the canvas, the side panel and
the step editor **together**, and what remained on screen was
`Invalid string: must match pattern /^[A-Za-z_][A-Za-z0-9_]*$/` — a regex, to an end user, which
`.agents/rules/rendered-copy-is-written-for-the-hosts-users.md` refuses outright. There is no Text
Mode yet, so there was nothing left to click on to get back: the undo control lives in a top bar that
is still a placeholder, and the panel that would offer one had gone with everything else.

Nothing was lost — the text was intact and autosave had not run — but the product was unusable until
the page was reloaded.

## Two layers, because a refusal has to be able to say something

**Every command that writes a user-chosen name checks it**, against `@hatua/schema`'s `identifier`
rather than a regex written again: `renameVariable`, `addVariable`, `renameDeclaration`,
`addDeclaration`, `renameBlock`, `addBlock`. A named refusal is one a field can report, and
`isUsableName` is exported so the field asks the same question the command will, from the same
definition.

**`apply` refuses the outcome generically.** That is the backstop: a command nobody has written yet,
or a **Host**'s own `EditCommand`, cannot take the product down. It is the same mechanism that
already restores the document when a command throws, and it costs one `validate()` on a document that
projected — the projection before is read off the last published snapshot rather than computed twice.

Only a document that *projected* is protected. One that did not is the inherited case above, and
refusing every edit to it would leave nothing able to fix it, which is the opposite of what ADR-0001
asks for.

## What is not refused

**Diagnostics.** A stale `{{ var.old_name }}`, a removed **Trigger** something still reads, a
required field left empty, a `use:` naming a **Block** that was renamed — all of these keep the
document projecting and are reported by the checker. They block **Publish** and never editing
(ADR-0009), and several of them are deliberate: `renameVariable` and `renameBlock` leave their
References stale on purpose.

The line is not "the document is correct". It is "the document still parses into the shape every
reader expects", which is the difference between a workflow with a problem in it and no workflow at
all.
