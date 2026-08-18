import {
  type ComponentManifest,
  componentManifest,
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

/** Accepts a single manifest or a `components:` catalogue, returning a flat list. */
export function loadManifests(yaml: string): ComponentManifest[] {
  const parsed = load<ComponentManifest | { components: ComponentManifest[] }>(
    yaml,
    componentManifest,
    'Component Manifest',
  )
  return 'components' in parsed ? parsed.components : [parsed]
}
