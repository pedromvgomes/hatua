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
  } while (cursor !== undefined && out.length < limit)

  return out
}
