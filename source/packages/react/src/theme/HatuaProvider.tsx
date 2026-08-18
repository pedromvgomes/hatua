import { createContext, type ReactNode, use, useRef } from 'react'
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
export const usePortalContainer = () => use(PortalContext)

export interface HatuaProviderProps {
  theme?: Theme
  /** Omit to follow the Host's colour mode; set to pin Hatua's own. */
  colorMode?: ColorMode
  children: ReactNode
}

export function HatuaProvider({ theme, colorMode, children }: HatuaProviderProps) {
  const portalRef = useRef<HTMLDivElement | null>(null)

  return (
    <>
      <style href="hatua-base" precedence="hatua-base">
        {base}
      </style>
      <div className="hatua-root" style={theme ?? createTheme()} data-hatua-mode={colorMode}>
        <PortalContext value={portalRef.current}>
          {children}
          <div className="hatua-portals" ref={portalRef} />
        </PortalContext>
      </div>
    </>
  )
}
