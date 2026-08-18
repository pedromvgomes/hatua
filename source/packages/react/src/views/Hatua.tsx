import type { ReactNode } from 'react'
import type { Theme } from '../theme/createTheme'
import { type ColorMode, HatuaProvider } from '../theme/HatuaProvider'

/**
 * The Hatua workflow designer.
 *
 * Renders the full three-region screen for the common case. The same regions
 * are exported individually for Hosts that want their own layout — the parts
 * are the seam, this is the convenience.
 */
export interface HatuaProps {
  /** Optional; built with createTheme(). Defaults to Hatua's own palette. */
  theme?: Theme
  /** Omit to follow the Host's colour mode. */
  colorMode?: ColorMode
  children?: ReactNode
}

export function Hatua({ theme, colorMode, children }: HatuaProps) {
  return (
    <HatuaProvider theme={theme} colorMode={colorMode}>
      {children}
    </HatuaProvider>
  )
}
