import type { Manifest, WorkflowDefinition } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import { indexManifests } from './connections'
import {
  malformedContainers,
  missingRequiredFields,
  unknownComponents,
  validateDefinition,
} from './validity'

/**
 * Whether a Step is filled in enough to run.
 *
 * Every rule here is `blocks: 'publish'` unless it cannot arise from ordinary
 * building, and that is the design rather than a default: ADR-0009 says an
 * error "blocks Publish. Never blocks editing." A half-filled Step is what
 * every Step looks like a second after it is added.
 */

const manifest = (over: Partial<Manifest> & Pick<Manifest, 'use'>): Manifest => ({
  kind: 'component',
  name: over.use,
  fields: [],
  outputs: [],
  ...over,
})

const CATALOGUE = indexManifests([
  manifest({
    use: 'component.email.send',
    fields: [
      { k: 'to', label: 'To', kind: 'text', req: true },
      { k: 'subject', label: 'Subject', kind: 'text', req: true },
      { k: 'cc', label: 'Cc', kind: 'text' },
    ],
  }),
  manifest({
    use: 'notify',
    fields: [
      { k: 'mode', label: 'Mode', kind: 'enum', options: [{ value: 'now', label: 'Now' }] },
      // Shown only while `mode` is `later`, so it is not missing while it is
      // not on screen.
      { k: 'at', label: 'At', kind: 'text', req: true, when: ['mode', 'later'] },
    ],
  }),
  manifest({ use: 'flag', fields: [{ k: 'on', label: 'On', kind: 'bool', req: true }] }),
  manifest({ use: 'headers', fields: [{ k: 'rows', label: 'Rows', kind: 'map', req: true }] }),
  manifest({ use: 'core.fork' }),
  manifest({ use: 'core.for_each' }),
])

const workflow = (steps: WorkflowDefinition['steps']): WorkflowDefinition => ({
  id: 'wf',
  name: 'n',
  version: 1,
  status: 'draft',
  steps,
})

describe('missing required fields', () => {
  it('reports a required field with nothing in it', () => {
    const found = missingRequiredFields(
      workflow([{ id: 's1', use: 'component.email.send', with: { to: 'a@b.c' } }]),
      CATALOGUE,
    )
    expect(found.map((d) => d.fieldKey)).toEqual(['subject'])
    expect(found[0]).toMatchObject({ code: 'FIELD_REQUIRED', blocks: 'publish', stepId: 's1' })
    expect(found[0]?.message).toBe('Subject is required.')
  })

  it('says nothing about an optional field', () => {
    const found = missingRequiredFields(
      workflow([{ id: 's1', use: 'component.email.send', with: { to: 'a', subject: 'b' } }]),
      CATALOGUE,
    )
    expect(found).toEqual([])
  })

  it('treats whitespace as empty, because a space is not an answer', () => {
    const found = missingRequiredFields(
      workflow([{ id: 's1', use: 'component.email.send', with: { to: '   ', subject: 'b' } }]),
      CATALOGUE,
    )
    expect(found.map((d) => d.fieldKey)).toEqual(['to'])
  })

  it('treats `false` as filled in, because "no" is an answer', () => {
    // A bool left off is genuinely unset; a bool set to false is answered, and
    // a falsy check would make "no" impossible to say.
    expect(
      missingRequiredFields(workflow([{ id: 's1', use: 'flag', with: { on: false } }]), CATALOGUE),
    ).toEqual([])
    expect(
      missingRequiredFields(workflow([{ id: 's1', use: 'flag', with: {} }]), CATALOGUE).map(
        (d) => d.fieldKey,
      ),
    ).toEqual(['on'])
  })

  it('ignores a required field its `when` clause is hiding', () => {
    // Marking a Step invalid for a field the user cannot see, let alone fill,
    // is a marker nobody can act on.
    expect(
      missingRequiredFields(
        workflow([{ id: 's1', use: 'notify', with: { mode: 'now' } }]),
        CATALOGUE,
      ),
    ).toEqual([])

    expect(
      missingRequiredFields(
        workflow([{ id: 's1', use: 'notify', with: { mode: 'later' } }]),
        CATALOGUE,
      ).map((d) => d.fieldKey),
    ).toEqual(['at'])
  })

  it('treats an empty list as unfilled, because a map field with no entries says nothing', () => {
    expect(
      missingRequiredFields(
        workflow([{ id: 's1', use: 'headers', with: { rows: [] } }]),
        CATALOGUE,
      ).map((d) => d.fieldKey),
    ).toEqual(['rows'])

    expect(
      missingRequiredFields(
        workflow([
          { id: 's1', use: 'headers', with: { rows: [{ key: 'a', value: 'b', type: 'text' }] } },
        ]),
        CATALOGUE,
      ),
    ).toEqual([])
  })

  it('hides a `when` field whose gating key is not set at all', () => {
    // `with: {}` means `mode` is absent rather than wrong. The field it gates
    // is not on screen, so it is not missing.
    expect(missingRequiredFields(workflow([{ id: 's1', use: 'notify' }]), CATALOGUE)).toEqual([])
  })

  it('reaches Steps nested in Branches and loops', () => {
    const found = missingRequiredFields(
      workflow([
        {
          id: 's1',
          use: 'core.fork',
          branches: [
            { label: 'L', steps: [{ id: 's2', use: 'component.email.send' }] },
            {
              label: 'R',
              steps: [
                {
                  id: 's3',
                  use: 'core.for_each',
                  steps: [{ id: 's4', use: 'component.email.send' }],
                },
              ],
            },
          ],
        },
      ]),
      CATALOGUE,
    )
    expect([...new Set(found.map((d) => d.stepId))].sort()).toEqual(['s2', 's4'])
  })

  it('checks Triggers too, because their fields are required the same way', () => {
    const doc = workflow([])
    doc.triggers = [{ id: 't1', use: 'component.email.send' }]
    const found = missingRequiredFields(doc, CATALOGUE)

    // Under `triggerId`, not `stepId`: a Trigger is not a Step, and the region
    // that draws Step diagnostics looks up Step ids.
    expect(found.map((d) => d.triggerId)).toEqual(['t1', 't1'])
    expect(found.every((d) => d.stepId === undefined)).toBe(true)
  })

  it('says nothing about a Step whose Component is unknown', () => {
    // Its own rule reports that once. Guessing that every field is missing
    // would bury the one diagnostic that explains the rest.
    expect(missingRequiredFields(workflow([{ id: 's1', use: 'nope' }]), CATALOGUE)).toEqual([])
  })
})

