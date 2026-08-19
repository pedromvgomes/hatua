import {
  createTheme,
  FlowMap,
  HatuaProvider,
  Inspector,
  Library,
  TabbedPanel,
  TopBar,
} from '@hatua/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

/**
 * The Host-authored embedding, served at /host.html.
 *
 * The rule this entry exists to keep: it never imports <Hatua>, and it never
 * imports <Build> either. Both promise the same thing — "the same regions are
 * exported individually for Hosts that want their own layout" — and a promise
 * about what a Host does NOT have to pull in can only be checked by a bundle
 * that does not pull it in. A bundler cannot include what nobody imports, so
 * the evidence is dist/assets/host-*.js sitting next to dist/assets/main-*.js
 * and being visibly smaller, with no `Build` in it.
 *
 * What it proves, beyond that the parts exist:
 *
 *  1. **They move.** The Inspector is on the left here and the toolbar is at
 *     the bottom. <Build> puts them the other way round. Neither region knows.
 *  2. **They are optional.** The Data tab is deliberately not mounted. That is
 *     the harder half: a region that is merely movable can still be required,
 *     and a shell that quietly needs all five is a shell every Host has to
 *     accept whole.
 *  3. **The tab strip owns nothing.** <TabbedPanel> is handed two regions and
 *     renders two tabs. It has no third child to lose.
 *
 * <HatuaProvider> is the one thing this page must mount that the <Hatua> path
 * mounts for you. It carries the theme's custom properties and the container
 * overlays portal into; the regions read both and hold neither (ADR-0002). It
 * is the parts path's root, not a third way to embed — there is still nothing
 * here to configure that <Hatua> would not configure identically.
 */
const theme = createTheme({ accent: 'oklch(0.63 0.115 195)' })

function HostPage() {
  return (
    <div style={{ blockSize: '100vh', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
      {/* The Host's own chrome, in the Host's own CSS. Hatua ships no
          stylesheet for it to import (ADR-0003), and out here there are no
          Hatua tokens to read either. */}
      <p
        style={{
          margin: 0,
          padding: '8px 16px',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 13,
          borderBottom: '1px solid #d8dae1',
        }}
      >
        Host-authored embedding — the Inspector on the left, the toolbar at the bottom, and no Data
        tab at all. Compare with <a href="/index.html">the default embedding</a>.
      </p>

      <HatuaProvider theme={theme}>
        <div
          style={{
            blockSize: '100%',
            display: 'grid',
            gridTemplateColumns: 'minmax(200px, 260px) minmax(0, 1fr)',
            gridTemplateRows: 'minmax(0, 1fr) auto',
          }}
        >
          <div style={{ gridColumn: 1, gridRow: 1 }}>
            <Inspector />
          </div>
          <div style={{ gridColumn: 2, gridRow: 1, minWidth: 0 }}>
            <TabbedPanel
              tabs={[
                { id: 'flow', label: 'Flow', content: <FlowMap /> },
                { id: 'library', label: 'Library', content: <Library /> },
              ]}
            />
          </div>
          <div style={{ gridColumn: '1 / -1', gridRow: 2 }}>
            <TopBar />
          </div>
        </div>
      </HatuaProvider>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <HostPage />
  </StrictMode>,
)
