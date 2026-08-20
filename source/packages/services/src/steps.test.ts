import { parseWorkflow } from '@hatua/document'
import type { Step } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import { addStep, moveStep, removeStep, rootStepCount, stepIn } from './steps'

/**
 * The commands and the two readers, against a document directly.
 *
 * `editing.test.ts` drives these through the store, which is how a region uses
 * them; this file is for what the store cannot reach — a document that does not
 * project, and the readers a caller uses without a store at all.
 */

const parse = (yaml: string) => parseWorkflow(yaml)

const VALID = `id: wf\nname: n\nversion: 1\nstatus: draft\nsteps:\n  - id: s1\n    use: a\n  - id: s2\n    use: b\n`

describe('rootStepCount', () => {
  it('counts the root sequence', () => {
    expect(rootStepCount(parse(VALID))).toBe(2)
  })

  it('counts a document that does NOT project, which is the whole reason it exists', () => {
    // `definition?.steps.length ?? 0` answers 0 here — the same answer it gives
    // for an empty workflow — so a caller appending at that index prepends
    // instead. This reads the loose projection every command reads.
    const half = parse('name: half written\nsteps:\n  - use: a\n  - use: b\n  - use: c\n')
    expect(half.validate().success).toBe(false)
    expect(rootStepCount(half)).toBe(3)
  })

  it('answers 0 for a workflow with no Steps, and for one with no `steps:` key', () => {
    expect(rootStepCount(parse('id: wf\nname: n\nversion: 1\nstatus: draft\nsteps: []\n'))).toBe(0)
    expect(rootStepCount(parse('name: nothing\n'))).toBe(0)
  })

  it('answers 0 when `steps:` is not a list at all', () => {
    expect(rootStepCount(parse('steps: not a list\n'))).toBe(0)
  })

  it('answers 0 for a document that is not a mapping', () => {
    expect(rootStepCount(parse('- just\n- a list\n'))).toBe(0)
  })
})

describe('stepIn', () => {
  const STEPS: Step[] = [
    { id: 's1', use: 'a' },
    {
      id: 's2',
      use: 'core.fork',
      branches: [
        { label: 'L', steps: [{ id: 's3', use: 'c' }] },
        {
          label: 'R',
          steps: [{ id: 's4', use: 'core.for_each', steps: [{ id: 's5', use: 'e' }] }],
        },
      ],
    },
  ]

  it('finds a Step at the root', () => {
    expect(stepIn(STEPS, 's1')?.use).toBe('a')
  })

  it('finds one inside a Branch', () => {
    expect(stepIn(STEPS, 's3')?.use).toBe('c')
  })

  it('finds one nested in a loop inside a Branch', () => {
    expect(stepIn(STEPS, 's5')?.use).toBe('e')
  })

  it('returns undefined rather than throwing when there is no such Step', () => {
    expect(stepIn(STEPS, 's99')).toBeUndefined()
    expect(stepIn([], 's1')).toBeUndefined()
  })
})

describe('commands against a document that does not project', () => {
  /*
   * The state ADR-0001 forces on everything here: `toJSON()` throws while the
   * source is not a valid Workflow Definition, which is exactly what someone
   * mid-edit in Text Mode has. A command that only worked on documents that
   * already validate would be unusable in the one situation a user needs the
   * editor for.
   */
  it('adds a Step to a document with no `id` or `version` yet', () => {
    const doc = parse('name: half written\nsteps:\n  - id: s1\n    use: a\n')
    addStep({ use: 'email.send' }, { index: 1 }).apply(doc)

    expect(doc.toString()).toContain('use: email.send')
    expect(doc.validate().success).toBe(false)
  })

  it('creates the `steps:` key when the document has none', () => {
    const doc = parse('name: nothing here yet\n')
    addStep({ use: 'email.send' }, { index: 0 }).apply(doc)
    expect(doc.toString()).toContain('steps:')
    expect(doc.toString()).toContain('use: email.send')
  })

  it('removes one from such a document', () => {
    const doc = parse('name: half\nsteps:\n  - id: s1\n    use: a\n  - id: s2\n    use: b\n')
    removeStep('s1').apply(doc)
    expect(doc.toString()).not.toContain('id: s1')
    expect(doc.toString()).toContain('id: s2')
  })
})

