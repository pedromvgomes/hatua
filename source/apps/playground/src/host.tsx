import {
  createTheme,
  FlowMap,
  HatuaProvider,
  Inspector,
  Library,
  type Manifest,
  StepList,
  TabbedPanel,
  TopBar,
} from '@hatua/react'
import { StrictMode, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SOURCES, type SourceName } from './catalogue'
import { createLocalWorkflowStore } from './workflow-store'

/**
 * The Host-authored embedding, served at /host.html.
 *
 * The rule this entry exists to keep: it never imports <Hatua>, and it never
 * imports <Build> either. Both promise the same thing — "the same regions are
 * exported individually for Hosts that want their own layout" — and a promise
 * about what a Host does NOT have to pull in can only be checked by a bundle
 * that does not pull it in. A bundler cannot include what nobody imports, so
 * the evidence is what this page's chunks do not contain. `hatua-build` and
 * `hatua-data` — the style hrefs of the container and of the region this page
 * leaves out — appear in exactly one chunk, and host.html never asks for it:
 *
 *     $ grep -l hatua-build dist/assets/*.js
 *     dist/assets/Hatua-*.js
 *     $ grep -c 'Hatua-' dist/host.html
 *     0
 *
 * Read it per PAGE, not per entry chunk. An earlier version of this comment
 * said "only main's chunk has them", which was true of a two-entry build and
 * stopped being true the moment api.html arrived: <Hatua> is now shared between
 * index and api, so Rollup hoisted it — and the container's strings with it —
 * into a chunk of its own. The entry chunk named `main` holds neither string
 * today, so following that instruction proved the opposite of the claim.
 *
 * That is the durable half of the measurement, and it is now the whole of it.
 * PR 2 could also point at host-*.js being the smaller file (1.29 kB against
 * main's 1.87 kB); this page's own chrome has since overtaken that, because the
 * source switcher below is a Host feature and every byte of it is the Host's.
 * Comparing entry chunks was only ever a proxy for what they contain, and what
 * they contain is checkable directly.
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
 *     renders two tabs. It has no third child to lose — and it never holds the
 *     canvas: <FlowMap> gets a column here, as it does in <Build>, because a
 *     canvas mounted as a tab is a canvas the screen has no room for.
 *  4. **The regions take no data props.** <Library /> is still written exactly
 *     as it was before it rendered anything — the catalogue reaches it through
 *     the provider's ports. Had the manifests arrived as a prop, this line
 *     would have had to change, and "mount the regions wherever you like" would
 *     have quietly become "mount them and wire each one up".
 *
 * <HatuaProvider> is the one thing this page must mount that the <Hatua> path
 * mounts for you. It carries the theme's custom properties, the container
 * overlays portal into, and now the Host's ports; the regions read all three
 * and hold none (ADR-0002). It is the parts path's root, not a third way to
 * embed — there is still nothing here to configure that <Hatua> would not
 * configure identically.
 *
 * The workflow switcher does the same job for the editing store, and one of
 * its options is deliberately awkward: a store that refuses every write. That
 * is what proves ADR-0005's "a rejected write halts autosave and keeps the
 * in-memory document rather than retrying or discarding" — the halting is
 * invisible in a store that always says yes, and a spin is invisible in a unit
 * test that only counts one attempt. Remove a Step against it and the panel
 * says saving stopped while the tree keeps every edit.
 *
 * Opening this page twice does the same thing without any option being set: the
 * second tab takes the claim and the first halts on its next write. See
 * src/workflow-store.ts on why takeover rather than refusal.
 *
 * The source switcher below is the half of the Library that the default entry
 * cannot show. A catalogue that always resolves instantly makes loading,
 * failure and emptiness look theoretical; they are not — they are what a Host
 * fetching manifests over a network gets — so this page lets you pick one and
 * look at it. The sources here are fakes, chosen so each state can be held
 * still and looked at; /api.html runs the same states against a real request.
 */
const theme = createTheme({ accent: 'oklch(0.63 0.115 195)' })

/**
 * The Host's storage, and the ways it can behave. localStorage really persists,
 * so a reload resumes the same Draft and a second tab is refused the lease.
 */
