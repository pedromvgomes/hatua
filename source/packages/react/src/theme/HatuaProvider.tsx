import {
  type ConnectionDescriber,
  type ConnectionSource,
  type ConnectionStore,
  createConnectionStore,
  createEditingStore,
  createManifestStore,
  createValidationStore,
  createVersionStore,
  type EditingStore,
  type ManifestSource,
  type ManifestStore,
  type PublishGate,
  publishBlockers,
  type ValidationStore,
  type VersionStore,
  type WorkflowStore,
} from '@hatua/services'
import { createContext, type ReactNode, use, useEffect, useMemo, useRef, useState } from 'react'
import base from '../styles/base.css?inline'
import { createTheme, type Theme } from './createTheme'

/**
 * Mounted internally by <Hatua>, never by the Host (ADR-0002). It does four
 * things:
 *
 *  1. renders the base stylesheet once — React 19 hoists it to <head>, dedupes
 *     it by href and emits it during SSR, so the Host imports no CSS (ADR-0003);
 *  2. writes the theme seeds as inline custom properties, scoped to this
 *     subtree so two Hatua instances can carry different themes;
 *  3. owns a portal container INSIDE that subtree — overlays that portalled to
 *     document.body would escape the element holding the custom properties and
 *     render unthemed;
 *  4. carries the Host's ports, and wires each one to the store that reads it.
 *
 * The fourth is what makes this the composition root rather than a theme
 * provider. <Components /> takes no props in either embedding —
 * apps/playground/src/host.tsx mounts it bare and layouts/regions.test.tsx
 * mounts every region bare — so a `manifests` prop would break the promise
 * those two exist to keep. The provider is the only seam both paths share.
 *
 * Only the ports something renders today are here. The rest of ports.ts —
 * ExecutionSource, the connection ports — stays out until the PR that has a
 * consumer for it, because a port with no reader is a shape guessed at rather
 * than one a screen forced.
 */

export type ColorMode = 'light' | 'dark'

/**
 * What the Host implements, as far as anything rendered today can read. It
 * grows one field per PR, and every field is optional: a Host embedding only
 * the Data browser implements no ManifestSource, and mounting a region whose
 * port is missing must degrade rather than throw.
 */
export interface HostPorts {
  /** Where the Component Manifests come from. The Components tab reads this. */
  manifests?: ManifestSource
  /**
   * Where the Workflow Definitions live. Hatua has no storage, no server and no
   * idea where a workflow is kept — this port is the whole of that seam, and
   * without it the designer has nothing to edit and says so.
   *
   * Needs `workflowId` alongside it: the port addresses a workflow by id, and
   * which workflow the Host wants open is the Host's to say.
   */
  workflows?: WorkflowStore
  /**
   * Which Connections the Host has already established. A `conn` field offers
   * these and nothing else; without it the field says a Connection cannot be
   * chosen here rather than offering an empty list.
   *
   * Hatua never establishes one — it has no server, so it can hold no client
   * secret and receive no redirect (ADR-0007).
   */
  connections?: ConnectionSource
  /**
   * What to call each Connection. `listConnections` returns an opaque handle
   * and a type, deliberately: everything shown about a Connection comes from
   * asking the Host, so nothing cached in the Workflow Definition can go stale
   * when one is renamed.
   *
   * Separate from `connections` because the run viewer describes the
   * Connections a run used and never lists or creates any. Supply the list
   * without this and the picker labels each one by its ref, which is a poor
   * label and better than an empty list.
   */
  describeConnection?: ConnectionDescriber
}

const PortalContext = createContext<HTMLElement | null>(null)

/**
 * Null when no ManifestSource was given, which the Components tab renders as its own
 * state rather than as an empty catalogue — "the Host wired nothing" and "the
 * Host declared nothing" are different problems with different fixes.
 */
const ManifestStoreContext = createContext<ManifestStore | null>(null)

/** Null when the Host wired no WorkflowStore, or wired one and named no workflow. */
const EditingStoreContext = createContext<EditingStore | null>(null)

