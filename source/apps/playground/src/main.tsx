import { Hatua } from '@hatua/react'
import { createConsoleSink, Logging } from '@vipengele/ts-core-observability/logger'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SOURCES } from './catalogue'
import { CONNECTIONS } from './connections'
import { createLocalExecutionSource } from './executions'
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

/**
 * The Host's run history, at module scope for the reason the store is: a port
 * rebuilt every render is a port that has been swapped, as far as
 * <HatuaProvider> can tell.
 *
 * Supplying it is what draws the **Runs** segment. `ExecutionSource` says "omit
 * entirely and the Runs view is hidden", so a Host with no runner has a designer
 * with two views and no dead control — which is what `/host.html` is, since it
 * wires no runs at all.
 */
const executions = createLocalExecutionSource(workflows)

/*
 * Logging, through the vipengele built-ins, switched on in a way that survives
 * a reload: every edit to a region forces a full page reload, so a level set
 * only in memory is gone before the thing being watched happens again.
 *
 * A level spec is `category:level` entries joined by `,`, with `*` for every
 * category; one with nothing configured logs `warn` and above. `?log=` sets a
 * spec for one visit and is never stored. `hatuaLogging(spec)` in the console
 * applies a spec and writes it to `localStorage` under `hatua.log`, which is
 * read back on the next load; `hatuaLogging(null)` clears it; `hatuaLogging()`
 * reports the levels in force. Each call confirms itself with a record.
 *
 *   hatuaLogging('*:debug')
 *   hatuaLogging('services.editing:trace,react.fields:debug')
 *   hatuaLogging(null)
 *   http://localhost:5173/?log=*:trace
 *
 * The playground's own affordance, not Hatua's: a Host decides whether it wants
 * one at all, and this one is a development harness.
 */
Logging.configure((b) =>
  b.addSink(createConsoleSink()).addBrowserSources({ storageKey: 'hatua.log' }),
)
Logging.installConsole('hatuaLogging')

const log = Logging.logger('playground')
const workflowId = 'wf_morning'
log.debug('mounting the designer', { workflowId })

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Hatua
      ports={{ manifests: SOURCES.ready, workflows, executions, ...CONNECTIONS.ready }}
      workflowId={workflowId}
    />
  </StrictMode>,
)
