import { createManifestStore, type ManifestSource, type ManifestStore } from '@hatua/services'
import { createContext, type ReactNode, use, useMemo, useState } from 'react'
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
 * The fourth is new, and it is what turns this from a theme provider into the
 * composition root. It had to be: <Library /> takes no props in either
 * embedding — apps/playground/src/host.tsx mounts it bare and
 * layouts/regions.test.tsx mounts every region bare — so a `manifests` prop
 * would break the promise those two exist to keep. The provider is the only
 * seam both paths already share.
 *
 * Only the ports something renders today are here. The rest of ports.ts —
 * WorkflowStore, ExecutionSource, the connection ports — stays out until the
 * PR that has a consumer for it, because a port with no reader is a shape
 * guessed at rather than one a screen forced.
 */

export type ColorMode = 'light' | 'dark'

/**
 * What the Host implements, as far as anything rendered today can read. It
 * grows one field per PR, and every field is optional: a Host embedding only
 * the Data browser implements no ManifestSource, and mounting a region whose
 * port is missing must degrade rather than throw.
 */
export interface HostPorts {
  /** Where the Component Manifests come from. The Library reads this. */
  manifests?: ManifestSource
}

const PortalContext = createContext<HTMLElement | null>(null)

/**
 * Null when no ManifestSource was given, which the Library renders as its own
 * state rather than as an empty catalogue — "the Host wired nothing" and "the
 * Host declared nothing" are different problems with different fixes.
 */
const ManifestStoreContext = createContext<ManifestStore | null>(null)

/**
 * The element overlays should portal into. Null until the provider has mounted,
 * so callers must handle that — render nothing rather than falling back to
 * document.body, which would land outside the themed subtree.
 */
export const usePortalContainer = () => use(PortalContext)

/** The Host's manifest catalogue, or null when no ManifestSource was supplied. */
export const useManifestStore = () => use(ManifestStoreContext)

export interface HatuaProviderProps {
  theme?: Theme
  /** Omit to follow the Host's colour mode; set to pin Hatua's own. */
  colorMode?: ColorMode
  /** The Host's implementations. Omit and every region that needs one says so. */
  ports?: HostPorts
  children: ReactNode
}

export function HatuaProvider({ theme, colorMode, ports, children }: HatuaProviderProps) {
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

  return (
    <>
      <style href="hatua-base" precedence="hatua-base">
        {base}
      </style>
      <div className="hatua-root" style={theme ?? createTheme()} data-hatua-mode={colorMode}>
        <ManifestStoreContext value={manifestStore}>
          <PortalContext value={portalHost}>
            {children}
            <div className="hatua-portals" ref={setPortalHost} />
          </PortalContext>
        </ManifestStoreContext>
      </div>
    </>
  )
}