/**
 * Null unless BOTH a workflow and a catalogue are wired, because validation is
 * a question about one read against the other: a Step is missing a required
 * field only relative to the manifest that declares the field required.
 */
const ValidationStoreContext = createContext<ValidationStore | null>(null)

/** Null when the Host wired no ConnectionSource, which a `conn` field renders as its own state. */
const ConnectionStoreContext = createContext<ConnectionStore | null>(null)

/**
 * The workflow's versions. Null on the same condition the editing store is,
 * because both address one workflow through one port.
 *
 * A store of its own rather than a field on the editing store's snapshot: the
 * version READOUT comes from the open document, whose `version` and `status`
 * the schema makes required, while the LIST is about the workflow and answers
 * even while the document on screen does not project.
 */
const VersionStoreContext = createContext<VersionStore | null>(null)

/**
 * The element overlays should portal into. Null until the provider has mounted,
 * so callers must handle that — render nothing rather than falling back to
 * document.body, which would land outside the themed subtree.
 */
export const usePortalContainer = () => use(PortalContext)

/** The Host's manifest catalogue, or null when no ManifestSource was supplied. */
export const useManifestStore = () => use(ManifestStoreContext)

/**
 * The Draft being edited, or null when the Host supplied no WorkflowStore or no
 * `workflowId`. Regions render that as their own state: "nothing is wired up"
 * and "the document failed to open" are different problems with different
 * fixes, and only the second is the store's to report.
 */
export const useEditingStore = () => use(EditingStoreContext)

/** The Host's established Connections, or null when no ConnectionSource was supplied. */
export const useConnectionStore = () => use(ConnectionStoreContext)

/**
 * The workflow's versions, or null when the Host supplied no WorkflowStore or
 * no `workflowId`. Nothing is fetched until a reader calls `load()`.
 */
export const useVersionStore = () => use(VersionStoreContext)

/**
 * What is wrong with each Step, or null when there is no workflow or no
 * catalogue to check it against. A region renders the absence as no markers at
 * all rather than as "everything is fine" — an unchecked workflow and a valid
 * one must not look the same.
 */
export const useValidationStore = () => use(ValidationStoreContext)

export interface HatuaProviderProps {
  theme?: Theme
  /** Omit to follow the Host's colour mode; set to pin Hatua's own. */
  colorMode?: ColorMode
  /** The Host's implementations. Omit and every region that needs one says so. */
  ports?: HostPorts
  /**
   * Which Workflow Definition to open, as the Host's `WorkflowStore` addresses
   * it. Omit and nothing is opened — which is what a Host embedding only the
   * catalogue or the run viewer wants, and is also why the store below is lazy:
   * `openDraft` claims the edit, so mounting must not take a lease.
   */
  workflowId?: string
  children: ReactNode
}

