# @hatua/brand

The Hatua logo, and the tooling that turns it into PNGs.

Three navy-to-teal risers: a step, a step, a step. The final riser is the accent — it reads as a
staircase and as a rising bar chart. Geometry only, no letterforms in the mark, so it holds down to
14px and survives being punched out of a single colour.

This folder sits **beside** `source/`, not inside it. The product monorepo consumes the brand; the
brand does not depend on the product, and it is versioned and installed on its own.

---

## Files

Every asset lives in `assets/`. They are hand-authored and self-contained — the wordmark in the
lockups is already outlined `<path>` data, so nothing here needs a font installed to render
correctly, and there is no build step between source and distributable.

| File | Use |
| --- | --- |
| `hatua-mark.svg` | The mark. Default, on light surfaces. |
| `hatua-mark-dark.svg` | The mark on dark surfaces (`#101526` and darker). |
| `hatua-mark-mono.svg` | Single colour in `currentColor` — inherits the surrounding text colour. |
| `hatua-lockup.svg` | Mark + wordmark, horizontal. |
| `hatua-lockup-dark.svg` | Lockup on dark surfaces. |
| `hatua-lockup-mono.svg` | Lockup in `currentColor`. |
| `hatua-avatar-512.svg` | GitHub org / repo avatar, white ground, 512×512. |
| `hatua-avatar-512-navy.svg` | Same, navy ground — use if the profile row is light. |
| `hatua-favicon.svg` | 32×32 favicon; mark scaled to fill, minimal padding. |

---

## Using from code

```ts
import mark from "@hatua/brand/svg/hatua-mark.svg";
import lockup from "@hatua/brand/svg/hatua-lockup-dark.svg";
```

`./svg/*` resolves to `assets/*`.

The `-mono` variants paint with `currentColor`, so they only mean anything when **inlined** into the
document — as a React component or via an SVG sprite, not through an `<img src>` (which isolates the
SVG from the page's text colour and renders it black). Use them where the logo should track the
surrounding text: inside a button, a nav item, a print stylesheet.

---

## Generating PNGs

SVG is the source of truth. PNGs are generated on demand and **never committed** — `dist/` is
git-ignored.

```sh
pnpm install          # one-time, in this folder

pnpm build:png        # render every output declared in tools/png-manifest.json → dist/
pnpm png assets/hatua-avatar-512.svg 1024        # one-off, arbitrary size
pnpm png assets/hatua-lockup.svg 800 /tmp/x.png  # one-off, explicit destination
```

The manifest covers the sizes that recur — favicons, PWA icons, the Apple touch icon, GitHub
avatars, and 1×/2× marks and lockups in both themes. Add an entry there when a size becomes
routine; use the one-off form when it doesn't. See [`tools/README.md`](./tools/README.md).

---

## Geometry

Mark drawn on a 32×32 grid. Three 8×8 squares, corner radius 2.5, stepping up-right in 9px
increments: `(3,19) (12,11) (21,3)`. Riser one and two are navy, riser three is teal. Never
recolour a different riser, never add a fourth, never change the 9px offset.

## Colour

| Token | Light | Dark |
| --- | --- | --- |
| Ink (risers 1–2) | `#232D47` | `#E9ECF5` |
| Accent (riser 3) | `#2AA0AF` — `oklch(0.63 0.115 195)` | `#37B3C2` — `oklch(0.68 0.11 195)` |

Hex values are given so the SVGs stand alone; in app code use the design-system tokens
(`--text-primary`, `--accent`) instead.

## Rules

- **Size floor** 14px for the mark, 100px wide for the lockup. Below 14px use `hatua-mark-mono.svg`.
- **Clear space** one riser-width (8 grid units, 25% of the mark height) on all sides.
- **Wordmark** is lowercase `hatua`, Space Grotesk 700, tracking -0.02em. In the lockup the mark
  stands 30 units to the wordmark's 24-unit cap height, with a 13-unit gap. Set live text at that
  spec if you'd rather not use the outlined SVG:

  ```css
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-transform: lowercase;
  ```

- **Never** rotate, skew, add a gradient, outline, or shadow; never place the mark on a saturated or
  busy background; never reflow the risers into a row or a column.

---

## Layout

```
brand/
  assets/               the logo — hand-authored, outlined, font-free
  tools/
    build-png.js        rasterizer: manifest mode and one-off mode
    png-manifest.json   the declared PNG outputs
  dist/                 generated PNGs (git-ignored)
```
