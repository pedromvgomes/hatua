import { Hatua } from '@hatua/react'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createApiManifestSource } from './api-source'

// The Host imports no CSS — Hatua renders its own stylesheet (ADR-0003).

/**
 * The API-backed embedding, served at /api.html.
 *
 * Same designer as /index.html — `<Hatua>`, the provider and the whole screen
 * from one element — and exactly one thing differs: where the Component
 * Manifests come from. index.html has them compiled into its bundle; this page
 * asks for them over HTTP after it has already rendered. That is the shape a
 * real Host has, because a Host's manifest set changes when the Host ships a
 * new component, not when the Host rebuilds its front end.
 *
 * What it demonstrates, and what it is honest about:
 *
 *  1. **Hatua needed nothing.** No part of @hatua/react or @hatua/services
 *     changed to make this page work. `ManifestSource` is one method returning
 *     a promise, so "an array I already have" and "whatever this endpoint says"
 *     are the same shape, and the Library's loading, failed and empty states —
 *     which looked like defensive programming when every source resolved
 *     instantly — are what this page actually goes through on every load.
 *  2. **The fetching is the Host's, all of it.** src/api-source.ts is fifteen
 *     lines and imports nothing from Hatua but a type. Hatua has no server, no
 *     base URL and no auth, so a port that took one would be Hatua guessing at
 *     an HTTP client every Host already has.
 *  3. **The manifests are not in this bundle.** `grep` dist/assets for
 *     `email.send` and it turns up one chunk — the one index.html, host.html
 *     and theme.html all load, and this page does not. That is the difference
 *     between build time and run time, in the output rather than in a comment.
 *  4. **The endpoint is a stand-in.** There is no backend here — it is a
 *     dev-server middleware, and a static file in a built playground. See
 *     vite.config.ts. The delay in the source is a stand-in too: a file on the
 *     same origin answers too fast for a loading state to be visible.
 *
 * Module scope, so each source is referentially stable — <HatuaProvider> keys
 * its store on the source it is handed, and a Host that rebuilt one every
 * render would be telling Hatua the catalogue changed every render.
 */
const LIVE = createApiManifestSource('/api/manifests.json')

/**
 * A URL nothing serves, so the failure path runs against a real 404 rather than
 * a thrown Error. Worth having as a page you can click: everything between the
 * status code and the sentence in the panel is Host code, and this is the only
 * place it runs end to end.
 */
const BROKEN = createApiManifestSource('/api/nothing-here.json')

function ApiPage() {
  const [broken, setBroken] = useState(false)

  return (
    <div style={{ blockSize: '100vh', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
      {/* The Host's own chrome, in the Host's own CSS. Hatua ships no
          stylesheet for it to import (ADR-0003), and out here there are no
          Hatua tokens to read either. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 13,
          borderBottom: '1px solid #d8dae1',
        }}
      >
        <p style={{ margin: 0 }}>
          API-backed embedding — the same <code>&lt;Hatua&gt;</code> as{' '}
          <a href="/index.html">the default embedding</a>, but the Component Manifests arrive from{' '}
          <code>/api/manifests.json</code> at run time instead of being compiled in. Compare with{' '}
          <a href="/host.html">the Host-authored one</a>.
        </p>
        <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={broken} onChange={() => setBroken(!broken)} />
          Point at a URL nothing serves
        </label>
      </div>

      <Hatua ports={{ manifests: broken ? BROKEN : LIVE }} />
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ApiPage />
  </StrictMode>,
)
