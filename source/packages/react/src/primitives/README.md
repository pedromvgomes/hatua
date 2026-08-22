# primitives

No domain knowledge. Button, Input, Select, Toggle, Toast, ConfirmDialog, Tooltip.

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

**Placement.** `placement.ts` answers where a floating layer goes for the three
things that ask — the completion list, the picker and the tooltip. It flips when
there is less room below *and* more above rather than on a fixed threshold, and
it clamps sideways, because the anchor is usually a caret or a small button near
the edge of a 304px column. It deliberately does not cap a layer's height: it
reports the room that exists, and each caller decides how much of that is its
scrolling part.

**`revealOnOverflow`** on `Input` and `Select` offers the whole value through a
`Tooltip` when the box is showing less than it holds. Opt-in, because a tooltip
on every truncated string is noise nobody reads — turn it on where the value is
one someone has to be able to check.

`Tooltip` attaches to an element by ref rather than wrapping one: wrapping means
either a box in the middle of somebody's layout or `cloneElement` onto a
component whose props it cannot see, and every control here already holds a ref
for its own reasons. It opens on hover *and* focus, `Escape` dismisses it, and
the anchor carries `aria-describedby` whenever there is something to say — a
screen reader is the one reader for whom hover means nothing.

**Overlays** (`Toast`, `ConfirmDialog`, `Tooltip`) portal into the container
`usePortalContainer()` returns, which lives inside the provider's subtree.
`document.body` is outside the element carrying the custom properties, so an
overlay mounted there renders unthemed.
