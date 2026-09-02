import { configureLogging, type Level, levelsFrom, resetLogging } from '@hatua/log'
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

/**
 * What was asked for, however it was asked.
 *
 * A string because that is what types cleanly into a console; the config object
 * because that is what `configureLogging` takes and what a reader who has seen
 * the package reaches for first. Accepting one and silently storing the other
 * as `[object Object]` is a switch that appears to work and does nothing, which
 * is the failure this whole affordance exists to avoid.
 */
const asSpec = (asked: string | { levels?: Record<string, Level> }): string =>
  typeof asked === 'string'
    ? asked
    : Object.entries(asked.levels ?? {})
        .map(([category, level]) => `${category}:${level}`)
        .join(',')

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

const stored = remembered()
if (stored) configureLogging({ levels: levelsFrom(stored) })

;(
  globalThis as unknown as {
    hatuaLogging: (asked: string | { levels?: Record<string, Level> } | null) => unknown
  }
).hatuaLogging = (asked) => {
  if (asked === null) {
    try {
      globalThis.localStorage.removeItem(STORED)
    } catch {
      // Not remembered; the reset below still applies to this page.
    }
    resetLogging()
    return 'Logging off.'
  }

  const spec = asSpec(asked)
  const levels = levelsFrom(spec)
  if (Object.keys(levels).length === 0) {
    return `Nothing usable in "${spec}". Try '*:debug' or 'services.editing:trace'.`
  }

  try {
    globalThis.localStorage.setItem(STORED, spec)
  } catch {
    // Not remembered, but still applied for this page.
  }
  return configureLogging({ levels })
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Hatua
      ports={{ manifests: SOURCES.ready, workflows, ...CONNECTIONS.ready }}
      workflowId="wf_morning"
    />
  </StrictMode>,
)
