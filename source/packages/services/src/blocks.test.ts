import { parseWorkflow } from '@hatua/document'
import { describe, expect, it } from 'vitest'
import {
  addBlock,
  addDeclaration,
  removeBlock,
  removeDeclaration,
  renameBlock,
  setBlockName,
} from './blocks'
import type { EditCommand } from './command'
import { addStep, moveStep, removeStep } from './steps'
import { addVariable, setVariableValue } from './variables'

/**
 * The Block commands against a document directly.
 *
 * The round trip is what is being protected. A Workflow Definition lives in the
 * Host's repository, usually in git, and adding a whole `blocks:` section to a
 * file that has none must leave every comment, key and quotation mark around it
 * exactly as the user wrote them (ADR-0001).
 *
 * The other half is that an edit on a Block's Board is the SAME command as an
 * edit at the root — `addStep` with a board rather than a second function. That
 * is what will let the extract-into-a-block gesture compose from these, and it
 * is why a Block built on the canvas and one written by hand in Text Mode are
 * the same document.
 */

const SOURCE = `# The overnight triage.
id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft

triggers:
  # Weekday mornings only.
  - id: nightly
    use: core.schedule

vars:
  - key: digest_to
    value: "ops@example.com"

steps:
  # Everything starts here.
  - id: s1
    use: component.email.fetch
`

const apply = (yaml: string, ...commands: EditCommand[]) => {
  const document = parseWorkflow(yaml)
  for (const command of commands) command.apply(document)
  return document.toString()
}

const projected = (yaml: string) => {
  const result = parseWorkflow(yaml).validate()
  if (!result.success) throw new Error(`not a Workflow Definition: ${result.error}`)
  return result.data
}

describe('declaring a block', () => {
  it('adds `blocks:` between `vars:` and `steps:`, where the schema puts it', () => {
    const out = apply(SOURCE, addBlock({ id: 'archive_entry', name: 'Archive an entry' }))

    expect(out).toBe(`# The overnight triage.
id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft

triggers:
  # Weekday mornings only.
  - id: nightly
    use: core.schedule

vars:
  - key: digest_to
    value: "ops@example.com"
blocks:
  - id: archive_entry
    name: Archive an entry
    steps: []

steps:
  # Everything starts here.
  - id: s1
    use: component.email.fetch
`)
  })

  /*
   * The whole point of the assertion above, stated on its own so a failure says
   * which property broke: nothing outside the added section moved, and the
   * user's quoting and comments came back as they were written.
   */
  it('leaves every other line byte-identical', () => {
    const out = apply(SOURCE, addBlock({ id: 'b' }))
    const untouched = SOURCE.split('\n').filter((line) => line.trim() !== '')
    for (const line of untouched) expect(out).toContain(line)
    expect(out).toContain('name: "Morning inbox triage"')
    expect(out).toContain('# Weekday mornings only.')
  })

  it('mints an id when none is given, deterministically', () => {
    const once = apply(SOURCE, addBlock())
    expect(once).toContain('- id: block_1')
    expect(apply(once, addBlock())).toContain('- id: block_2')
  })

  it('projects as a Workflow Definition, so the schema accepts what it wrote', () => {
    const out = apply(SOURCE, addBlock({ id: 'archive_entry', name: 'Archive an entry' }))
    expect(projected(out).blocks).toEqual([
      { id: 'archive_entry', name: 'Archive an entry', steps: [] },
    ])
  })

  it('removes one, leaving the rest of the file alone', () => {
    const with_ = apply(SOURCE, addBlock({ id: 'a' }), addBlock({ id: 'b' }))
    const out = apply(with_, removeBlock('a'))

    expect(projected(out).blocks?.map((block) => block.id)).toEqual(['b'])
    expect(out).toContain('# Everything starts here.')
  })

  /* A call site is a `use:` like any other: it goes stale and is reported. */
  it('does not rewrite call sites when a block is renamed', () => {
    const built = apply(
      SOURCE,
      addBlock({ id: 'archive' }),
      addStep({ use: 'block.archive', id: 'call' }, { index: 1 }),
    )
    const out = apply(built, renameBlock('archive', 'archive_entry'))

    expect(out).toContain('use: block.archive\n')
    expect(projected(out).blocks?.[0]?.id).toBe('archive_entry')
  })

  it('sets a display name, which nothing references', () => {
    const out = apply(SOURCE, addBlock({ id: 'a' }), setBlockName('a', 'Archive an entry'))
    expect(projected(out).blocks?.[0]?.name).toBe('Archive an entry')
  })
})

