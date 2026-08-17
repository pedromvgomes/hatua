# Hatua — brand build tools

One script: `build-png.js`. It renders the SVGs in `../assets/` to PNG via
[`@resvg/resvg-js`](https://github.com/yisibl/resvg-js), a Rust rasterizer with no headless-browser
dependency.

There is deliberately no SVG build step. The Hatua lockups ship the wordmark as outlined `<path>`
data rather than live `<text>`, so `assets/` is already font-independent and distributable — nothing
to convert, and no `src/` → `dist/` split to keep in sync.

---

## Manifest mode

```sh
pnpm build:png
# or: node tools/build-png.js --all [--manifest <file.json>]
```

Renders every entry in `png-manifest.json` into `../dist/`. Entry shape:

```json
{ "src": "assets/hatua-favicon.svg", "width": 32, "out": "dist/favicon-32.png" }
```

`src` and `out` are resolved against the **package root** (`brand/`), not the working directory, so
the output is byte-identical regardless of where you invoke the script from. `width` is in pixels;
height follows the SVG's aspect ratio.

Add an entry when a size becomes routine — a new favicon target, a store icon, a social card.
Prefer the one-off form for anything you'll need once.

## One-off mode

```sh
node tools/build-png.js <input.svg> <width> [output.png]

node tools/build-png.js assets/hatua-avatar-512.svg 1024   # → dist/hatua-avatar-512-1024.png
node tools/build-png.js assets/hatua-lockup.svg 800 ~/Desktop/logo-800.png
```

The input path **is** relative to the working directory, as you'd expect from a CLI. With no output
path the PNG goes to `../dist/<stem>-<width>.png` — deliberately *not* next to the input, since
that would drop an untracked PNG into `assets/`, which is not git-ignored.

---

## Notes

- **`dist/` is git-ignored.** SVG is the source of truth; PNG is a build product. Regenerate rather
  than commit — it keeps binary churn out of the history and guarantees the raster never drifts from
  the vector.
- **The `-mono.svg` files are not in the manifest**, on purpose. They paint with `currentColor`,
  which has no value outside a document that supplies a text colour; resvg resolves it to black.
  They are for inline embedding, not for export.
- **Transparency.** `hatua-mark*.svg` and `hatua-lockup*.svg` have no background, so their PNGs have
  an alpha channel. The avatar and favicon assets carry their own ground and render opaque.
