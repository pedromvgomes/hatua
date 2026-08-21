import type { ConnectionDescriber, ConnectionSource } from '@hatua/react'

/**
 * The Connections this Host has "established", and the two ports that serve
 * them.
 *
 * Fakes, and deliberately shaped like the real thing: `listConnections` returns
 * an opaque handle and a type and nothing a person would recognise, because
 * that is exactly what a Workflow Definition stores. Everything readable comes
 * from `describe`, so nothing cached in the file can go stale when a Connection
 * is renamed on the Host's side.
 *
 * Hatua establishes none of these and never will — it has no server, so it can
 * hold no client secret and receive no redirect (ADR-0007). What the playground
 * proves here is only that the picker offers what the Host says exists, filters
 * it by the type a field asks for, and says something useful when the Host
 * offers nothing at all.
 */

interface Established {
  ref: string
  type: string
  label: string
  hint?: string
  status: 'ready' | 'expired' | 'revoked' | 'unknown'
}

const ESTABLISHED: Established[] = [
  { ref: 'cx_9f2a', type: 'email', label: 'Ops mailbox', hint: 'ops@example.com', status: 'ready' },
  {
    ref: 'cx_31bd',
    type: 'email',
    label: 'Support inbox',
    hint: 'support@example.com',
    status: 'ready',
  },
  { ref: 'cx_7c04', type: 'llm', label: 'Claude Code · Haiku 4.5', status: 'ready' },
  { ref: 'cx_a180', type: 'chat', label: '#engineering', status: 'expired' },
]

const after = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const source = (available: Established[], delayMs = 0): ConnectionSource => ({
  async listConnections() {
    if (delayMs > 0) await after(delayMs)
    return { items: available.map(({ ref, type }) => ({ ref, type })) }
  },
})

const describer = (available: Established[]): ConnectionDescriber => ({
  async describe(ref) {
    const found = available.find((connection) => connection.ref === ref)
    // A handle the Host cannot describe is a real case — revoked, or belonging
    // to someone else now — and the picker keeps offering the rest.
    if (!found) throw new Error(`No connection "${ref}"`)
    return {
      type: found.type,
      label: found.label,
      hint: found.hint,
      status: found.status,
      details: {},
    }
  },
})

/**
 * Module scope, so each is referentially stable: <HatuaProvider> keys the store
 * on the ports it is handed, and a Host that rebuilds one every render is
 * telling Hatua the Connections changed on every render.
 */
export const CONNECTIONS = {
  /** The happy path: everything, described, immediately. */
  ready: { connections: source(ESTABLISHED), describeConnection: describer(ESTABLISHED) },
  /** Long enough to read the loading state rather than guess it exists. */
  slow: { connections: source(ESTABLISHED, 1200), describeConnection: describer(ESTABLISHED) },
  /**
   * Listed and not described. An editor-only Host may implement just the first
   * port; the picker labels each Connection by its ref, which is a poor label
   * and a better one than an empty list.
   */
  undescribed: { connections: source(ESTABLISHED) },
  /** A Host that has established none yet. Legitimate, and not a failure. */
  empty: { connections: source([]), describeConnection: describer([]) },
  /** No ports at all: a `conn` field says a Connection cannot be chosen here. */
  none: {},
} as const

export type ConnectionsName = keyof typeof CONNECTIONS
