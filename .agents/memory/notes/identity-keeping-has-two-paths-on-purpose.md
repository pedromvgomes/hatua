---
name: identity-keeping-has-two-paths-on-purpose
kind: invariant
description: alignIdentity (setText) and replaceContent (restoreVersion) must not be unified — only the compare-first one preserves typed bytes.
anchors:
  - path: source/packages/services/src/workflow.ts
    blob: e2e56df8eef0
  - path: source/packages/services/src/editing.ts
    blob: 4516ccc49bc5
confidence: verified
---

Two paths keep the Draft's `IDENTITY` keys (`id`/`version`/`status`, `workflow.ts:245`)
against an incoming document, and the difference between them is load-bearing:

- `alignIdentity` (`workflow.ts:299`) compares each key and writes only when it differs
  (`if (readAt(incoming, [key]) === wanted) continue`). Used by `EditingStore.setText()`
  (`editing.ts:1284`, call at `editing.ts:1340`).
- `replaceContent` (`workflow.ts:314`) unconditionally splices `ast.contents`/`comment`/
  `commentBefore` from the incoming document, then writes the three keys back. Used by
  `restoreContent` (`workflow.ts:349`) and so by `restoreVersion()` (`editing.ts:1716`,
  apply at `editing.ts:1786`).

`@hatua/document` only stringifies byte-identically while a document is *untouched* — one
write anywhere costs the file its comment alignment, blank lines and flow style
(`alignIdentity`'s docstring, `workflow.ts:282-298`). `setText` runs on every quiet autosave
period while the author is looking at the text they typed, so routing it through
`replaceContent`'s always-splice would re-serialise the file under the author on every
autosave. `restoreVersion` is right to always splice — it is importing another version's
bytes wholesale.

The hazard: a cleanup that notices both functions "keep identity" and unifies them onto one
helper. Neither function's own docstring warns about the other. Unifying on the splice
version is a functional regression in Text Mode; unifying on the compare version silently
stops `restoreVersion` from replacing content.
