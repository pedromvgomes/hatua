import { createContext, type ReactNode, use, useState } from 'react'
import base from '../styles/base.css?inline'
import { createTheme, type Theme } from './createTheme'

/**
 * Mounted internally by <Hatua>, never by the Host (ADR-0002). It does three
 * things:
 *
 *  1. renders the base stylesheet once — React 19 hoists it to <head>, dedupes
 *     it by href and emits it during SSR, so the Host imports no CSS (ADR-0003);
 *  2. writes the theme seeds as inline custom properties, scoped to this
 *     subtree so two Hatua instances can carry different themes;
 *  3. owns a portal container INSIDE that subtree — overlays that portalled to
 *     document.body would escape the element holding the custom properties and
 *     render unthemed.
 */

export type ColorMode = 'light' | 'dark'

const PortalContext = createContext<HTMLElement | null>(null)

/**
 * The element overlays should portal into. Null until the provider has mounted,
 * so callers must handle that — render nothing rather than falling back to
 * document.body, which would land outside the themed subtree.
 */
export const usePortalContainer = () => use(PortalContext)

export interface HatuaProviderProps {
  theme?: Theme
  /** Omit to follow the Host's colour mode; set to pin Hatua's own. */
  colorMode?: ColorMode
  children: ReactNode
}

export function HatuaProvider({ theme, colorMode, children }: HatuaProviderProps) {
  // State, not a ref: a ref read during render is null on the first pass and
  // assigning to it schedules no re-render, so consumers would keep seeing null
  // until some unrelated update happened to re-render the provider.
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null)

  return (
    <>
      <style href="hatua-base" precedence="hatua-base">
        {base}
      </style>
      <div className="hatua-root" style={theme ?? createTheme()} data-hatua-mode={colorMode}>
        <PortalContext value={portalHost}>
          {children}
          <div className="hatua-portals" ref={setPortalHost} />
        </PortalContext>
      </div>
    </>
  )
}