describe('minting ids', () => {
  it('takes the lowest free number, so the same edits give the same document twice', () => {
    // Deterministic rather than random: it is what makes the round-trip tests
    // assertable and a diff in the Host's repository readable.
    const doc = parse(VALID)
    addStep({ use: 'x' }, { index: 2 }).apply(doc)
    addStep({ use: 'y' }, { index: 3 }).apply(doc)
    expect(doc.toString()).toContain('id: s3')
    expect(doc.toString()).toContain('id: s4')
  })

  it('skips ids already taken anywhere in the tree, not just at the root', () => {
    const doc = parse(
      'id: wf\nname: n\nversion: 1\nstatus: draft\nsteps:\n  - id: s1\n    use: core.fork\n    branches:\n      - label: L\n        steps:\n          - id: s2\n            use: b\n',
    )
    addStep({ use: 'x' }, { index: 1 }).apply(doc)
    expect(doc.toString()).toContain('id: s3')
  })

  it('honours an id the caller supplied', () => {
    const doc = parse(VALID)
    addStep({ id: 'chosen', use: 'x' }, { index: 0 }).apply(doc)
    expect(doc.toString()).toContain('id: chosen')
  })

  it('writes `id`, `use` then `name`, because a person reads the diff', () => {
    const doc = parse(VALID)
    addStep({ use: 'email.send', name: 'Reply' }, { index: 0 }).apply(doc)
    const text = doc.toString()
    expect(text.indexOf('id: s3')).toBeLessThan(text.indexOf('use: email.send'))
    expect(text.indexOf('use: email.send')).toBeLessThan(text.indexOf('name: Reply'))
  })

  it('omits `name` entirely when there is none, rather than writing an empty one', () => {
    const doc = parse(VALID)
    addStep({ use: 'email.send' }, { index: 0 }).apply(doc)
    // The workflow's own `name:` is the only one in the file; the new Step
    // brought none with it.
    expect(doc.toString().match(/name:/g)).toHaveLength(1)
  })
})

describe('what a command refuses', () => {
  it('throws when the insertion point names a Step that is not there', () => {
    const doc = parse(VALID)
    expect(() => addStep({ use: 'x' }, { parentId: 's99', index: 0 }).apply(doc)).toThrow(
      /No Step with id "s99"/,
    )
  })

  it('throws when moving a Step that is not there', () => {
    expect(() => moveStep('s99', { index: 0 }).apply(parse(VALID))).toThrow(/No Step with id/)
  })

  it('throws when removing a Step that is not there', () => {
    expect(() => removeStep('s99').apply(parse(VALID))).toThrow(/No Step with id/)
  })

  it('leaves the document untouched when it refuses', () => {
    // The store relies on this: it catches the throw and records nothing, which
    // is only safe because every command does its lookups before its first
    // mutation. Half-applied is the failure worth preventing.
    const doc = parse(VALID)
    const before = doc.toString()
    expect(() => removeStep('s99').apply(doc)).toThrow()
    expect(doc.toString()).toBe(before)
  })
})

describe('labels', () => {
  it('names the Component when the Step has no name of its own', () => {
    expect(addStep({ use: 'email.send' }, { index: 0 }).label).toBe('Add email.send')
    expect(addStep({ use: 'email.send', name: 'Reply' }, { index: 0 }).label).toBe('Add Reply')
    expect(removeStep('s1').label).toBe('Remove s1')
    expect(moveStep('s1', { index: 0 }).label).toBe('Move s1')
  })
})
