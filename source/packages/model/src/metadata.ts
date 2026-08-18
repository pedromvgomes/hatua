import type { Manifest, WorkflowExecution } from '@hatua/schema'

/**
 * Run metadata is derived, not reported.
 *
 * A component declares each metadata key as a `measure` (summable — tokens,
 * cost, retries) or a `dimension` (groupable — model, region). Given only
 * per-step values, that is enough for Hatua to compute run totals and pivots
 * like "tokens per model" itself.
 *
 * The alternative — runners reporting their own run-level summaries with their
 * own schemas — would mean every runner shapes the Runs view differently, and
 * Hatua could render none of them generically.
 */

export interface MetadataDescriptor {
  k: string
  label: string
  role: 'measure' | 'dimension'
  unit?: string
}

export interface MeasureTotal {
  key: string
  label: string
  unit?: string
  total: number
}

export interface Pivot {
  measure: string
  measureLabel: string
  dimension: string
  dimensionLabel: string
  unit?: string
  rows: { value: string; total: number }[]
}

/** Every metadata key any manifest declares, keyed by component `use`. */
export function descriptorsByUse(
  manifests: readonly Manifest[],
): Map<string, MetadataDescriptor[]> {
  const out = new Map<string, MetadataDescriptor[]>()
  for (const manifest of manifests) {
    if (!manifest.metadata?.length) continue
    out.set(manifest.use, manifest.metadata as MetadataDescriptor[])
  }
  return out
}

interface Sample {
  use: string
  values: Record<string, unknown>
}

/**
 * Flatten every step's metadata, descending into loop iterations — a loop's
 * children run once per item, so their samples are where the interesting
 * numbers live.
 */
function samples(execution: WorkflowExecution, useOf: (stepId: string) => string | undefined) {
  const out: Sample[] = []
  const visit = (steps: WorkflowExecution['steps']) => {
    for (const step of steps) {
      const use = useOf(step.id)
      if (use && step.metadata) out.push({ use, values: step.metadata })
      for (const iteration of step.iterations ?? []) {
        if (iteration.steps) visit(iteration.steps)
      }
    }
  }
  visit(execution.steps)
  return out
}

/** Sum every declared measure across the run. */
export function totals(
  execution: WorkflowExecution,
  descriptors: Map<string, MetadataDescriptor[]>,
  useOf: (stepId: string) => string | undefined,
): MeasureTotal[] {
  const acc = new Map<string, MeasureTotal>()

  for (const { use, values } of samples(execution, useOf)) {
    for (const descriptor of descriptors.get(use) ?? []) {
      if (descriptor.role !== 'measure') continue
      const value = values[descriptor.k]
      if (typeof value !== 'number') continue

      const existing = acc.get(descriptor.k)
      if (existing) existing.total += value
      else
        acc.set(descriptor.k, {
          key: descriptor.k,
          label: descriptor.label,
          total: value,
          ...(descriptor.unit ? { unit: descriptor.unit } : {}),
        })
    }
  }

  return [...acc.values()]
}

/**
 * Sum a measure grouped by a dimension — "tokens per model". Both must be
 * declared by the same component, since only then do they co-occur on a sample.
 */
export function pivot(
  execution: WorkflowExecution,
  descriptors: Map<string, MetadataDescriptor[]>,
  useOf: (stepId: string) => string | undefined,
  measureKey: string,
  dimensionKey: string,
): Pivot | null {
  // Both must be declared by the SAME component. Searching independently would
  // happily pair component A's measure with component B's dimension and return
  // a fully-populated Pivot whose rows are empty, since the two never co-occur
  // on one sample.
  let measure: MetadataDescriptor | undefined
  let dimension: MetadataDescriptor | undefined
  const declaringUses = new Set<string>()

  for (const [use, list] of descriptors) {
    const m = list.find((d) => d.k === measureKey && d.role === 'measure')
    const d = list.find((d) => d.k === dimensionKey && d.role === 'dimension')
    if (!m || !d) continue
    measure ??= m
    dimension ??= d
    declaringUses.add(use)
  }
  if (!measure || !dimension) return null

  const rows = new Map<string, number>()
  for (const { use, values } of samples(execution, useOf)) {
    // Only count samples from a component that declared both. Without this the
    // pivot would include an undeclared key of the same name, so its rows would
    // not sum to the total rendered beside them.
    if (!declaringUses.has(use)) continue

    const value = values[measureKey]
    const group = values[dimensionKey]
    if (typeof value !== 'number' || group === undefined || group === null) continue
    const key = String(group)
    rows.set(key, (rows.get(key) ?? 0) + value)
  }

  return {
    measure: measureKey,
    measureLabel: measure.label,
    dimension: dimensionKey,
    dimensionLabel: dimension.label,
    ...(measure.unit ? { unit: measure.unit } : {}),
    rows: [...rows].map(([value, total]) => ({ value, total })).sort((a, b) => b.total - a.total),
  }
}
