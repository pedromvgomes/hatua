# playground

The development harness. Not published, and not an example app either — each
page here exists to keep a specific claim honest, and the differences between
them are the point.

| Page | Embedding | Where the manifests come from |
| --- | --- | --- |
| `index.html` → `src/main.tsx` | `<Hatua>`, and nothing else | Compiled in, at build time |
| `host.html` → `src/host.tsx` | The regions, arranged by the Host | Compiled in, at build time |
| `api.html` → `src/api.tsx` | `<Hatua>`, and nothing else | Fetched at run time |

Three entries, not three routes. A route would share one bundle with everything
the app can reach, which would put `<Hatua>` into the Host-authored page's
JavaScript whether that page used it or not. Separate entries give separate
bundles, so `ls dist/assets` answers what each way of embedding costs — and,
now, which pages carry a catalogue:

```
$ grep -l email.send dist/assets/*.js
dist/assets/catalogue-*.js      # loaded by index.html and host.html, not api.html
```

Both greps are about which chunks a *page* pulls in. The entry chunks named
`main`, `host` and `api` are now thin: everything shared sits in `client-*.js`
(React), `Hatua-*.js` (the container) and `catalogue-*.js` (the baked-in
fixtures), and which of those a page loads is the whole answer.

## The two axes

**How the designer is assembled** — `index` against `host`. One writes `<Hatua>`;
the other imports the regions and mounts `<HatuaProvider>` around its own
layout, puts the Inspector on the left and the toolbar at the bottom, and leaves
the Data tab out entirely. `host.tsx` never imports `<Hatua>` or `<Build>`, and
the built output is the evidence — `hatua-build` and `hatua-data`, the style
hrefs of the container and of the omitted region, live in one chunk that
`host.html` never asks for:

```
$ grep -l hatua-build dist/assets/*.js
dist/assets/Hatua-*.js
$ grep -c 'Hatua-' dist/host.html
0
```

Per page, not per entry chunk: `<Hatua>` is shared by `index` and `api`, so
Rollup hoists it out of both entry chunks into one of its own.

**When the Component Manifests arrive** — `index` against `api`. Those two pages
render the identical designer; the only difference is that one has its catalogue
as a constant and the other asks an endpoint for it after it has already
rendered. That is the shape a real Host has, because a Host's manifest set
changes when the Host ships a new component, not when it rebuilds its front end.

Nothing in `@hatua/react` or `@hatua/services` differs between the two. The port
is one method returning a promise, so "an array I already have" and "whatever
this endpoint says" are the same shape — and the Library's loading, failed and
empty states, which look like defensive programming when every source resolves
instantly, are what `api.html` goes through on every load.

## The fixtures, and what is faked

Every page serves `conformance/manifest/*.yaml` — the corpus both SDKs are held
to, rather than a copy that could drift from it. `vite.config.ts` reads and
validates it in Node, so a fixture that stops parsing fails the build, and so
that `loadManifests()`'s YAML parser and zod never reach the browser. A real
Host validates where it publishes and serves the result.

Two things here are stand-ins, and both say so where they are written:

- **The endpoint.** There is no backend. `/api/manifests.json` is a dev-server
  middleware and, in a built playground, a static file at the same path. What it
  reproduces faithfully is the only part Hatua can see: the manifests are not in
  the page's JavaScript, and the page has to ask.
- **The delay.** A file on the same origin answers in about a millisecond, which
  would make the Library's loading state flash past unseen. `src/api-source.ts`
  waits before asking. A Host deletes that line.

`host.tsx` fakes differently and on purpose: its sources resolve instantly, fail,
or return nothing, chosen so each state can be held still and looked at.
`api.html` runs the same states against a real request, including a checkbox
that points the source at a URL the endpoint answers 404 for.

## Scripts

```
pnpm dev       # all three pages
pnpm build
pnpm preview   # the built output, endpoint included
pnpm test      # src/api-source.ts — the Host's port implementation
```

`dev`, `build` and `preview` pass `--configLoader runner`. Vite bundles its
config with esbuild and externalises `node_modules`, which hands `vite.config.ts`
to Node — and Node cannot import a workspace package that resolves to TypeScript
source (ADR-0004). The runner loader goes through Vite's own module runner,
which can. `vitest.config.ts` is separate for the same reason.
