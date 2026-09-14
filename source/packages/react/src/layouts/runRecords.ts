import type { RunStatus } from '@hatua/model'
import type { WorkflowExecution } from '@hatua/schema'

/**
 * How a run reads on screen: what each status is called, and how a moment and a
 * duration are written down.
 *
 * The questions ABOUT the execution — which records a Step has, and what one
 * status stands for them — are `@hatua/model`'s, where a Host's own viewer can
 * reach them. What is here is only the wording.
 */

/** What a Step's status is called on screen. */
export const STATUS_LABEL: Record<RunStatus, string> = {
  pending: 'Not started',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  skipped: 'Skipped',
}

/** The same for a whole run, which has three of the five. */
export const RUN_STATUS_LABEL: Record<WorkflowExecution['status'], string> = {
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
}

/**
 * A duration, written the same way everywhere.
 *
 * Formatted by hand rather than through `Intl`, for the reason the version list
 * slices its dates: a locale-dependent string makes what renders depend on the
 * machine, and every story and every assertion then passes only where it was
 * written.
 */
export function durationOf(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2).replace(/\.?0+$/, '')}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

/**
 * A moment, sliced out of the ISO string the schema asks for.
 *
 * Read defensively: a type is a promise the Host makes and an endpoint can break
 * it, and a row missing its timestamp is still a row worth drawing.
 */
export function momentOf(at: string | undefined): string {
  if (typeof at !== 'string' || at.length < 16) return ''
  return `${at.slice(0, 10)} ${at.slice(11, 16)}`
}
