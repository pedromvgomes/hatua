# public/icons

Artwork for the Component Manifests in `conformance/manifest/catalogue.yaml`,
whose `icon` fields are root-relative URLs pointing here.

**One file per component.** An icon shared between components says they are the
same kind of thing, and a card carries its icon, its name and its verb — so a
row of cards all wearing one glyph makes the icon the only part of the card that
is not telling the reader anything. The catalogue's verbs each get their own:
a split for `core.fork`, a loop for `core.for_each`, a shield for `core.try`,
an exit for `core.return`.

These belong to the Host, not to Hatua. `@hatua/react` ships no icon set and
never will: a name is only meaningful against a set, and a Host adding a
component of its own would have nothing to name. It renders whatever URL the
manifest gives it, into a fixed square box.

Which is also why the stroke colour is baked into each file rather than
inherited. An `<img>` cannot take `currentColor`, so a Host serving icons owns
whether they read on both a light and a dark surface — these use a mid slate
that works on either. A Host with strong brand icons would more likely serve two
files and pick between them, which is a change to the manifest it publishes and
to nothing in Hatua.

## Not linted

`biome.json` excludes `apps/playground/public` from its file set — this
directory by name, not every `public/` in the repo, so a future source directory
that happens to be called `public` is not dropped from linting in silence. Biome lints a standalone
`.svg` with its JSX accessibility rules and asks for a `<title>` — but an icon
here is fetched through `<img alt="">`, where the accessible name belongs on the
`<img>` and a title inside the file would only produce a tooltip. These are
assets a server copies verbatim, not source.
