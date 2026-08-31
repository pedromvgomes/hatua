import type { Manifest, WorkflowDefinition } from '@hatua/schema'

/** The shell every fixture below fills in, so each one is only its Step tree. */
const workflow = (name: string, rest: Partial<WorkflowDefinition>): WorkflowDefinition => ({
  id: `wf_${name}`,
  name,
  version: 1,
  status: 'draft',
  triggers: [{ id: 'nightly', use: 'core.schedule', with: {} }],
  steps: [],
  ...rest,
})

/**
 * Every region a container owns, on one Board: two Branches, a loop body, and a
 * `core.try`'s body and handler.
 *
 * The document the coverage test is worth running against. A fixture missing a
 * region would let a layout that forgets that region pass, which is the failure
 * the test exists to make impossible rather than unlikely.
 */
export const ALL_REGIONS = workflow('all regions', {
  steps: [
    { id: 'fetch', use: 'component.email.fetch', with: {} },
    {
      id: 'sort',
      use: 'core.fork',
      with: { mode: 'condition' },
      branches: [
        {
          label: 'Has new mail',
          when: '{{steps.fetch.count}} > 0',
          steps: [
            {
              id: 'each',
              use: 'core.for_each',
              with: { list: '{{steps.fetch.messages}}' },
              steps: [
                {
                  id: 'guarded',
                  use: 'core.try',
                  with: { attempts: 3 },
                  steps: [{ id: 'triage', use: 'component.agent.act', with: {} }],
                  handler: [{ id: 'shelve', use: 'component.email.send', with: {} }],
                },
              ],
            },
          ],
        },
        { label: 'Otherwise', steps: [{ id: 'quiet', use: 'core.end' }] },
      ],
    },
    { id: 'digest', use: 'component.email.send', with: {} },
  ],
})

/**
 * Two Blocks, each holding a Step called `ret`.
 *
 * Step ids are Board-local (ADR-0013), so this is the document that tells a
 * Placement keyed by a `StepRef` from one keyed by a bare id: under a bare id
 * the two `ret`s are one entry, and one of the two Blocks draws the other's map.
 */
export const TWO_RETS = workflow('two rets', {
  steps: [
    { id: 'first', use: 'block.alpha', with: {} },
    { id: 'second', use: 'block.beta', with: {} },
  ],
  blocks: [
    {
      id: 'alpha',
      outputs: [{ k: 'out', label: 'Out', t: 'text' }],
      steps: [{ id: 'ret', use: 'core.return', with: { out: 'a' } }],
    },
    {
      id: 'beta',
      outputs: [{ k: 'out', label: 'Out', t: 'text' }],
      steps: [{ id: 'ret', use: 'core.return', with: { out: 'b' } }],
    },
  ],
})

/** A Board with no Steps at all: the root node and nothing under it. */
export const EMPTY_BOARD = workflow('empty', { steps: [] })

/** A straight run of leaves, the shape a layout is easiest to get wrong on last. */
export const STRAIGHT = workflow('straight', {
  steps: [
    { id: 's1', use: 'component.email.fetch', with: {} },
    { id: 's2', use: 'component.agent.act', with: {} },
    { id: 's3', use: 'component.email.send', with: {} },
  ],
})

/** Containers holding regions with nothing in them, and a Fork of three. */
export const EMPTY_REGIONS = workflow('empty regions', {
  steps: [
    { id: 'try_nothing', use: 'core.try', with: {}, steps: [], handler: [] },
    {
      id: 'wide',
      use: 'core.fork',
      with: { mode: 'parallel' },
      branches: [
        { label: 'One', steps: [{ id: 'a', use: 'core.end' }] },
        { label: 'Two', steps: [] },
        {
          label: 'Three',
          steps: [
            { id: 'b', use: 'core.repeat', until: '{{var.done}}', steps: [] },
            { id: 'c', use: 'core.end' },
          ],
        },
      ],
    },
  ],
})

