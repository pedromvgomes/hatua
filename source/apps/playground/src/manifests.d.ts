/**
 * The conformance manifest fixtures, parsed at build time by the
 * `hatua:manifest-fixtures` plugin in vite.config.ts — see there for why the
 * parse does not happen in the browser.
 */
declare module 'virtual:hatua/manifests' {
  import type { Manifest } from '@hatua/react'

  export const CATALOGUE: Manifest[]
  export const EMPTY: Manifest[]
}