describe('unknown components', () => {
  it('reports a verb no manifest declares, and blocks editing', () => {
    // Unreachable by building — the Library only offers what the catalogue
    // declares — so it means a hand-edit or a Host that dropped a component.
    const found = unknownComponents(workflow([{ id: 's1', use: 'ghost.act' }]), CATALOGUE)
    expect(found[0]).toMatchObject({ code: 'COMPONENT_UNKNOWN', blocks: 'edit', stepId: 's1' })
    expect(found[0]?.message).toMatch(/ghost\.act/)
  })

  it('says nothing when every verb is declared', () => {
    expect(
      unknownComponents(workflow([{ id: 's1', use: 'component.email.send' }]), CATALOGUE),
    ).toEqual([])
  })
})

describe('the two structural verbs', () => {
  it('wants two Branches on a fork, because one is not a choice', () => {
    const found = malformedContainers(
      workflow([{ id: 's1', use: 'core.fork', branches: [{ label: 'only', steps: [] }] }]),
    )
    expect(found[0]).toMatchObject({ code: 'FORK_NEEDS_TWO_BRANCHES', blocks: 'publish' })
    expect(found[0]?.message).toMatch(/at least two branches/)
  })

  it('says something different when a fork has no Branches at all', () => {
    const found = malformedContainers(workflow([{ id: 's1', use: 'core.fork' }]))
    expect(found[0]).toMatchObject({ code: 'FORK_HAS_NO_BRANCHES', blocks: 'publish' })
    expect(found[0]?.message).toMatch(/no branches/)
  })

  it('accepts a fork with two Branches', () => {
    expect(
      malformedContainers(
        workflow([
          {
            id: 's1',
            use: 'core.fork',
            branches: [
              { label: 'A', when: '{{ x }}', steps: [] },
              { label: 'B', steps: [] },
            ],
          },
        ]),
      ),
    ).toEqual([])
  })

  it('reports a condition Branch that makes everything after it unreachable', () => {
    // First match wins, so an unconditional branch before the end swallows
    // every branch after it.
    const found = malformedContainers(
      workflow([
        {
          id: 's1',
          use: 'core.fork',
          branches: [
            { label: 'A', when: '{{ x }}', steps: [] },
            { label: 'catch all', steps: [] },
            { label: 'C', when: '{{ y }}', steps: [] },
          ],
        },
      ]),
    )
    expect(found.map((d) => d.code)).toEqual(['BRANCH_UNREACHABLE_AFTER'])
    expect(found[0]?.message).toMatch(/"catch all"/)
  })

  it('leaves a Branch whose condition is unwritten reachable, and its siblings too', () => {
    // `when: ""` is a condition nobody has written yet, not its absence — the
    // distinction the schema draws. Read as the fallback it swallows every
    // Branch after it, and a Fork born from the catalogue reports against
    // itself the moment it is added.
    expect(
      malformedContainers(
        workflow([
          {
            id: 's1',
            use: 'core.fork',
            branches: [
              { label: 'A', when: '{{ x }}', steps: [] },
              { label: 'Condition', when: '', steps: [] },
              { label: 'Otherwise', steps: [] },
            ],
          },
        ]),
      ).map((d) => d.code),
    ).toEqual([])
  })

  it('allows the LAST Branch to be unconditional, which is the fallback', () => {
    expect(
      malformedContainers(
        workflow([
          {
            id: 's1',
            use: 'core.fork',
            branches: [
              { label: 'A', when: '{{ x }}', steps: [] },
              { label: 'otherwise', steps: [] },
            ],
          },
        ]),
      ),
    ).toEqual([])
  })

  it('says nothing about a parallel fork, where no Branch carries a condition', () => {
    expect(
      malformedContainers(
        workflow([
          {
            id: 's1',
            use: 'core.fork',
            branches: [
              { label: 'A', steps: [] },
              { label: 'B', steps: [] },
            ],
          },
        ]),
      ),
    ).toEqual([])
  })

  it('reports a loop with nothing inside it', () => {
    const found = malformedContainers(workflow([{ id: 's1', use: 'core.for_each', steps: [] }]))
    expect(found[0]).toMatchObject({ code: 'LOOP_HAS_NO_BODY', blocks: 'publish' })
  })

  it('accepts a loop with a body', () => {
    expect(
      malformedContainers(
        workflow([
          { id: 's1', use: 'core.for_each', steps: [{ id: 's2', use: 'component.email.send' }] },
        ]),
      ),
    ).toEqual([])
  })

  it('says nothing about an empty Branch, which is a legitimate design', () => {
    // "Do nothing on this path" is what an `else` that exists so the other
    // branch does not run means. Flagging it would put a permanent error on a
    // finished, correct workflow — which is how a marker stops being read.
    expect(
      malformedContainers(
        workflow([
          {
            id: 's1',
            use: 'core.fork',
            branches: [
              { label: 'A', when: '{{ x }}', steps: [{ id: 's2', use: 'component.email.send' }] },
              { label: 'otherwise', steps: [] },
            ],
          },
        ]),
      ),
    ).toEqual([])
  })
})

