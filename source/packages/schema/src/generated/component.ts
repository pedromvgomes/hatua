// GENERATED — do not edit.
// Source: schemas/component-manifest.schema.yaml
// Regenerate: pnpm codegen
import { z } from 'zod'

export const manifest = z.strictObject({
  /**
   * A trigger is declared identically to a component; its `outputs` are the payload it delivers when it fires, which is the workflow's parameter contract.
   */
  kind: z.enum(['component', 'trigger']),
  /**
   * The YAML verb a step or trigger writes. A Host's own verbs sit under `component.`, which is what leaves the Host's namespace below it entirely unconstrained: `component.email.send`, `component.block.render`. `core.` is Hatua's and `block.` names a Block declared in a Workflow Definition, so neither is a name a manifest may claim (ADR-0014).
   */
  use: z.string().min(1),
  /**
   * Sentence case, e.g. "Send email".
   */
  name: z.string().min(1),
  /**
   * Library grouping. Free-form so Hosts can add their own sections.
   */
  group: z.string().optional(),
  /**
   * URL of the component's icon, resolved and fetched by the browser: absolute (`https://cdn.example.com/icons/mail.svg`), root-relative (`/icons/mail.svg`), or a `data:` URI. The Host serves the artwork, the same way it serves the manifest.
   * It is a URL rather than a name because a name is only meaningful against a set, and Hatua ships no icon set — a Host adding a component of its own would have nothing to name. An earlier draft of this field said "icon name from the design system's set", which could never resolve to a picture and left the library card drawing the component's initial.
   * Square artwork, please: it is rendered into a fixed box and letterboxed if it is not. SVG is the obvious choice, and the file is fetched as an image — script inside an SVG does not execute in that position.
   * Whether it reads on both a light and a dark surface is the Host's to get right, since the Host owns the file and Hatua cannot recolour it. Should one URL prove not to be enough, this can widen to accept a per-mode pair without breaking a manifest that names one.
   * Optional. A component with no icon is drawn with a neutral placeholder rather than a guess, so artwork never blocks declaring a component.
   */
  icon: z.string().min(1).optional(),
  /**
   * One sentence, shown on the library card.
   */
  blurb: z.string().optional(),
  /**
   * At most one instance per workflow.
   */
  once: z.boolean().optional(),
  /**
   * Cannot be deleted from a workflow.
   */
  fixed: z.boolean().optional(),
  get fields() {
    return z.array(field)
  },
  get outputs() {
    return z.array(output)
  },
  /**
   * What this component reports about each run — tokens spent, model used, retries. Declared here rather than invented by the runner so the Runs view renders any component's metadata generically.
   */
  get metadata() {
    return z.array(metadataDescriptor).optional()
  },
})
export type Manifest = z.infer<typeof manifest>

export const field = z.strictObject({
  /**
   * Key under the step's `with:` map.
   */
  k: z.string().min(1),
  /**
   * Friendly name shown to the user. Always required — `k` is never shown raw.
   */
  label: z.string().min(1),
  /**
   * `text`, `mono`, `number`, `textarea`, `ref` and `map` accept Expressions; the rest hold literals only. `ref` holds exactly one expression and replaces rather than appends.
   * `map` is a list of named, typed entries the user builds — the shape a component like `core.map` needs, where the outputs are not fixed by the manifest but by what the user wrote into the field. It is the third field kind Hatua interprets structurally, alongside the two control-flow verbs, and the only one whose value decides a step's outputs.
   */
  kind: z.enum([
    'text',
    'mono',
    'number',
    'textarea',
    'ref',
    'map',
    'enum',
    'bool',
    'conn',
    'secret',
  ]),
  /**
   * Only on `kind: conn`. Offers only connections whose Host-reported type matches, so a "send email" step is never handed an LLM connection.
   */
  conn_type: z.string().optional(),
  req: z.boolean().optional(),
  /**
   * One sentence, shown under the field and replaced by the error when invalid.
   */
  hint: z.string().optional(),
  /**
   * Placeholder.
   */
  ph: z.string().optional(),
  /**
   * Render an enum's options in the mono face.
   */
  mono: z.boolean().optional(),
  options: z
    .array(
      z.strictObject({
        value: z.string(),
        label: z.string(),
        hint: z.string().optional(),
      }),
    )
    .optional(),
  /**
   * `bool` only.
   */
  toggleLabel: z.string().optional(),
  /**
   * Only on `kind: map`. Which types an entry may declare, defaulting to every scalar plus `list` and `object`. A component that maps only text — a header set, say — narrows it.
   */
  entry_types: z
    .array(z.enum(['text', 'number', 'boolean', 'datetime', 'list', 'object']))
    .optional(),
  /**
   * Show this field only while another field equals a value — `[otherKey, value]`. This is how one trigger component reshapes its form across schedule / API / upstream modes.
   */
  when: z.array(z.string()).min(2).max(2).optional(),
})
export type Field = z.infer<typeof field>

export const output = z.strictObject({
  k: z.string().min(1),
  /**
   * Friendly name shown in the reference tree, alongside the mono path.
   */
  label: z.string().min(1),
  /**
   * `item` is the for-each escape hatch: the shape is not known statically, so it is resolved by following the loop's `list` reference to the source output's `of`.
   */
  t: z.enum(['text', 'number', 'boolean', 'datetime', 'object', 'list', 'item']),
  /**
   * Shape of each list element or object member.
   */
  get of() {
    return z.array(output).optional()
  },
})
export type Output = z.infer<typeof output>

export const metadataDescriptor = z.strictObject({
  k: z.string().min(1),
  label: z.string().min(1),
  t: z.enum(['text', 'number', 'boolean', 'datetime']),
  /**
   * A `measure` is summable across steps and iterations — tokens, cost, retries. A `dimension` is groupable — model, region. Declaring both is what lets Hatua derive "tokens per model" without any runner-supplied schema: it sums the measure, grouped by the dimension.
   */
  role: z.enum(['measure', 'dimension']),
  /**
   * Rendered after the value, e.g. `tokens`, `ms`.
   */
  unit: z.string().optional(),
})
export type MetadataDescriptor = z.infer<typeof metadataDescriptor>

/**
 * The Host-supplied declaration of a step type. Hatua ships its own set and Hosts add business-specific ones; the format is identical and the only difference is who wrote the file.
 * Adding a component is adding a manifest entry: the library card, the inspector form, the reference tree, the map chips, the validation and the YAML output all follow from it, with no screen-level code.
 * There is deliberately no connector manifest. Connections are established outside Hatua and arrive from a Host interface carrying their own type, which a `conn` field matches against via `conn_type`.
 * Accepts either a single manifest or a `components:` catalogue — one file per component suits authoring and diffing, a catalogue suits serving.
 */
export const componentManifest = z.union([
  manifest,
  z.strictObject({
    get components() {
      return z.array(manifest)
    },
  }),
])
export type ComponentManifest = z.infer<typeof componentManifest>
