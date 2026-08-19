# Hatua owns versioning; Hosts own storage

A **Workflow Execution** references the **Workflow Definition** version it ran against, so versions
have to exist, be immutable, and be retrievable long after they stop being live. The question was
who implements that. We decided Hatua does: `version:` and `status:` live in the definition YAML,
and the **Host** supplies a store that persists bytes and enforces one check.

Pushing versioning outward looked cleaner — it keeps Hatua's schema smaller and lets a Host use git
SHAs or database revisions. It was the wrong call. Every Host would reinvent the semantics and get
them subtly different (some overwrite, some append, some never archive), so Hatua could rely on
nothing, which kills every feature worth having version history for: diffing two versions, restoring
one, showing what changed between runs. `save these bytes under this key` is a contract any Host
implements correctly in an afternoon; `implement versioning semantics` is one most get wrong.

The objection that a `version:` key violates "we don't own the file" does not hold. Hatua does not
own the file's *formatting or lifecycle*; it does own the definition's **schema** — `id`, `name`,
`steps` are all Hatua's fields, and `version` is no different.

## The lifecycle

A **Draft** is a real version file at `base + 1` with `status: draft`, not an unnumbered slot. There
is at most one, because two drafts guarantee the second **Publish** fails, forcing either a merge or
the loss of someone's work. Discarding a draft frees its number — a number only becomes permanent at
publish, which is also when the outgoing published version is automatically archived.

## Consequences

- **Conflict is detected at publish, never at save.** Saving writes to a draft nothing else can be
  writing to, so it cannot collide. Only publish can.
- **Editing autosaves.** There is no Save button; the user decides only Publish, Release and
  Discard.
- **The store mints the edit token.** Exclusivity is only enforceable by whoever issues the
  credential — a Hatua-generated token would let two clients pick different ones with the store
  unable to tell which holds the claim. A rejected write halts autosave and keeps the in-memory
  document rather than retrying or discarding.
- **`openDraft` is atomic.** Splitting create from resume would race: between checking whether a
  draft exists and claiming it, another user can create one.
- **A Host-side lease is required.** A browser can always vanish — closed laptop, crashed tab — and
  exclusivity that depends solely on a client calling home eventually wedges a workflow nobody can
  edit.
