import { CATALOGUE, EMPTY } from 'virtual:hatua/manifests'
import type { ManifestSource } from '@hatua/react'

/**
 * The playground's Component Manifests, and the ManifestSources that serve
 * them.
 *
 * This is the first port the playground implements, and the point at which
 * "the Host owns the manifest set" stops being prose: nothing in @hatua/react
 * knows what `email.send` is, and both entries below had to say where their
 * catalogue comes from before the Library could render anything at all.
 *
 * The catalogue itself is conformance/manifest/*.yaml rather than a copy: a
 * hand-written one here would drift from what both SDKs are held to, and the
 * corpus gains a third reader. It is read through `loadManifests()` — which is
 * what flattens a `components:` catalogue, the exact step ports.ts warns every
 * consumer not to skip — at build time rather than in the browser. See
 * vite.config.ts for why.
 */

const after = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Module scope, so each is referentially stable: <HatuaProvider> keys the store
 * on the source it is handed, and a Host that rebuilds one every render is
 * telling Hatua the catalogue changed every render.
 */
export const SOURCES = {
  /** The happy path: everything the fixture declares, immediately. */
  ready: { loadManifests: async () => CATALOGUE },
  /** Long enough to read the loading state rather than guess it exists. */
  slow: { loadManifests: () => after(1800).then(() => CATALOGUE) },
  failing: {
    loadManifests: async () => {
      throw new Error('The catalogue endpoint returned 503.')
    },
  },
  /** A fresh Host, nothing declared. Legitimate, and not a failure. */
  empty: { loadManifests: async () => EMPTY },
} satisfies Record<string, ManifestSource>

export type SourceName = keyof typeof SOURCES