describe('the contract a block declares', () => {
  const withBlock = (...commands: EditCommand[]) =>
    apply(SOURCE, addBlock({ id: 'archive' }), ...commands)

  it('adds a parameter, creating `params:` in its documented position', () => {
    const out = withBlock(
      addDeclaration('archive', 'params', { k: 'entry', label: 'Entry', t: 'object' }),
    )
    const block = projected(out).blocks?.[0]

    expect(block?.params).toEqual([{ k: 'entry', label: 'Entry', t: 'object' }])
    // `params:` before `steps:`, the way the schema documents a block.
    expect(out.indexOf('params:')).toBeLessThan(out.indexOf('steps: []'))
  })

  it('keeps a nested shape, which is what types a member of a parameter', () => {
    const out = withBlock(
      addDeclaration('archive', 'params', {
        k: 'entry',
        label: 'Entry',
        t: 'object',
        of: [{ k: 'headline', label: 'Headline', t: 'text' }],
      }),
    )
    expect(projected(out).blocks?.[0]?.params?.[0]?.of).toEqual([
      { k: 'headline', label: 'Headline', t: 'text' },
    ])
  })

  it('adds outputs in declaration order, because a call site draws them in it', () => {
    const out = withBlock(
      addDeclaration('archive', 'outputs', { k: 'url', label: 'URL', t: 'text' }),
      addDeclaration('archive', 'outputs', { k: 'at', label: 'At', t: 'datetime' }),
    )
    expect(projected(out).blocks?.[0]?.outputs?.map((o) => o.k)).toEqual(['url', 'at'])
  })

  it('removes one, and refuses a key it cannot find', () => {
    const built = withBlock(
      addDeclaration('archive', 'params', { k: 'entry', label: 'Entry', t: 'object' }),
      addDeclaration('archive', 'params', { k: 'at', label: 'At', t: 'datetime' }),
    )
    const out = apply(built, removeDeclaration('archive', 'params', 'entry'))

    expect(projected(out).blocks?.[0]?.params?.map((p) => p.k)).toEqual(['at'])
    expect(() => apply(out, removeDeclaration('archive', 'params', 'entry'))).toThrow(
      /No "entry" declared/,
    )
  })
})

describe('editing on a block’s board', () => {
  const built = apply(
    SOURCE,
    addBlock({ id: 'archive' }),
    addStep({ use: 'component.s3.upload', id: 'put' }, { board: 'archive', index: 0 }),
    addStep({ use: 'core.return', id: 'ret' }, { board: 'archive', index: 1 }),
  )

  it('is the same command as editing at the root, with a board on it', () => {
    const block = projected(built).blocks?.[0]
    expect(block?.steps.map((step) => step.id)).toEqual(['put', 'ret'])
    // And the root is untouched by any of it.
    expect(projected(built).steps.map((step) => step.id)).toEqual(['s1'])
  })

  /*
   * Ids are Board-local, so minting reads the Board rather than the document. A
   * block's first Step is `s1` even though the root already has one — a name
   * nobody chose about a tree nobody is looking at is the alternative.
   */
  it('mints an id against the board, not the whole document', () => {
    const out = apply(
      SOURCE,
      addBlock({ id: 'archive' }),
      addStep(
        { use: 'core.fork' },
        {
          board: 'archive',
          index: 0,
        },
      ),
    )
    expect(projected(out).blocks?.[0]?.steps[0]?.id).toBe('s1')
    expect(projected(out).steps[0]?.id).toBe('s1')
  })

  it('moves a Step within a block without touching the root', () => {
    const out = apply(
      built,
      moveStep({ board: 'archive', id: 'ret' }, { board: 'archive', index: 0 }),
    )
    expect(projected(out).blocks?.[0]?.steps.map((step) => step.id)).toEqual(['ret', 'put'])
    expect(projected(out).steps.map((step) => step.id)).toEqual(['s1'])
  })

  it('removes a Step from a block, and refuses one the board does not hold', () => {
    const out = apply(built, removeStep({ board: 'archive', id: 'put' }))
    expect(projected(out).blocks?.[0]?.steps.map((step) => step.id)).toEqual(['ret'])
    expect(() => apply(built, removeStep({ board: 'archive', id: 's1' }))).toThrow(/No Step/)
  })

  /* A step id repeated across two boards is two Steps, not one. */
  it('addresses two Steps that share an id by their boards', () => {
    const twice = apply(
      SOURCE,
      addBlock({ id: 'a' }),
      addBlock({ id: 'b' }),
      addStep({ use: 'core.return', id: 'ret' }, { board: 'a', index: 0 }),
      addStep({ use: 'core.return', id: 'ret' }, { board: 'b', index: 0 }),
    )
    const out = apply(twice, removeStep({ board: 'a', id: 'ret' }))
    const blocks = projected(out).blocks

    expect(blocks?.[0]?.steps).toEqual([])
    expect(blocks?.[1]?.steps.map((step) => step.id)).toEqual(['ret'])
  })

  it('refuses a board nothing declares', () => {
    expect(() =>
      apply(SOURCE, addStep({ use: 'core.fork' }, { board: 'nowhere', index: 0 })),
    ).toThrow(/No block with id "nowhere"/)
  })
})

describe('a block’s own variables', () => {
  it('writes them inside the block, never into the workflow’s', () => {
    const out = apply(
      SOURCE,
      addBlock({ id: 'archive' }),
      addVariable('attempt_note', 'archive'),
      setVariableValue('attempt_note', 'first pass', 'archive'),
    )

    expect(projected(out).blocks?.[0]?.vars).toEqual([{ key: 'attempt_note', value: 'first pass' }])
    // The workflow's own list is untouched, which is the lifetime difference:
    // a block's vars are rebuilt on every invocation.
    expect(projected(out).vars).toEqual([{ key: 'digest_to', value: 'ops@example.com' }])
  })

  it('puts `vars:` before `steps:` inside the block', () => {
    const out = apply(SOURCE, addBlock({ id: 'archive' }), addVariable('note', 'archive'))
    const block = out.slice(out.indexOf('blocks:'), out.indexOf('\nsteps:'))
    expect(block.indexOf('vars:')).toBeLessThan(block.indexOf('steps:'))
  })

  it('still edits the workflow’s variables when no board is named', () => {
    const out = apply(SOURCE, addVariable('threshold'))
    expect(projected(out).vars?.map((v) => v.key)).toEqual(['digest_to', 'threshold'])
  })
})
