import { describe, expect, it } from 'vitest'
import { CONNECTIONS } from './connections'

/**
 * The Host's Connection ports, at the seam.
 *
 * These are fakes, and testing a fake is only worth doing where the fake is
 * making a claim about the port it implements. This one is: `listConnections`
 * returns an opaque handle and a type and nothing readable, because that is
 * exactly what a Workflow Definition stores — everything a person sees comes
 * from `describe`, so nothing cached in the file can go stale when a Connection
 * is renamed on the Host's side. A fake that leaked a label out of the list
 * would let Hatua depend on something no real Host promises.
 */

describe('the Host’s connection ports', () => {
  it('lists a handle and a type, and nothing a person would recognise', async () => {
    const page = await CONNECTIONS.ready.connections.listConnections()

    expect(page.items.length).toBeGreaterThan(0)
    for (const connection of page.items) {
      expect(Object.keys(connection).sort()).toEqual(['ref', 'type'])
    }
  })

  it('returns one page, because a handful of Connections is not paged', async () => {
    const page = await CONNECTIONS.ready.connections.listConnections()
    expect(page.next).toBeUndefined()
  })

  it('describes a handle it knows, with what the user reads', async () => {
    const [first] = (await CONNECTIONS.ready.connections.listConnections()).items
    const described = await CONNECTIONS.ready.describeConnection.describe(
      (first as { ref: string }).ref,
    )

    expect(described.label).toBeTruthy()
    expect(described.type).toBe((first as { type: string }).type)
    expect(described.status).toBe('ready')
  })

  it('reports a status other than ready, which is a real thing a Host has', async () => {
    const statuses = await Promise.all(
      (await CONNECTIONS.ready.connections.listConnections()).items.map((connection) =>
        CONNECTIONS.ready.describeConnection.describe(connection.ref),
      ),
    )
    expect(statuses.map((s) => s.status)).toContain('expired')
  })

  it('rejects a handle it does not know, rather than inventing a description', async () => {
    // Revoked, or belonging to someone else now. The store keeps offering the
    // rest, which is the behaviour this rejection exists to exercise.
    await expect(CONNECTIONS.ready.describeConnection.describe('cx_nope')).rejects.toThrow(
      /No connection/,
    )
  })

  it('offers a Host that has established none, which is not a failure', async () => {
    const page = await CONNECTIONS.empty.connections.listConnections()
    expect(page.items).toEqual([])
  })

  it('offers a Host that wired no ports at all', () => {
    // A `conn` field then says a Connection cannot be chosen here, rather than
    // showing an empty picker — "the Host wired nothing" and "the Host has
    // established nothing" are different problems with different fixes.
    expect(CONNECTIONS.none).toEqual({})
  })

  it('offers the list without the describer, because the two ports are separate', () => {
    // An editor-only Host may implement just the first; the run viewer
    // implements just the second. The picker labels by ref in that case.
    expect(CONNECTIONS.undescribed.connections).toBeDefined()
    expect('describeConnection' in CONNECTIONS.undescribed).toBe(false)
  })

  it('takes its time on the slow one, so the loading state can be looked at', async () => {
    const started = performance.now()
    await CONNECTIONS.slow.connections.listConnections()
    expect(performance.now() - started).toBeGreaterThan(500)
  })

  it('holds each source at module scope, so the provider does not see a swap', () => {
    // <HatuaProvider> keys the store on the ports it is handed: a Host that
    // rebuilt one every render would be telling Hatua the Connections changed
    // every render.
    expect(CONNECTIONS.ready.connections).toBe(CONNECTIONS.ready.connections)
    expect(CONNECTIONS.ready.describeConnection).toBe(CONNECTIONS.ready.describeConnection)
  })
})
