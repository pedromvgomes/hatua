<p align="left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/assets/hatua-lockup-dark.svg">
    <img src="brand/assets/hatua-lockup.svg" alt="Hatua" width="220">
  </picture>
</p>

Hatua is an embeddable workflow builder. Drag steps together, map one step's typed outputs into the next, branch and loop. Hatua reads and writes plain YAML and renders run history you hand it. It never executes anything: your app supplies the component manifests, storage and runner.

Every piece of it is browsable in [Storybook](https://storybook.hatua.dev).

## Install

```sh
npm install @hatua/react react react-dom   # the designer, in the browser
npm install @hatua/sdk                     # the contract and expression evaluator, on Node
```

For a Go backend:

```sh
go get hatua.dev/go
```

`@hatua/react` and `@hatua/sdk` are the two supported surfaces. The other seven `@hatua/*`
packages — document, expressions, layout, log, model, schema, services — are on npm only
because `@hatua/react`'s build treats them as externals; they are implementation details,
not an API to install against.

## Use

```tsx
import { Hatua } from '@hatua/react'

export function App() {
  return <Hatua />
}
```

`<Hatua>` mounts the provider and the whole screen. Pass `ports` and `workflowId` to wire
up storage and run history; without them the designer says it has nothing to edit rather
than inventing something. `theme` takes the result of `createTheme()`, and `colorMode`
overrides the colour mode Hatua otherwise follows from your app.

## Stability

`@hatua/react` is 0.x. While it stays 0.x a breaking change can land on a minor version
bump, so semver alone does not protect an app that upgrades freely — pin an exact version.
Styling reaches as far as `createTheme()` and no further: there is no stylesheet to
override.

## Going deeper

| Path | What |
| --- | --- |
| [`CONTEXT.md`](./CONTEXT.md) | The domain language — what a Step, a Board, a Workflow Definition and a Workflow Execution each are, and the words to avoid. |
| [`docs/adr/`](./docs/adr/) | The decisions that constrain the code, and the alternatives they ruled out. |
| [`docs/release-notes/`](./docs/release-notes/) | What shipped in each npm version. |

## Layout

| Path | What |
| --- | --- |
| [`source/`](./source/) | The monorepo — the React workflow designer and the packages it ships. |
| [`brand/`](./brand/) | The logo, and the tooling that rasterizes it to PNG. Versioned separately; the product depends on it, not the other way round. |

Node 24 (Active LTS) and [pnpm](https://pnpm.io) ≥ 11. Both are declared in `engines`; `.nvmrc`
pins the exact Node version for `nvm use`, and `packageManager` pins pnpm for Corepack.
