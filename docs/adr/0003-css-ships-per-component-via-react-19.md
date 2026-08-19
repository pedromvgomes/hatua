# CSS ships per component via React 19, not as a stylesheet the host imports

Every comparable embeddable React library requires the host to import a stylesheet — React Flow
(`@xyflow/react/dist/style.css`), tldraw (`tldraw/tldraw.css`), Excalidraw, Mantine, BlockNote.
Hatua deliberately does not. Each component renders its own `<style href precedence>`; React 19
hoists it to `<head>`, de-duplicates by `href`, and emits it during SSR. The provider renders one
base stylesheet holding the tokens, the oklch derivation and the cascade layer. **A host imports
nothing** — it writes `<Hatua />`.

## Why deviate from the ecosystem

The convention is largely path dependence, not a considered rejection of the React 19 approach.
Of the five libraries above, four still declare React 17 or 18 in `peerDependencies` and therefore
*cannot* use `<style href precedence>` at all. The fifth, Mantine, is React 19-only but inherited its
`styles.css` contract from earlier versions, and changing it would break every consumer. Hatua is
greenfield and targets React 19 exclusively, so none of that applies.

The performance objection does not survive scrutiny either. Comparable stylesheets are 3–23 KB
gzipped and Hatua's will be at the small end; a library's CSS and JS version together, so separate-
file caching granularity buys nothing; with SSR the style arrives in the document `<head>` *earlier*
than a linked stylesheet would; and with CSR nothing paints before the JS executes anyway.

Per-component delivery also buys something no stylesheet can: **only the components a host actually
renders ship their CSS.** Since `@hatua/react` exports its parts individually, a host embedding just
`<FlowMap />` does not pay for the Runs view.

The parts are **individual named exports, never properties of `Hatua`.** An earlier draft of this
ADR wrote the example as `<Hatua.Canvas />`, which reads well and cannot work: reaching a static
property means evaluating the function it hangs off, so `import { Hatua }` would pull the whole
designer into a bundle that wanted one region and the saving this paragraph claims would be
unmeasurable. `apps/playground/src/host.tsx` is the measurement, and it imports neither `Hatua` nor
`Build`.

## Consequences

- **Hatua requires React 19+.** Hosts on React 18 cannot embed it. This is the genuinely hard-to-
  reverse part of the decision.
- Styles are authored as colocated CSS Modules. The build must emit, per module, both the class-name
  map and the CSS text — a small plugin if Vite's `?inline` does not return hashed module output.
- CSS Modules hashes every class name, so two components' rules cannot collide and ordering between
  component styles is a non-issue. Only the base layer must come first.
- The base stylesheet is wrapped in `@layer hatua`, so a host's unlayered CSS wins regardless of
  order — the problem React Flow documents for Tailwind users and Mantine solves with
  `styles.layer.css`.
- Per React's documented caveats, the stylesheets must be static (props are ignored after render) and
  may remain in the DOM after unmount.
- A plain-stylesheet escape hatch (`@hatua/react/styles.css`) is **deferred**, not shipped. A
  meaningful one has to aggregate every component's CSS, and the lib build inlines that CSS into
  the JS by design — so exporting the path today would resolve to a file the build never emits.
  Add it, with a build step that aggregates, once there are components to aggregate. Until then the
  React 19 path is the only path, which is consistent with requiring React 19 anyway.