describe('validateDefinition', () => {
  it('indexes every rule by the Step it belongs to', () => {
    const { byStep } = validateDefinition(
      workflow([
        { id: 's1', use: 'component.email.send', with: { to: 'a' } },
        { id: 's2', use: 'core.fork', branches: [{ label: 'only', steps: [] }] },
        { id: 's3', use: 'ghost.act' },
        { id: 's4', use: 'component.email.send', with: { to: 'a', subject: 'b' } },
      ]),
      CATALOGUE,
    )

    expect([...byStep.keys()].sort()).toEqual(['s1', 's2', 's3'])
    expect(byStep.get('s1')?.map((d) => d.code)).toEqual(['FIELD_REQUIRED'])
    expect(byStep.get('s2')?.map((d) => d.code)).toEqual(['FORK_NEEDS_TWO_BRANCHES'])
    // A Step with nothing wrong is absent, not present with an empty list.
    expect(byStep.has('s4')).toBe(false)
  })

  it('collects several problems on one Step', () => {
    const { byStep } = validateDefinition(
      workflow([{ id: 's1', use: 'component.email.send' }]),
      CATALOGUE,
    )
    expect(byStep.get('s1')).toHaveLength(2)
  })

  it('is empty for a workflow with nothing wrong', () => {
    const validity = validateDefinition(
      workflow([{ id: 's1', use: 'component.email.send', with: { to: 'a', subject: 'b' } }]),
      CATALOGUE,
    )
    expect(validity.byStep.size).toBe(0)
    expect(validity.byTrigger.size).toBe(0)
    expect(validity.all).toEqual([])
  })

  /*
   * A Trigger is not a Step, and the two are drawn by different regions. Filed
   * together, a Trigger's diagnostic is either rendered by nobody — the Flow
   * tab looks up Step ids — or, when a hand-edited Trigger id matches a Step's,
   * painted on that Step's row.
   */
  it('keeps Trigger diagnostics out of the Step map', () => {
    const doc = {
      ...workflow([{ id: 's1', use: 'component.email.send', with: { to: 'a', subject: 'b' } }]),
      triggers: [
        { id: 't1', use: 'ghost.received' },
        { id: 's1', use: 'ghost.received' },
      ],
    }

    const { byStep, byTrigger, all } = validateDefinition(doc, CATALOGUE)

    expect(byStep.size).toBe(0)
    expect([...byTrigger.keys()].sort()).toEqual(['s1', 't1'])
    expect(byTrigger.get('t1')?.map((d) => d.code)).toEqual(['COMPONENT_UNKNOWN'])
    // And nothing is lost on the way: flattening `byStep` alone would drop both.
    expect(all).toHaveLength(2)
  })
})
