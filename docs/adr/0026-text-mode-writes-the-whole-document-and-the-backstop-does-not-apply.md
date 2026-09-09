# Text Mode writes the whole document, and the projection backstop does not apply

[ADR-0001](0001-yaml-document-is-the-source-of-truth.md) says a user edits one **Workflow
Definition** two ways — graphically on the flow map, and as raw YAML text — and that the text is the
source of truth. The second way has never existed. `editing.ts` carries `text` on the snapshot, holds
a document that does not project, and reports `invalid` rather than refusing to open; all of it was
built for a text editor that was not there.

We decided **Text Mode** is a whole-screen view, that a text edit is one command over the whole
document, and that [ADR-0019](0019-a-command-may-not-break-the-projection.md)'s backstop does not
stand in its way.

## Why it is a toggle on the column, and not a view

The map and the text are **two ways of editing one document**. ADR-0001 opens with
exactly that, and CONTEXT.md defines **Canvas Mode** and **Text Mode** as editing
the same **Workflow Definition**. **Runs** is not a way of editing anything: it
puts a *different document* on screen.

So there are two questions, not one — *which document* and *how it is drawn* — and
a single control offering Build, Text and Runs says they are the same kind of
choice. The toolbar keeps `Build | Runs`, which is what
[ADR-0011](0011-version-navigation-lives-in-the-top-bar.md) says its segmented
control is for, and how a column draws what it already has belongs to the column.

Putting the control there is also what makes *the document did not change* visible
rather than a rule to remember: it is inside the thing showing the document. And
it falls out that a **Preview** — a version chosen from the list, or the version a
run ran against — can be read as text without any rule about what a view switch
does to it, because switching representation was never a question about which
document is up.

**One button, not two segments.** One label in both states with `aria-pressed`
saying which one it is in, which is the call the **References** control already
makes: a control that swaps its verb *and* reports pressed announces the state
twice.

## Why the columns beside it go

Pressing it takes the side panel and the step editor with it, and the reason is
not width.

**Every one of them writes to the document the text box is holding.** The
catalogue applies `addStep`, the **Workflow** tab edits the name, the Triggers and
the variables, the step editor writes a Step's fields. `<TextMode>` holds what is
typed until the quiet period and adopts any change that is not its own commit — so
one of those landing mid-edit replaces what the reader typed. Two writers on one
document, and the one being looked at loses.

Leaving them on screen but inert is not the answer either: a control that is live
and does nothing reads as a fault, which is the argument `CanvasControls` makes
about the ends of the zoom range.

There is a second reason that makes it read as intended rather than arbitrary:
they are **the map's tools**. A Component is chosen from the catalogue to put on
the canvas; the step editor edits the Step a canvas selection names. In Text Mode
their subject does not exist.

**In the Runs view they stay**, and the rule that decides it is *hide what cannot
act*. Nothing there writes: `RunList` picks which run, `RunStep` describes it, and
the text shows the version it ran against — three readers on one subject, and
reading a failed Step's record beside the YAML of the version that ran is what
that view is for.

## Why the document, not a box in a column

The state this screen exists for is a document that is not a **Workflow
Definition** yet — and there the side panel's **Workflow** tab and the step editor
have nothing to draw, because both read `definition`. Giving the text the room is
therefore not a concession to width; it is the same fact as the paragraph above,
seen from the other side. What the reader needs on that screen is the text and the
catalogue, and the catalogue is the one panel that would still work.

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
- **A text edit gives back the bytes that were typed.** The document becomes the source rather than
  the source being written into the document, so `toString()` returns what the reader wrote. Splicing
  parsed contents into the document already held discards the CST that makes `@hatua/document`'s
  round trip exact, and everything the serialiser has an opinion about comes back its way instead of
  the author's — flow style respaced, blank lines collapsed, a trailing newline supplied, a comment
  aligned by hand pulled back to one space. On a quiet 800ms timer, while they watch. That is
  ADR-0001's promise inverted, and it is worst here of all places, because in **Text Mode** the
  author IS the serialiser.
  `alignIdentity` writes `id`, `version` and `status` back **only where they differ**, because a
  single write anywhere costs the whole file its formatting — so the common case, editing a document
  that already carries them, touches nothing. A **Restore** still splices, and is right to: it
  carries another version's bytes into the document the **Draft** already is, and the reader did not
  type them.
- **No dirty flag.** Whether the document has moved is `toString()` against what the Host last
  accepted, which is how the store already asks. A flag a caller has to remember to set is the
  anti-pattern this repository names by example.
