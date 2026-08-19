import { z } from 'zod'

/**
 * A Component Manifest: the Host's declaration of a step type available to a
 * Workflow Definition. Hatua treats these as given and never invents them —
 * the library, inspector, reference tree, map chips and validation are all
 * generated from these, so adding a component is adding a manifest entry.
 */

/** Field kinds that accept a Reference. The rest hold literal values only. */
export const MAPPABLE_FIELD_KINDS = ['text', 'mono', 'number', 'textarea', 'ref'] as const
export const LITERAL_FIELD_KINDS = ['enum', 'bool', 'conn', 'secret'] as const

export const fieldKind = z.enum([...MAPPABLE_FIELD_KINDS, ...LITERAL_FIELD_KINDS])
export type FieldKind = z.infer<typeof fieldKind>

export const isMappable = (kind: FieldKind): boolean =>
  (MAPPABLE_FIELD_KINDS as readonly string[]).includes(kind)

export const fieldSpec = z.object({
  /** Key under the step's `with:` map. */
  k: z.string().min(1),
  label: z.string().min(1),
  kind: fieldKind,
  req: z.boolean().optional(),
  hint: z.string().optional(),
  ph: z.string().optional(),
  mono: z.boolean().optional(),
  options: z
    .array(z.object({ value: z.string(), label: z.string(), hint: z.string().optional() }))
    .optional(),
  toggleLabel: z.string().optional(),
  /** Show this field only while another field equals a value: [otherKey, value]. */
  when: z.tuple([z.string(), z.string()]).optional(),
})
export type FieldSpec = z.infer<typeof fieldSpec>

/**
 * `item` is the for-each escape hatch: the shape is not known statically, so it
 * is resolved by following the loop's `list` Reference to the source output.
 */
export const outputType = z.enum([
  'text',
  'number',
  'boolean',
  'datetime',
  'object',
  'list',
  'item',
])
export type OutputType = z.infer<typeof outputType>

export interface OutputSpec {
  k: string
  t: OutputType
  /** Shape of each list element or object member. */
  of?: OutputSpec[]
}

export const outputSpec: z.ZodType<OutputSpec> = z.lazy(() =>
  z.object({
    k: z.string().min(1),
    t: outputType,
    of: z.array(outputSpec).optional(),
  }),
)

export const componentGroup = z.enum([
  'Built-in',
  'Email',
  'Messaging',
  'Intelligence',
  'Data',
  'HTTP',
])
export type ComponentGroup = z.infer<typeof componentGroup>

export const componentSpec = z.object({
  /** Stable identity, e.g. `fetch_emails`. */
  key: z.string().min(1),
  /** Sentence case, e.g. `Fetch emails`. */
  name: z.string().min(1),
  /** The YAML verb this component writes, e.g. `email.fetch`. */
  use: z.string().min(1),
  group: componentGroup,
  icon: z.string().min(1),
  blurb: z.string(),
  /** At most one instance per Workflow Definition. */
  once: z.boolean().optional(),
  /** Cannot be deleted. */
  fixed: z.boolean().optional(),
  fields: z.array(fieldSpec),
  outputs: z.array(outputSpec),
})
export type ComponentSpec = z.infer<typeof componentSpec>
