# Text Mode writes the whole document, and the projection backstop does not apply

[ADR-0001](0001-yaml-document-is-the-source-of-truth.md) says a user edits one **Workflow
Definition** two ways — graphically on the flow map, and as raw YAML text — and that the text is the
source of truth. The second way has never existed. `editing.ts` carries `text` on the snapshot, holds
a document that does not project, and reports `invalid` rather than refusing to open; all of it was
built for a text editor that was not there.

We decided **Text Mode** is a whole-screen view, that a text edit is one command over the whole
document, and that [ADR-0019](0019-a-command-may-not-break-the-projection.md)'s backstop does not
stand in its way.

## Why the whole screen

A text edit is an edit to the same document the canvas edits, so putting the editor in the middle
column beside the catalogue and the step editor is the arrangement that reads as most consistent. It
is wrong for the state this screen exists for.

A document that is not a **Workflow Definition** yet empties the side panel, the canvas and the step
editor at once — every one of them reads `definition`, and `definition` is null. Text Mode is the
only surface with anything to say, and in the arrangement above it would say it in a box between two
blank columns. The same argument answers the side panel: [ADR-0011](0011-version-navigation-lives-in-the-top-bar.md)
already refused putting a whole-document control in a 304px column that scrolls.

So Text Mode is a peer of the designer and of **Runs**, reached from the same segmented control,
because all three are answers to *what is the whole screen showing*. Unlike **Runs** it is always
offered: the store always has text, including when it has nothing else.

## Why the backstop does not apply

ADR-0019 refuses a command that turns a document that projects into one that does not, and its
reasoning is about what the user is left holding: "every surface in the product reads `definition`,
so a single command that breaks the projection empties the canvas, the side panel and the step editor
at once, and the user is left with nothing to click on to undo it."

In Text Mode that premise is false in both halves. The surface the user is looking at reads `text`,
not `definition`, so it does not empty — and what broke the projection is under their caret, so the
fix is the same keystrokes that caused it. Refusing here would make the one screen that exists to
repair a broken document the one screen that cannot save the repair, which contradicts ADR-0001
outright: a document that does not project is a legitimate state, and the file is the user's.

The alternative was a flag on `apply()` — `{ mayBreakProjection: true }`. It was rejected because the
backstop's value is that it is unconditional: a flag is a thing every command written later can reach
for, and a guard that can be waived at the call site is advice rather than a floor. So the exemption
is a path of its own — `setText`, which is the only thing that has it — and `apply()` is untouched.

`setText` refuses what `parseWorkflow` refuses, and nothing else. YAML that is not YAML, or two
documents in one file, cannot be held at all: every command reaches through the AST and there would
be no AST. That refusal leaves the document exactly as it was.

## What a text edit may not change

`restoreContent` already writes a whole document into the **Draft** while keeping `id`, `version` and
`status` — the keys that say *which* document this is rather than what is in it. A text edit takes
the same shape and keeps the same three, so the two share one command and `restoreContent` is that
command with a **Restore**'s label on it.

Keeping them is not a restriction on what a user may type so much as a statement of what the
**Draft** is. ADR-0005 puts `version:` and `status:` in the YAML and makes them Hatua's; the bar
renders them as the readout; and `publish()` sends the document's own bytes, so a text edit that
renumbered the draft would promote a version claiming to be an older, already-published one. `id` is
how the **Host** addresses the workflow, and a document that names a different one is a workflow
served in error.

## Consequences

- **What is typed becomes the document after a quiet period, not per keystroke.** There is no Save
  button (ADR-0005) and the timing is autosave's own: a commit per character is an undo entry per
  character, and half-typed YAML is unparseable most of the time, so most of them would be refusals.
- **Text that will not parse stays in the box.** The document does not move, the editor keeps what
  was typed and says why it has not been taken. Leaving Text Mode with such text asks first, because
  nothing else on screen could ever show it again.
- **The editor follows the document when the document moves for another reason.** An undo, a
  **Restore**, a **Preview** entered from the bar — each republishes `text`, and the box adopts it
  unless it is holding an edit of its own that has not been committed yet.
- **Read-only is the hook's answer, not the editor's.** `useReadOnly()` already says no during a
  **Preview** and after a session has ended, and both make the text uneditable here. It stays
  *readable*, which is the point: the handoff's open question — "a halt the claim cannot resume has
  no escape", where the in-memory document is intact and saved nowhere — is answered by being able to
  select the text and take it away.
- **No dirty flag.** Whether the document has moved is `toString()` against what the Host last
  accepted, which is how the store already asks. A flag a caller has to remember to set is the
  anti-pattern this repository names by example.