const WORKFLOW_STORES = {
  local: () => createLocalWorkflowStore(),
  slow: () => createLocalWorkflowStore({ delayMs: 1400 }),
  rejecting: () => createLocalWorkflowStore({ rejectWrites: true }),
  unreachable: () => createLocalWorkflowStore({ failToOpen: true }),
} as const

type StoreName = keyof typeof WORKFLOW_STORES

const STORE_LABELS: Record<StoreName, string> = {
  local: 'localStorage',
  slow: 'Slow (1.4s)',
  rejecting: 'Refuses every write',
  unreachable: 'Cannot be reached',
}

const SOURCE_LABELS: Record<SourceName, string> = {
  ready: 'Resolves at once',
  slow: 'Slow (1.8s)',
  failing: 'Fails',
  empty: 'Declares nothing',
}

function HostPage() {
  const [sourceName, setSourceName] = useState<SourceName>('ready')
  const [storeName, setStoreName] = useState<StoreName>('local')
  const [lastSelected, setLastSelected] = useState<Manifest | null>(null)

  // Memoised on the name, because <HatuaProvider> keys its editing store on the
  // port it is handed: a Host that rebuilt one every render would look exactly
  // like one that swapped it, and a swap reopens the Draft — which means a new
  // lease on every keystroke.
  const workflows = useMemo(() => WORKFLOW_STORES[storeName](), [storeName])

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
          Host-authored embedding — the Inspector on the left, the toolbar at the bottom, and no
          Data tab at all. Compare with <a href="/index.html">the default embedding</a> and{' '}
          <a href="/api.html">the API-backed one</a>.
        </p>
        <fieldset style={{ display: 'flex', gap: 10, border: 0, margin: 0, padding: 0 }}>
          <legend style={{ float: 'left', padding: 0, marginInlineEnd: 10 }}>
            Manifest source:
          </legend>
          {(Object.keys(SOURCES) as SourceName[]).map((name) => (
            <label key={name} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <input
                type="radio"
                name="source"
                checked={sourceName === name}
                onChange={() => setSourceName(name)}
              />
              {SOURCE_LABELS[name]}
            </label>
          ))}
        </fieldset>
        <p style={{ margin: 0, color: '#5a6070' }}>
          {/* onSelect is props out, and that is all it is: adding the Step needs
              the editing store, which this PR does not have. What the Host does
              with the manifest is the Host's business — here, print it. */}
          {lastSelected ? `Last selected: ${lastSelected.use}` : 'Nothing selected yet.'}
        </p>
        <fieldset style={{ display: 'flex', gap: 10, border: 0, margin: 0, padding: 0 }}>
          <legend style={{ float: 'left', padding: 0, marginInlineEnd: 10 }}>
            Workflow storage:
          </legend>
          {(Object.keys(WORKFLOW_STORES) as StoreName[]).map((name) => (
            <label key={name} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <input
                type="radio"
                name="store"
                checked={storeName === name}
                onChange={() => setStoreName(name)}
              />
              {STORE_LABELS[name]}
            </label>
          ))}
        </fieldset>
      </div>

      <HatuaProvider
        theme={theme}
        ports={{ manifests: SOURCES[sourceName], workflows }}
        workflowId="wf_morning"
      >
        <div
          style={{
            blockSize: '100%',
            display: 'grid',
            gridTemplateColumns: 'minmax(200px, 260px) minmax(240px, 320px) minmax(0, 1fr)',
            gridTemplateRows: 'minmax(0, 1fr) auto',
          }}
        >
          <div style={{ gridColumn: 1, gridRow: 1 }}>
            <Inspector />
          </div>
          <div style={{ gridColumn: 2, gridRow: 1, minWidth: 0 }}>
            <TabbedPanel
              tabs={[
                {
                  id: 'library',
                  label: 'Library',
                  content: <Library onSelect={setLastSelected} />,
                },
                {
                  id: 'flow',
                  label: 'Flow',
                  // No onInsert here, and that is the point of this page: the
                  // regions emit, and what a Host does with what they emit is
                  // the Host's business. <Build> is the one that introduces the
                  // Library and the Flow tab to each other; this page prints
                  // the selection instead and still edits, because removing and
                  // reordering need no catalogue.
                  content: <StepList onSelect={(id) => console.info('selected', id)} />,
                },
              ]}
            />
          </div>
          <div style={{ gridColumn: 3, gridRow: 1, minWidth: 0 }}>
            <FlowMap />
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
