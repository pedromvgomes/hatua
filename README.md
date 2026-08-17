<p align="left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/assets/hatua-lockup-dark.svg">
    <img src="brand/assets/hatua-lockup.svg" alt="Hatua" width="220">
  </picture>
</p>

Hatua is an embeddable workflow builder. Drag steps together, map one step's typed outputs into the next, branch and loop. Hatua reads and writes plain YAML and renders run history you hand it. It never executes anything: your app supplies the component manifests, storage and runner.

## Layout

| Path | What |
| --- | --- |
| [`source/`](./source/) | The monorepo — the React workflow designer and the packages it ships. |
| [`brand/`](./brand/) | The logo, and the tooling that rasterizes it to PNG. Versioned separately; the product depends on it, not the other way round. |

Node ≥ 20 and [pnpm](https://pnpm.io) ≥ 9. Both are declared in `engines`, and the exact pnpm
version is pinned via `packageManager` for Corepack.
