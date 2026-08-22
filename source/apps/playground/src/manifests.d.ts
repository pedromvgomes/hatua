/**
 * The conformance manifest fixtures, parsed at build time by the
 * `hatua:manifest-fixtures` plugin in vite.config.ts — see there for why the
 * parse does not happen in the browser.
 */
declare module 'virtual:hatua/manifests' {
  import type { ManifestEntry } from '@hatua/react'

  /** Components, Triggers and the Host's Run Context, in the one flat array the port returns. */
  export const CATALOGUE: ManifestEntry[]
  /** A fresh Host: nothing declared at all, not even a Run Context. */
  export const EMPTY: ManifestEntry[]
}