export function HatuaProvider({
  theme,
  colorMode,
  ports,
  workflowId,
  children,
}: HatuaProviderProps) {
  // State, not a ref: a ref read during render is null on the first pass and
  // assigning to it schedules no re-render, so consumers would keep seeing null
  // until some unrelated update happened to re-render the provider.
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null)

  // Keyed on the source rather than on `ports`, so the object literal a Host
  // writes inline — `ports={{ manifests }}` — is not itself a change. The
  // source inside it does have to be referentially stable, the same way any
  // React dependency does: Hatua cannot tell a Host that rebuilds its
  // ManifestSource every render apart from one that swapped it, and a swap
  // must refetch. Hold it at module scope or in a useMemo.
  const manifestSource = ports?.manifests
  const manifestStore = useMemo(
    () => (manifestSource ? createManifestStore(manifestSource) : null),
    [manifestSource],
  )

  /*
   * What the publish gate reads, held behind a ref so the gate itself never
   * changes identity.
   *
   * The ref is load-bearing, not stylistic. `ValidationStore` is built FROM the
   * editing store — it subscribes to it — so `publish()` cannot simply read it,
   * and the obvious repairs all put the validation store into the editing
   * store's dependency list below. That list is `[workflowSource, workflowId]`
   * and nothing else on purpose: rebuilding the editing store disposes the lease
   * and re-claims the Draft, so keying it on anything that moves when the
   * connection describer moves would REOPEN THE DOCUMENT when a Host swapped a
   * describer.
   *
   * What unties it is that the dependency is mutual but not simultaneous:
   * validation needs the editing store continuously, while publish needs
   * validation once, at the moment it is pressed. See ADR-0023.
   */
  const gateSources = useRef<{
    validation: ValidationStore | null
    manifests: ManifestStore | null
  }>({ validation: null, manifests: null })

  const gate = useMemo<PublishGate>(
    () => ({
      blockers: () =>
        publishBlockers(gateSources.current.validation, gateSources.current.manifests),
    }),
    [],
  )

  // Keyed on the port and the id together, because either one changing means a
  // different Draft. The same stability rule applies as above: a Host that
  // rebuilds its WorkflowStore every render looks exactly like one that swapped
  // it, and a swap has to reopen — which also releases nothing, so hold it at
  // module scope or in a useMemo. `gate` is in the list and never moves, which
  // is the whole point of the ref above.
  const workflowSource = ports?.workflows
  const editingStore = useMemo(
    () =>
      workflowSource && workflowId
        ? createEditingStore(workflowSource, workflowId, { gate })
        : null,
    [workflowSource, workflowId, gate],
  )

  // No lease and no claim, so rebuilding this one costs a refetch and nothing
  // else — none of the hazard the editing store's key guards against.
  const versionStore = useMemo(
    () => (workflowSource && workflowId ? createVersionStore(workflowSource, workflowId) : null),
    [workflowSource, workflowId],
  )

  // The manifest store holds one fetch and nothing else; this one holds a lease
  // on the Host's storage and a timer renewing it, so letting a replaced store
  // keep running would leave a workflow claimed by a session that is gone.
  useEffect(() => () => editingStore?.dispose(), [editingStore])

  // Keyed on both ports together: a Host that swaps either has changed what the
  // pickers should offer. The describer is optional, so a Host supplying only
  // the list still gets a store — labelled by ref.
  const connectionSource = ports?.connections
  const connectionDescriber = ports?.describeConnection
  const connectionStore = useMemo(
    () => (connectionSource ? createConnectionStore(connectionSource, connectionDescriber) : null),
    [connectionSource, connectionDescriber],
  )

  // Pure derivation over the stores above, so it holds nothing of its own and
  // needs no disposal — see createValidationStore.
  //
  // The connection store is passed even though it may be null: a Host that wires
  // no `ConnectionSource` is correctly configured, and validation narrows to the
  // rules a document can answer on its own rather than withholding all of them.
  const validationStore = useMemo(
    () =>
      editingStore && manifestStore
        ? createValidationStore(editingStore, manifestStore, connectionStore)
        : null,
    [editingStore, manifestStore, connectionStore],
  )

  // In an effect rather than during render: a render React discards must not
  // leave the gate pointing at stores that were discarded with it. Publish can
  // only be pressed after a commit, so there is no window where this matters.
  useEffect(() => {
    gateSources.current = { validation: validationStore, manifests: manifestStore }
  }, [validationStore, manifestStore])

  return (
    <>
      <style href="hatua-base" precedence="hatua-base">
        {base}
      </style>
      <div className="hatua-root" style={theme ?? createTheme()} data-hatua-mode={colorMode}>
        <ManifestStoreContext value={manifestStore}>
          <EditingStoreContext value={editingStore}>
            <ConnectionStoreContext value={connectionStore}>
              <ValidationStoreContext value={validationStore}>
                <VersionStoreContext value={versionStore}>
                  <PortalContext value={portalHost}>
                    {children}
                    <div className="hatua-portals" ref={setPortalHost} />
                  </PortalContext>
                </VersionStoreContext>
              </ValidationStoreContext>
            </ConnectionStoreContext>
          </EditingStoreContext>
        </ManifestStoreContext>
      </div>
    </>
  )
}
