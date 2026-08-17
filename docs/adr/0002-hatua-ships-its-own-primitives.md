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

- **Components may only reference semantic aliases** (`--surface-card`, `--text-muted`,
  `--border-subtle`), never base ramps (`--navy-500`, `--teal-600`). This is what makes theming work
  at all, and it is enforced by lint rather than left to discipline.
- Theming is **seed-and-derive**: a host supplies a handful of brand seeds and the ramps are generated
  in CSS via oklch relative colour syntax. Every derived step stays individually overridable.
- `createTheme()` is a pure function producing a serialisable object; Hatua's own control mounts the
  provider internally, so a host passes an optional `theme` prop and never mounts anything.
- **Theme and colour mode are separate.** A theme carries both alias sets; the mode is inherited from
  the host (ancestor `[data-theme]`, else `prefers-color-scheme`) with a prop to pin it.
- Overlays — the reference picker, toasts, `ConfirmDialog`, the run drawer — must portal into a
  container **inside** the provider's subtree. Portalling to `document.body` escapes the element
  carrying the custom properties and renders them unthemed.
