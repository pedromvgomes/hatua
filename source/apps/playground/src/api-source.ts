import type { ManifestEntry, ManifestSource } from '@hatua/react'

/**
 * A `ManifestSource` that fetches. This is Host code, and that is the point.
 *
 * Hatua has no server, no base URL, no auth header and no opinion about
 * transport, so it cannot fetch anything on a Host's behalf — which is why
 * `ManifestSource` is one method returning a promise and not a URL. Everything
 * an API adds over a baked-in array lives on this side of the seam: the
 * endpoint, the credentials, the retry policy, the caching. What Hatua
 * contributed is the three states the Components tab already renders — a load that
 * takes time, a load that fails, and a catalogue that is legitimately empty —
 * and none of them needed changing to make this work.
 *
 * Fifteen lines is the whole cost, and no part of @hatua/react or
 * @hatua/services moved to accommodate it.
 */

export interface ApiManifestSourceOptions {
  /**
   * Stands in for network latency. The endpoint behind this playground is a
   * file on the same origin, so it answers in about a millisecond and the
   * loading state would flash past unseen — which would make a state
   * that is real for every Host look theoretical here. A Host deletes this.
   */
  delayMs?: number
  /** Injected for tests. Bound, because an unbound `fetch` throws in a browser. */
  fetch?: typeof globalThis.fetch
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function createApiManifestSource(
  url: string,
  {
    delayMs = 450,
    fetch = (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args),
  }: ApiManifestSourceOptions = {},
): ManifestSource {
  return {
    async loadManifests(): Promise<ManifestEntry[]> {
      if (delayMs > 0) await wait(delayMs)

      const response = await fetch(url)
      // A non-2xx body is usually an HTML error page, and letting it reach
      // `.json()` turns "the endpoint is down" into "Unexpected token <". The
      // region renders whatever message arrives, so the message is worth
      // spending a line on.
      if (!response.ok) {
        throw new Error(`${url} responded ${response.status} ${response.statusText}`.trim())
      }

      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw new Error(`${url} did not return JSON.`)
      }

      // The cast is the last place a promise can be broken quietly. A 200 whose
      // body is an object — the `components:` catalogue, most likely, since that
      // is a legal way to write a manifest FILE — would otherwise be handed to
      // Hatua as a ManifestEntry[] it is not. Failing here keeps it on the
      // Host's side of the seam, which is where this file says such things
      // belong.
      if (!Array.isArray(body)) {
        throw new Error(
          `${url} returned ${body === null ? 'null' : typeof body}, not an array of manifests. ` +
            'A `components:` catalogue has to be flattened before it is served.',
        )
      }
      return body as ManifestEntry[]
    },
  }
}
