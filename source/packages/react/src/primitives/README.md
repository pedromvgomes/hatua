# primitives

No domain knowledge. Button, Input, Select, Toggle, Toast, ConfirmDialog.

**Rule:** may not import any `@hatua/*` package or any higher tier. Enforced by
`noRestrictedImports` in the workspace `biome.json`. If a primitive seems to need
domain knowledge, the component is wrong, not the rule — the thing being reached
for belongs in `compounds/`.

**Styling.** Each component owns a colocated CSS Module and renders it itself
through React 19's `<style href precedence>` (ADR-0003). It is imported twice:
bare for the class-name map, and with `?inline` for the text the component
renders. Nothing imports a stylesheet, here or anywhere.

Every colour comes from a semantic alias defined in `../styles/base.css` —
`--hatua-surface-card`, `--hatua-text-muted`, `--hatua-border-subtle` — never from a `--hatua-*`
seed and never from a literal. That is ADR-0002's rule, and
`../styles/tokens.test.ts` is the lint that holds it up.

**Overlays** (`Toast`, `ConfirmDialog`) portal into the container
`usePortalContainer()` returns, which lives inside the provider's subtree.
`document.body` is outside the element carrying the custom properties, so an
overlay mounted there renders unthemed.
