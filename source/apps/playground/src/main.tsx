import { configureLogging, type Level } from '@hatua/log'
import { Hatua } from '@hatua/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SOURCES } from './catalogue'
import { CONNECTIONS } from './connections'
import { createLocalWorkflowStore } from './workflow-store'

// The Host imports no CSS — Hatua renders its own stylesheet (ADR-0003).

/**
 * The default embedding: a Host writes <Hatua> and nothing else. It mounts the
 * provider and the designer screen, so everything visible below arrived from
 * one element and one import.
 *
 * It passes `ports` and a `workflowId`. That is not a third way to embed — it
 * is the Host answering the two questions Hatua cannot answer for itself. Hatua
 * never invents a Component, so a designer with no ManifestSource has an empty
 * Components tab by definition; and it has no storage at all, so a designer with no
 * WorkflowStore has nothing to edit. The alternative to these props is Hatua
 * shipping a catalogue and a database of its own, which is exactly what
 * CONTEXT.md says it does not do.
 *
 * This entry takes the happy path deliberately, and takes it at build time: its
 * catalogue is compiled into the bundle, so the Components tab renders on the
 * first frame with no request behind it. Its slow, failing and empty states
 * are exercised by host.tsx, where a Host can switch between them; api.tsx is
 * the same designer as this one with the manifests fetched at run time, which
 * is the shape a real Host has.
 *
 * Nothing is passed as children. <Hatua> renders <Build>; children would be a
 * third way to embed sitting between the two we promise. The primitives are
 * documented in the Storybook, which is where a component library's parts
 * belong.
 *
 * The other entries are host.tsx at /host.html — the same designer assembled by
 * the Host itself, which never imports <Hatua> — and api.tsx at /api.html.
 * Keeping them apart is what makes ADR-0003's claim measurable: the per-entry
 * bundles in dist/ show what each way of embedding actually costs, and which of
 * them carries the catalogue.
 *
 * `workflows` sits at module scope so the port is referentially stable:
 * <HatuaProvider> keys its editing store on the port it is handed, and a store
 * rebuilt every render would reopen the Draft — a new lease per render.
 */
const workflows = createLocalWorkflowStore()

/*
 * Logging, switched on in a way that survives a reload.
 *
 * `configureLogging` holds its settings in memory, which is right for a library
 * — a Host decides afresh each time it starts — and useless for chasing
 * something here: every edit to a region forces a full page reload, so a switch
 * thrown in the console is gone before the thing being watched happens again.
 *
 * So the playground remembers. A level written here is put in `localStorage` and
 * read back at startup, and `?log=` sets it for one visit without touching what
 * is stored.
 *
 *   hatuaLogging('*:debug')
 *   hatuaLogging('services.editing:trace,react.fields:debug')
 *   hatuaLogging(null)                       // back to silent
 *   http://localhost:5173/?log=*:trace
 *
 * The playground's own affordance, not Hatua's: a Host decides whether it wants
 * one at all, and this one is a development harness.
 */
const STORED = 'hatua.log'

/** `services.editing:trace,react:debug` — the shortest thing that types cleanly. */
const parseLevels = (spec: string): Record<string, Level> =>
  Object.fromEntries(
    spec
      .split(',')
      .map((one) => one.trim())
      .filter(Boolean)
      .map((one) => {
        const at = one.lastIndexOf(':')
        return at < 0 ? ['*', one as Level] : [one.slice(0, at), one.slice(at + 1) as Level]
      }),
  )

const remembered = (): string | null => {
  const asked = new URLSearchParams(globalThis.location.search).get('log')
  if (asked !== null) return asked
  try {
    return globalThis.localStorage.getItem(STORED)
  } catch {
    // A browser with site data blocked. Nothing to remember, which is the
    // default anyway.
    return null
  }
}

const spec = remembered()
if (spec) configureLogging({ levels: parseLevels(spec) })

;(globalThis as unknown as { hatuaLogging: (spec: string | null) => unknown }).hatuaLogging = (
  next,
) => {
  try {
    if (next === null) globalThis.localStorage.removeItem(STORED)
    else globalThis.localStorage.setItem(STORED, next)
  } catch {
    // Not remembered, but still applied for this page.
  }
  return next === null
    ? 'Logging off from the next reload. Reload to apply.'
    : configureLogging({ levels: parseLevels(next) })
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Hatua
      ports={{ manifests: SOURCES.ready, workflows, ...CONNECTIONS.ready }}
      workflowId="wf_morning"
    />
  </StrictMode>,
)