/** Deep nesting: a loop inside a handler inside a branch inside a loop. */
export const DEEP = workflow('deep', {
  steps: [
    {
      id: 'outer',
      use: 'core.repeat',
      until: '{{var.done}}',
      steps: [
        {
          id: 'pick',
          use: 'core.fork',
          with: { mode: 'condition' },
          branches: [
            {
              label: 'Risky',
              when: '{{var.risky}}',
              steps: [
                {
                  id: 'attempt',
                  use: 'core.try',
                  with: { attempts: 2 },
                  steps: [{ id: 'call', use: 'block.alpha', with: {} }],
                  handler: [
                    {
                      id: 'sweep',
                      use: 'core.for_each',
                      with: { list: '{{steps.attempt.error.items}}' },
                      steps: [{ id: 'note', use: 'component.email.send', with: {} }],
                    },
                  ],
                },
              ],
            },
            { label: 'Otherwise', steps: [] },
          ],
        },
      ],
    },
  ],
  blocks: [{ id: 'alpha', steps: [{ id: 'ret', use: 'core.return', with: {} }] }],
})

/**
 * One Step carrying Branches, a body and a handler at once.
 *
 * No verb owns all three, and nothing refuses a document that writes them — the
 * schema's step keys are all optional and no rule reads them together. So this
 * is the shape that separates "lay out the regions in hand" from "lay out the
 * regions a Fork has": the second drops two of these three, silently.
 */
export const MIXED_REGIONS = workflow('mixed regions', {
  steps: [
    {
      id: 'confused',
      use: 'core.fork',
      with: { mode: 'condition' },
      branches: [
        { label: 'One', when: '{{var.go}}', steps: [{ id: 'in_branch', use: 'core.end' }] },
        { label: 'Two', steps: [{ id: 'in_other', use: 'core.end' }] },
      ],
      steps: [{ id: 'in_body', use: 'core.end' }],
      handler: [{ id: 'in_handler', use: 'core.end' }],
    },
  ],
})

/**
 * Every shape above, for the properties that must hold of all of them.
 *
 * A property checked against one hand-written example is a property checked
 * against one hand-written example. Iterated rather than repeated, and asserted
 * non-empty where it is iterated, because a list that shrank to nothing makes
 * every property over it pass while checking none.
 */
export const SHAPES: readonly { name: string; doc: WorkflowDefinition }[] = [
  { name: 'all regions', doc: ALL_REGIONS },
  { name: 'two rets', doc: TWO_RETS },
  { name: 'empty board', doc: EMPTY_BOARD },
  { name: 'straight', doc: STRAIGHT },
  { name: 'empty regions', doc: EMPTY_REGIONS },
  { name: 'deep', doc: DEEP },
  { name: 'mixed regions', doc: MIXED_REGIONS },
]

/**
 * The Component Manifests the height rule is read against.
 *
 * A card's meta row is its filled **Slots**, and only a manifest says which keys
 * are Slots — so `core.fork` declaring `fields: []` is the reason a Fork is the
 * short card while a loop is not. Mirrors `conformance/manifest/catalogue.yaml`
 * in the two entries that decide it, rather than inventing a shape the corpus
 * would not recognise.
 */
export const MANIFESTS: ReadonlyMap<string, Manifest> = new Map(
  (
    [
      { kind: 'component', use: 'core.fork', name: 'Branch', fields: [], outputs: [] },
      { kind: 'component', use: 'core.try', name: 'Try', fields: [], outputs: [] },
      { kind: 'component', use: 'core.end', name: 'End', fields: [], outputs: [] },
      { kind: 'component', use: 'core.return', name: 'Return', fields: [], outputs: [] },
      {
        kind: 'component',
        use: 'core.for_each',
        name: 'For each',
        fields: [{ k: 'list', label: 'List', kind: 'ref', req: true }],
        outputs: [],
      },
      {
        kind: 'component',
        use: 'core.repeat',
        name: 'Repeat',
        fields: [{ k: 'until', label: 'Until', kind: 'text' }],
        outputs: [],
      },
      {
        kind: 'component',
        use: 'component.email.fetch',
        name: 'Fetch mail',
        fields: [{ k: 'query', label: 'Query', kind: 'text' }],
        outputs: [],
      },
      {
        kind: 'component',
        use: 'component.email.send',
        name: 'Send email',
        fields: [{ k: 'to', label: 'To', kind: 'text' }],
        outputs: [],
      },
      {
        kind: 'component',
        use: 'component.agent.act',
        name: 'Act',
        fields: [{ k: 'prompt', label: 'Prompt', kind: 'text' }],
        outputs: [],
      },
    ] as Manifest[]
  ).map((manifest) => [manifest.use, manifest]),
)
