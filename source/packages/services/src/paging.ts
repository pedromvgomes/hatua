import type { Cursor } from './ports'

/**
 * Drain a paged endpoint. Hosts return `next` until exhausted; a Host with a
 * small set returns one page with no `next` at all.
 *
 * The `seen` guard is not paranoia: a Host that echoes the same cursor back
 * would otherwise spin forever, and that failure is invisible in a UI that just
 * looks slow.
 */
export async function drain<T>(
  page: (cursor?: string) => Promise<Cursor<T>>,
  { limit = 10_000 }: { limit?: number } = {},
): Promise<T[]> {
  const out: T[] = []
  const seen = new Set<string>()
  let cursor: string | undefined

  do {
    const result = await page(cursor)
    out.push(...result.items)
    cursor = result.next
    if (cursor !== undefined) {
      if (seen.has(cursor)) throw new Error(`Paging did not advance: cursor "${cursor}" repeated`)
      seen.add(cursor)
    }
    // Throw rather than return early. Returning would make a truncated list
    // indistinguishable from a complete one, and the caller would render a
    // Host's first 10,000 runs as if they were all of them.
    if (cursor !== undefined && out.length >= limit) {
      throw new Error(
        `Refusing to drain past ${limit} items — page through explicitly instead of loading everything`,
      )
    }
  } while (cursor !== undefined)

  return out
}
