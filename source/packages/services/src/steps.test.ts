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

  /*
   * A Board that is gone holds no Steps. `boardPath` throws for one, which is
   * right for a command — an edit aimed at a Board that is not there must
   * refuse rather than land somewhere else — and wrong for a reader: this one
   * is called synchronously inside a click handler with nothing to catch it,
   * so a Board deleted under a caller still holding its id threw out of an
   * event instead of appending.
   */
  it('answers 0 for a Board the document does not declare, rather than throwing', () => {
    const document = parse(VALID)
    expect(() => rootStepCount(document, 'nowhere')).not.toThrow()
    expect(rootStepCount(document, 'nowhere')).toBe(0)
  })

  it('still counts a Block that IS there, which is the point of taking a Board', () => {
    const withBlock = parse(
      'id: wf\nname: n\nversion: 1\nstatus: draft\nsteps: []\nblocks:\n  - id: b\n    steps:\n      - id: one\n        use: a\n      - id: two\n        use: a\n',
    )
    expect(rootStepCount(withBlock, 'b')).toBe(2)
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

describe('reaching into a document that is barely one', () => {
  /*
   * The AST helpers are shared by every command, so their edges are reachable
   * from all of them. ADR-0001 requires each to survive a document someone is
   * halfway through typing.
   */
  it('merges a comment on the sequence with one on its first item', () => {
    // A comment above the FIRST item of a block sequence is anchored to the
    // sequence, so when the item has one too both have to survive the splice —
    // the user wrote two lines and gets to keep both.
    const both = [
      'id: wf',
      'name: n',
      'version: 1',
      'status: draft',
      'steps:',
      '  # about the list',
      '  # about this step',
      '  - id: s1',
      '    use: a',
      '',
    ].join('\n')

    const document = parse(both)
    removeStep({ board: null, id: 's1' }).apply(document)

    const text = document.toString()
    expect(text).not.toContain('about this step')
    expect(text).not.toContain('about the list')
  })

  it('keeps both comments when a Step is added above them', () => {
    const both = [
      'id: wf',
      'name: n',
      'version: 1',
      'status: draft',
      'steps:',
      '  # about the list',
      '  # about this step',
      '  - id: s1',
      '    use: a',
      '',
    ].join('\n')

    const document = parse(both)
    addStep({ use: 'component.email.send' }, { index: 0 }).apply(document)

    const text = document.toString()
    expect(text).toContain('# about the list')
    expect(text).toContain('# about this step')
  })

  it('refuses to detach an index the list does not have', () => {
    // Reachable from a stale projection: the tree a caller built its index
    // against has moved on, and splicing at a position past the end would take
    // nothing out and report success.
    const document = parse(VALID)
    expect(() => removeStep({ board: null, id: 's99' }).apply(document)).toThrow(/No Step with id/)
    expect(document.toString()).toBe(VALID)
  })

  it('refuses a document that is not a mapping, and leaves it alone', () => {
    // `- just\n- a list` parses, so it opens and a command can be run against
    // it. A top-level SEQUENCE carries an `items` array exactly as a mapping
    // does, so reading it as pairs would splice a `Pair` into a sequence — the
    // same corruption as the other way round, surfacing from a `toString()` no
    // caller guards.
    const source = '- just\n- a list\n'
    const document = parse(source)

    expect(() => addStep({ use: 'component.email.send' }, { index: 0 }).apply(document)).toThrow()
    expect(document.toString()).toBe(source)
  })
})

describe('a list that is not a list', () => {
  /*
   * A YAMLMap carries an `items` array exactly as a YAMLSeq does, so a sequence
   * cannot be recognised by shape: `steps:` written as a mapping would pass,
   * and the node spliced into it makes the document unserialisable — the error
   * arriving from `toString()`, which no caller guards, rather than from the
   * command.
   *
   * A mapping under `steps:` is a document someone halfway through typing in
   * Text Mode has, and ADR-0001 requires the commands to survive it.
   */
  const MAPPING = 'id: wf\nname: n\nversion: 1\nstatus: draft\nsteps:\n  first: nope\n'

  it('refuses to add into it, and leaves the text untouched', () => {
    const document = parse(MAPPING)
    expect(() => addStep({ use: 'component.email.send' }, { index: 0 }).apply(document)).toThrow(
      /not a list/,
    )
    expect(document.toString()).toBe(MAPPING)
  })

  it('still serialises afterwards, which is the failure worth preventing', () => {
    const document = parse(MAPPING)
    try {
      addStep({ use: 'component.email.send' }, { index: 0 }).apply(document)
    } catch {
      // The command refuses; what matters is the state it left behind.
    }
    expect(() => document.toString()).not.toThrow()
  })

  it('counts no Steps in it rather than guessing', () => {
    expect(rootStepCount(parse(MAPPING))).toBe(0)
  })

  it('refuses an empty mapping too, which no shape check can tell from `[]`', () => {
    const empty = 'id: wf\nname: n\nversion: 1\nstatus: draft\nsteps: {}\n'
    const document = parse(empty)
    expect(() => addStep({ use: 'component.email.send' }, { index: 0 }).apply(document)).toThrow(
      /not a list/,
    )
    expect(document.toString()).toBe(empty)
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
    addStep({ use: 'component.email.send' }, { index: 1 }).apply(doc)

    expect(doc.toString()).toContain('use: component.email.send')
    expect(doc.validate().success).toBe(false)
  })

  it('creates the `steps:` key when the document has none', () => {
    const doc = parse('name: nothing here yet\n')
    addStep({ use: 'component.email.send' }, { index: 0 }).apply(doc)
    expect(doc.toString()).toContain('steps:')
    expect(doc.toString()).toContain('use: component.email.send')
  })

  it('removes one from such a document', () => {
    const doc = parse('name: half\nsteps:\n  - id: s1\n    use: a\n  - id: s2\n    use: b\n')
    removeStep({ board: null, id: 's1' }).apply(doc)
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
    addStep({ use: 'component.email.send', name: 'Reply' }, { index: 0 }).apply(doc)
    const text = doc.toString()
    expect(text.indexOf('id: s3')).toBeLessThan(text.indexOf('use: component.email.send'))
    expect(text.indexOf('use: component.email.send')).toBeLessThan(text.indexOf('name: Reply'))
  })

  it('omits `name` entirely when there is none, rather than writing an empty one', () => {
    const doc = parse(VALID)
    addStep({ use: 'component.email.send' }, { index: 0 }).apply(doc)
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
    expect(() => moveStep({ board: null, id: 's99' }, { index: 0 }).apply(parse(VALID))).toThrow(
      /No Step with id/,
    )
  })

  it('throws when removing a Step that is not there', () => {
    expect(() => removeStep({ board: null, id: 's99' }).apply(parse(VALID))).toThrow(
      /No Step with id/,
    )
  })

  it('leaves the document untouched when it refuses', () => {
    // The store relies on this: it catches the throw and records nothing, which
    // is only safe because every command does its lookups before its first
    // mutation. Half-applied is the failure worth preventing.
    const doc = parse(VALID)
    const before = doc.toString()
    expect(() => removeStep({ board: null, id: 's99' }).apply(doc)).toThrow()
    expect(doc.toString()).toBe(before)
  })
})

describe('labels', () => {
  it('names the Component when the Step has no name of its own', () => {
    expect(addStep({ use: 'component.email.send' }, { index: 0 }).label).toBe(
      'Add component.email.send',
    )
    expect(addStep({ use: 'component.email.send', name: 'Reply' }, { index: 0 }).label).toBe(
      'Add Reply',
    )
    expect(removeStep({ board: null, id: 's1' }).label).toBe('Remove s1')
    expect(moveStep({ board: null, id: 's1' }, { index: 0 }).label).toBe('Move s1')
  })
})

describe('formatting the user chose', () => {
  it('writes block style into an empty `steps: []`, like every sibling', () => {
    // Splicing into a flow-style sequence keeps flow style, so the first Step
    // added to an empty Branch would re-serialise the whole subtree onto one
    // line beside siblings written in block.
    const doc = parse(
      'id: w\nname: n\nversion: 1\nstatus: draft\nsteps:\n  - id: s1\n    use: core.fork\n    branches:\n      - label: A\n        steps:\n          - id: s2\n            use: a\n      - label: Otherwise\n        steps: []\n',
    )
    addStep({ use: 'component.email.send' }, { parentId: 's1', branchIndex: 1, index: 0 }).apply(
      doc,
    )

    expect(doc.toString()).not.toContain('[')
    expect(doc.toString()).toContain('        steps:\n          - id: s3')
  })

  it('leaves a comment on a flow-style list at the list level', () => {
    // A flow list keeps its comment at the list level whatever happens to its
    // items. Re-anchoring one onto an item changes what it is about, and
    // forces the list to break across lines.
    const doc = parse(
      'id: w\nname: n\nversion: 1\nstatus: draft\nsteps:\n  # note\n  [{ id: s1, use: a }, { id: s2, use: b }]\n',
    )
    addStep({ use: 'c' }, { index: 0 }).apply(doc)

    const text = doc.toString()
    expect(text).toContain('# note')
    expect(text.indexOf('# note')).toBeLessThan(text.indexOf('['))
  })

  it('keeps a flow list’s comment when its only Step is removed', () => {
    const doc = parse(
      'id: w\nname: n\nversion: 1\nstatus: draft\nsteps:\n  # note\n  [{ id: s1, use: a }]\n',
    )
    removeStep({ board: null, id: 's1' }).apply(doc)
    expect(doc.toString()).toContain('# note')
  })

  it('leaves a flow-style list the user filled in alone', () => {
    // Hatua does not own the file's formatting (ADR-0001). An empty `[]` is not
    // a formatting choice about content there is none of; a populated one is.
    const doc = parse('id: w\nname: n\nversion: 1\nstatus: draft\nsteps: [{ id: s1, use: a }]\n')
    addStep({ use: 'b' }, { index: 1 }).apply(doc)
    expect(doc.toString()).toContain('[')
  })
})

describe('a comment stays with the Step it describes', () => {
  /*
   * A comment above the FIRST item of a block sequence is anchored to the
   * sequence rather than the item, so a splice at index 0 leaves it behind to
   * label whatever moves up. The user wrote it about a Step, in a file that
   * lives in their repository.
   */
  const COMMENTED =
    'id: w\nname: n\nversion: 1\nstatus: draft\nsteps:\n  # about s1\n  - id: s1\n    use: a\n  # about s2\n  - id: s2\n    use: b\n'

  it('takes the first Step’s comment with it when it moves', () => {
    const doc = parse(COMMENTED)
    moveStep({ board: null, id: 's1' }, { index: 2 }).apply(doc)

    const text = doc.toString()
    expect(text.indexOf('# about s2')).toBeLessThan(text.indexOf('id: s2'))
    expect(text.indexOf('id: s2')).toBeLessThan(text.indexOf('# about s1'))
    expect(text.indexOf('# about s1')).toBeLessThan(text.indexOf('id: s1'))
  })

  it('takes it away when the first Step is removed', () => {
    const doc = parse(COMMENTED)
    removeStep({ board: null, id: 's1' }).apply(doc)

    const text = doc.toString()
    expect(text).not.toContain('# about s1')
    expect(text.indexOf('# about s2')).toBeLessThan(text.indexOf('id: s2'))
  })

  it('leaves it on its own Step when another is inserted above', () => {
    const doc = parse(COMMENTED)
    addStep({ use: 'new' }, { index: 0 }).apply(doc)

    const text = doc.toString()
    expect(text.indexOf('use: new')).toBeLessThan(text.indexOf('# about s1'))
    expect(text.indexOf('# about s1')).toBeLessThan(text.indexOf('id: s1'))
  })

  it('keeps every other Step’s comment where it was', () => {
    const doc = parse(COMMENTED)
    moveStep({ board: null, id: 's2' }, { index: 0 }).apply(doc)

    const text = doc.toString()
    expect(text.indexOf('# about s2')).toBeLessThan(text.indexOf('id: s2'))
    expect(text.indexOf('# about s1')).toBeLessThan(text.indexOf('id: s1'))
  })
})
