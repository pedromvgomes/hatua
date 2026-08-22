import {
  type ComponentManifest,
  componentManifest,
  type Manifest,
  type RunContextManifest,
  runContextManifest,
  type WorkflowDefinition,
  type WorkflowExecution,
  workflowDefinition,
  workflowExecution,
} from '@hatua/schema'
import { parse } from 'yaml'

/**
 * Parse-and-validate helpers. A runner should never hand itself an unvalidated
 * document: the builder guarantees what it wrote, but a file can be hand-edited
 * between publish and run.
 */

function load<T>(
  source: string,
  schema: {
    safeParse(v: unknown): {
      success: boolean
      data?: T
      error?: { issues: { path: PropertyKey[]; message: string }[] }
    }
  },
  what: string,
): T {
  const result = schema.safeParse(parse(source))
  if (!result.success || result.data === undefined) {
    const issue = result.error?.issues[0]
    const where = issue?.path.length ? ` at ${issue.path.join('.')}` : ''
    throw new Error(`Not a valid ${what}${where}: ${issue?.message ?? 'unknown error'}`)
  }
  return result.data
}

export const loadDefinition = (yaml: string): WorkflowDefinition =>
  load(yaml, workflowDefinition, 'Workflow Definition')

export const loadExecution = (yaml: string): WorkflowExecution =>
  load(yaml, workflowExecution, 'Workflow Execution')

/**
 * Accepts a single manifest or a `components:` catalogue, always returning a
 * FLAT list. The return type is deliberately `Manifest[]` rather than the
 * parse-time union: leaving the catalogue variant in the type forces every
 * consumer to narrow, and a consumer that narrows by dropping — rather than
 * flattening — silently loses every component in the catalogue.
 */
export function loadManifests(yaml: string): Manifest[] {
  const parsed = load<ComponentManifest>(yaml, componentManifest, 'Component Manifest')
  return 'components' in parsed ? parsed.components : [parsed]
}

/**
 * Parse a Run Context Manifest: the ambient values the Host supplies to every
 * execution, addressed as `run.<k>`.
 *
 * No catalogue variant to unwrap, unlike `loadManifests`. There is exactly one
 * Run Context per execution, so the file declares keys directly and a second
 * declaration is a mistake rather than a longer list — which is also what keeps
 * this return type a single object instead of an array nobody would know how to
 * merge.
 */
export const loadRunContext = (yaml: string): RunContextManifest =>
  load(yaml, runContextManifest, 'Run Context Manifest')
