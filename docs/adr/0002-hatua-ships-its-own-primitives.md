# Hatua ships its own UI primitives, themed by tokens

The design handoff specifies building the workflow builder from the **Tumika** design system's
component library (Button, Input, Select, Toggle, Toast, ConfirmDialog, Card…). That instruction
assumes Hatua is a feature *inside* Tumika. Hatua is instead embeddable in any **Host**, and a
builder that requires the host to adopt Tumika's design system is not embeddable. So Hatua ships its
own primitives, styled exclusively through semantic CSS custom properties.

A host re-themes by supplying values, never by swapping components. Tumika embedding Hatua still gets
pixel-parity for free, because the two token sets are already identical (ink `#232d47`, accent
`oklch(0.63 0.115 195)`, Space Grotesk).

## Considered options

- **Peer-depend on the Tumika component library** — pixel-perfect inside Tumika with no rebuild, but
  couples Hatua to one host's design system.
- **Host injects the primitives** — maximum fidelity, but a host must supply ten-plus components
  before anything renders, and the two pieces that matter most (the map field and the flow map) have
  no design-system equivalent to inject anyway.

## Consequences

- **Every custom property Hatua names is `--hatua-*`.** Seeds are `--hatua-seed-*`; the semantic
  aliases derived from them are `--hatua-*`; even a component-local property (`Toast`'s
  `--hatua-toast-tone`) carries the prefix. This is enforced by the same test as the rule below.

  They were briefly unprefixed — `--surface-card`, `--text-muted` — because those are the Tumika
  design system's own names and matching them made the pixel-parity claim above literal. That was
  the wrong trade. Which handoff we were given is a coincidence; the next design system's names
  would not match, and a library embeddable in *any* Host cannot spend its collision budget on one
  of them.

  The exposure is narrower than it sounds, and real. Custom properties inherit downward only, so
  Hatua's names could never leak *out* of `.hatua-root` onto a Host's page. But in the parts
  embedding the Host mounts its **own** markup *inside* `<HatuaProvider>` — that is what the
  provider is for — and a Host wrapper in there reading `var(--accent)` for its own design system
  silently received Hatua's. A Host re-theming Hatua now writes `<Hatua theme={createTheme({…})} />`
  and its own tokens keep their own values, whatever they are called.

- **Components may only reference semantic aliases** (`--hatua-surface-card`, `--hatua-text-muted`,
  `--hatua-border-subtle`), never base ramps (`--navy-500`, `--teal-600`). This is what makes theming work
  at all, and it is enforced by lint rather than left to discipline. That lint is
  `source/packages/react/src/styles/tokens.test.ts`: Biome lints CSS but has no rule that can say
  "this custom property, not that one", so the check is a test over the authored CSS — no seeds, no
  colour literals, and no alias `base.css` does not define.
- Theming is **seed-and-derive**: a host supplies a handful of brand seeds and the ramps are generated
  in CSS via oklch relative colour syntax. Every derived step stays individually overridable.
- `createTheme()` is a pure function producing a serialisable object; Hatua's own control mounts the
  provider internally, so a host writing `<Hatua theme={…} />` passes a prop and mounts nothing.
  A host that instead composes the regions itself — the other of the two ways to embed — does mount
  `<HatuaProvider>`, because that is the element carrying the custom properties and the overlay
  container, and the regions read both and hold neither. It is the parts path's root, not a third
  way in: there is nothing to configure on it that `<Hatua>` would not configure identically.
- **Theme and colour mode are separate.** A theme carries both alias sets; the mode is inherited from
  the host (ancestor `[data-theme]`, else `prefers-color-scheme`) with a prop to pin it.
- Overlays — the reference picker, toasts, `ConfirmDialog`, the run drawer — must portal into a
  container **inside** the provider's subtree. Portalling to `document.body` escapes the element
  carrying the custom properties and renders them unthemed.
