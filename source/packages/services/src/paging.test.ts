import { describe, expect, it } from 'vitest'
import { drain } from './paging'
import type { Cursor } from './ports'

const pager =
  (pages: string[][]) =>
  async (cursor?: string): Promise<Cursor<string>> => {
    const i = cursor ? Number(cursor) : 0
    return {
      items: pages[i] ?? [],
      ...(i + 1 < pages.length ? { next: String(i + 1) } : {}),
    }
  }

describe('drain', () => {
  it('walks every page', async () => {
    expect(await drain(pager([['a', 'b'], ['c'], ['d', 'e']]))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('terminates on a single page with no cursor', async () => {
    expect(await drain(pager([['only']]))).toEqual(['only'])
  })

  it('handles an empty result', async () => {
    expect(await drain(pager([[]]))).toEqual([])
  })

  it('throws rather than spinning when a Host echoes its cursor back', async () => {
    // A UI would otherwise just look slow forever.
    const stuck = async (): Promise<Cursor<string>> => ({ items: ['x'], next: 'same' })
    await expect(drain(stuck)).rejects.toThrow(/did not advance/)
  })
})
