/**
 * Diagnostics and the one error type.
 *
 * The SDK reports; the Host disposes. An evaluation failure yields a typed
 * error carrying a stable code, the slot it happened in and the offset inside
 * that slot's Template. Hatua never decides whether a step fails, whether the
 * run aborts, or whether the value should quietly become empty — those are the
 * Host's calls, and it can only make them if it is told exactly what happened.
 */
import { DIAGNOSTICS, type DiagnosticCode, type Severity } from '#generated/diagnostics.js'

export type { DiagnosticCode, Phase, Severity } from '#generated/diagnostics.js'
export { DIAGNOSTICS } from '#generated/diagnostics.js'

export interface Diagnostic {
  readonly code: DiagnosticCode
  /** Errors block Publish; warnings inform and block nothing. */
  readonly severity: Severity
  /** Offset of the failing construct within the Template. */
  readonly at: number
  /** The Slot this Template was being resolved into, when there is one. */
  readonly slot?: string
  readonly message: string
}

/**
 * Fill a `{name}` template.
 *
 * Two lines rather than a formatting library because the Go half has to produce
 * byte-identical output: a message that reads one way in the builder and
 * another in a runner's logs is a support ticket nobody can close.
 */
export function formatMessage(
  template: string,
  args: Readonly<Record<string, string>> = {},
): string {
  return template.replace(/\{([a-z_]+)\}/g, (whole, key: string) =>
    Object.hasOwn(args, key) ? (args[key] as string) : whole,
  )
}

export function diagnostic(
  code: DiagnosticCode,
  at: number,
  args: Readonly<Record<string, string>> = {},
  slot?: string,
): Diagnostic {
  const spec = DIAGNOSTICS[code]
  return {
    code,
    severity: spec.severity,
    at,
    ...(slot === undefined ? {} : { slot }),
    message: formatMessage(spec.message, args),
  }
}

/**
 * Thrown by `resolve` and `resolveAll`.
 *
 * It carries a list, not a single failure: `resolveAll` does a whole `with:`
 * map in one call and reports every failure together rather than stopping at
 * the first, because a user fixing one field at a time is a user running the
 * workflow five times to find five mistakes.
 */
export class ExpressionError extends Error {
  readonly diagnostics: readonly Diagnostic[]

  constructor(diagnostics: readonly Diagnostic[]) {
    super(diagnostics.map((d) => d.message).join('; '))
    this.name = 'ExpressionError'
    this.diagnostics = diagnostics
  }

  /** The first failure's code — the common case is exactly one. */
  get code(): DiagnosticCode | undefined {
    return this.diagnostics[0]?.code
  }
}

export const errorsIn = (diagnostics: readonly Diagnostic[]): readonly Diagnostic[] =>
  diagnostics.filter((d) => d.severity === 'error')

/** Whether a set of diagnostics blocks Publish. Warnings never do. */
export const blocksPublish = (diagnostics: readonly Diagnostic[]): boolean =>
  diagnostics.some((d) => d.severity === 'error')
