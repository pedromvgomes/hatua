import { createTheme } from '@hatua/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

/**
 * The Host-authored embedding, served at /host.html.
 *
 * The rule this entry exists to keep: it never imports <Hatua>. Hatua.tsx
 * promises that "the same regions are exported individually for Hosts that want
 * their own layout", and a promise about what a Host does NOT have to pull in
 * can only be checked by a bundle that does not pull it in. A bundler cannot
 * include what nobody imports, so the evidence is dist/assets/host-*.js sitting
 * next to dist/assets/main-*.js and being visibly smaller.
 *
 * Today there is nothing to arrange. The parts a Host would compose — the
 * regions, the ports it supplies, the store it drives — arrive with the
 * container shell and the tabs that follow it, and each of those PRs extends
 * this entry alongside the default one. What already exists is the seam a Host
 * touches first: createTheme(), a pure function producing the seeds it hands to
 * whichever parts it mounts (ADR-0002).
 *
 * Everything visible below is styled by the Host's own CSS, inline. That is the
 * point rather than an omission — Hatua ships no stylesheet for a Host to
 * import (ADR-0003), and outside the provider there are no Hatua tokens to
 * read either.
 */
const theme = createTheme({ accent: 'oklch(0.63 0.115 195)' })

function HostPage() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 640,
        margin: '0 auto',
        padding: 24,
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ fontSize: '1.125rem' }}>Host-authored embedding</h1>
      <p>
        This page imports <code>createTheme</code> and nothing else from <code>@hatua/react</code>.
        It must never import <code>&lt;Hatua&gt;</code>: the designer assembled by hand is the case
        this entry exists to keep honest, and importing the all-in-one control would put it in this
        bundle and end the measurement.
      </p>
      <p>
        Compare with <a href="/index.html">the default embedding</a>, which writes{' '}
        <code>&lt;Hatua&gt;</code> and lets it mount the provider.
      </p>
      <h2 style={{ fontSize: '0.95rem' }}>The seeds this Host would supply</h2>
      <pre style={{ overflowX: 'auto', background: '#f4f4f6', padding: 12, borderRadius: 6 }}>
        {JSON.stringify(theme, null, 2)}
      </pre>
    </main>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <HostPage />
  </StrictMode>,
)
