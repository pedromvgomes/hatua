import { describe, expect, it, vi } from 'vitest'
import { createApiManifestSource } from './api-source'

/**
 * The playground is a Host, and this is the port it implements. It is tested
 * for the same reason any Host's would be: everything an API adds over a baked
 * catalogue — latency, a status code, a body that is not what was promised —
 * happens here, on the Host's side of the seam, and Hatua only ever sees the
 * promise this returns.
 */
const respond = (body: unknown, init: ResponseInit = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200, ...init }))

const MANIFESTS = [
  { kind: 'component', use: 'email.send', name: 'Send email', fields: [], outputs: [] },
]

describe('createApiManifestSource', () => {
  it('returns what the endpoint served', async () => {
    const fetch = respond(MANIFESTS)
    const source = createApiManifestSource('/api/manifests.json', { delayMs: 0, fetch })

    await expect(source.loadManifests()).resolves.toEqual(MANIFESTS)
    expect(fetch).toHaveBeenCalledWith('/api/manifests.json')
  })

  it('waits before asking, so the loading state is visible in a local harness', async () => {
    vi.useFakeTimers()
    try {
      const fetch = respond(MANIFESTS)
      const source = createApiManifestSource('/api/manifests.json', { delayMs: 500, fetch })

      const pending = source.loadManifests()
      expect(fetch).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(500)
      await expect(pending).resolves.toEqual(MANIFESTS)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports the status rather than letting an error page reach the parser', async () => {
    // The failure this avoids: an HTML 503 page hits `.json()` and the region
    // shows "Unexpected token <", which tells nobody the endpoint is down.
    const fetch = vi.fn(async () => new Response('<html>nope</html>', { status: 503 }))
    const source = createApiManifestSource('/api/manifests.json', { delayMs: 0, fetch })

    await expect(source.loadManifests()).rejects.toThrow(/503/)
  })

  it('says so when a 200 is JSON but not an array', async () => {
    // The `components:` catalogue is a legal way to write a manifest file, so a
    // Host serving one straight down the wire is a realistic mistake — and
    // unchecked it reaches Hatua typed as something it is not.
    const fetch = vi.fn(async () => new Response(JSON.stringify({ components: MANIFESTS })))
    const source = createApiManifestSource('/api/manifests.json', { delayMs: 0, fetch })

    await expect(source.loadManifests()).rejects.toThrow(/not an array of manifests/)
  })

  it('says so when a 200 is not JSON', async () => {
    const fetch = vi.fn(async () => new Response('not json', { status: 200 }))
    const source = createApiManifestSource('/api/manifests.json', { delayMs: 0, fetch })

    await expect(source.loadManifests()).rejects.toThrow(/did not return JSON/)
  })
})
