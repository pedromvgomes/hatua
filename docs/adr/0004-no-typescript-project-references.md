# No TypeScript project references

A pnpm + turbo monorepo would conventionally reach for composite projects and a `references[]`
graph. We deliberately do not. Recording the rejection because the setup looks like an oversight
rather than a choice, and someone will propose adding them.

Project references buy three things, and in this workspace each is already covered:

- **Incremental builds** — turbo already caches per-package tasks across the graph. `tsc -b` would be
  a second build graph competing with it, and six small packages typecheck in seconds anyway.
- **An enforced dependency graph** — pnpm enforces this harder. `package.json` *is* the graph: an
  undeclared cross-package import fails to resolve at install time, not merely at typecheck. A
  `references[]` array would restate that by hand, where it can drift. The intra-package tier rules
  (primitives must not import services) are Biome's job either way; references do nothing for them.
- **Cross-package go-to-definition** — three lines of `paths` mapping `@hatua/*` to `packages/*/src`.

The costs are real: `composite: true` forces `declaration` and constrains `rootDir`, every tsconfig
grows a hand-maintained graph, and references resolve to built `.d.ts` in `outDir` — which fights the
resolve-to-source aliasing that lets the playground hot-reload without a build step.

The one genuine problem references solve well is that types must resolve to **source** in development
but **dist** once published. `publishConfig` addresses that directly: `exports` points at `src` in the
repo and pnpm rewrites it at pack time.

## Consequences

- Shared `tsconfig.base.json`; each package extends it and runs `tsc --noEmit`, orchestrated by turbo.
- Declarations are emitted by the package build, not by a composite graph.
- Revisit if typecheck passes ~15s, packages grow beyond fifteen, or we want the compiler itself
  policing the layer graph. Retrofitting is mechanical — mostly adding fields to existing tsconfigs.
