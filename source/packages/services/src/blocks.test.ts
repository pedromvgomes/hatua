import { parseWorkflow } from '@hatua/document'
import { describe, expect, it } from 'vitest'
import {
  addBlock,
  addDeclaration,
  extractBlock,
  nextBlockId,
  removeBlock,
  removeDeclaration,
  renameBlock,
  renameDeclaration,
  setBlockName,
  setDeclarationLabel,
  setDeclarationType,
} from './blocks'
import type { EditCommand } from './command'
import { addStep, moveStep, removeStep } from './steps'
import { addVariable, removeVariable, renameVariable, setVariableValue } from './variables'

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
    t: text
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
    t: text
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

  /*
   * A rename repairs what it invalidates (ADR-0021). A slug renamed without its
   * call sites is a Block nothing resolves, which every reader here — the canvas
   * included — reads as a deleted one.
   */
  it('rewrites every call site when a block is renamed', () => {
    const built = apply(
      SOURCE,
      addBlock({ id: 'archive' }),
      addStep({ use: 'block.archive', id: 'call' }, { index: 1 }),
      addStep({ use: 'block.archive', id: 'again' }, { index: 2 }),
    )
    const out = apply(built, renameBlock('archive', 'archive_entry'))

    expect(out).not.toContain('use: block.archive\n')
    expect(out.match(/use: block\.archive_entry/g)).toHaveLength(2)
    expect(projected(out).blocks?.[0]?.id).toBe('archive_entry')
  })

  /* A Block may be called from another Block's Board, so the reach is the whole
     document rather than the root's Steps. */
  it('rewrites a call site that sits on another block’s Board', () => {
    const built = apply(
      SOURCE,
      addBlock({ id: 'archive' }),
      addBlock({ id: 'outer' }),
      addStep({ use: 'block.archive', id: 'call' }, { board: 'outer', index: 0 }),
    )
    const out = apply(built, renameBlock('archive', 'kept'))

    expect(out).toContain('use: block.kept')
    expect(out).not.toContain('use: block.archive')
  })

  /* A verb that merely begins the same way is a different Block. */
  it('leaves a call site whose slug only starts with the renamed one', () => {
    const built = apply(
      SOURCE,
      addBlock({ id: 'arch' }),
      addBlock({ id: 'archive' }),
      addStep({ use: 'block.archive', id: 'call' }, { index: 1 }),
    )
    const out = apply(built, renameBlock('arch', 'stored'))

    expect(out).toContain('use: block.archive')
  })

  /*
   * The collision throws before anything is rewritten, so a refused rename
   * leaves every call site naming the Block it still names.
   */
  it('leaves call sites alone when the rename is refused', () => {
    const built = apply(
      SOURCE,
      addBlock({ id: 'a' }),
      addBlock({ id: 'b' }),
      addStep({ use: 'block.b', id: 'call' }, { index: 1 }),
    )
    // Inspected after the throw rather than through `apply`, which rethrows:
    // what is being protected is the document the command left behind, and
    // `EditingStore` restores its text only because a command may not.
    const document = parseWorkflow(built)
    expect(() => renameBlock('b', 'a').apply(document)).toThrow(/already exists/)
    expect(document.toString()).toContain('use: block.b')
  })

  /*
   * Two blocks under one id is worse than a refused rename: every reader takes
   * the first, so the second block's Board opens on the first's steps and
   * `removeBlock` deletes the wrong one — long before BLOCK_ID_DUPLICATE stops
   * a Publish.
   */
  it('refuses a rename onto an id another block already holds', () => {
    const built = apply(SOURCE, addBlock({ id: 'a' }), addBlock({ id: 'b' }))
    expect(() => apply(built, renameBlock('b', 'a'))).toThrow(/already exists/)
  })

  /*
   * `name:` is a scalar key, and a hand-written file may hold anything under it.
   * Writing a scalar beside the collection already there leaves TWO `name:`
   * pairs in one mapping: yaml resolves that last-wins so `validate()` still
   * succeeds and the projection backstop cannot see it, the text autosaves, and
   * the next open throws out of `toString()` — a document the user can no longer
   * load, from an edit that looked ordinary.
   */
  it('refuses to name a block whose `name:` holds a collection', () => {
    const handWritten = `id: wf
name: n
version: 1
status: draft

blocks:
  - id: archive
    name:
      - a list somebody wrote by hand
    steps: []

steps: []
`
    const document = parseWorkflow(handWritten)
    expect(() => setBlockName('archive', 'Archive an entry').apply(document)).toThrow(
      /not a scalar/i,
    )
    // And nothing was written on the way to refusing.
    expect(document.toString()).toBe(handWritten)
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

    expect(projected(out).blocks?.[0]?.vars).toEqual([
      { key: 'attempt_note', t: 'text', value: 'first pass' },
    ])
    // The workflow's own list is untouched, which is the lifetime difference:
    // a block's vars are rebuilt on every invocation.
    expect(projected(out).vars).toEqual([{ key: 'digest_to', t: 'text', value: 'ops@example.com' }])
  })

  it('puts `vars:` before `steps:` inside the block', () => {
    const out = apply(SOURCE, addBlock({ id: 'archive' }), addVariable('note', 'archive'))
    const block = out.slice(out.indexOf('blocks:'), out.indexOf('\nsteps:'))
    expect(block.indexOf('vars:')).toBeLessThan(block.indexOf('steps:'))
  })

  it('renames one inside the block, leaving the workflow’s alone', () => {
    const built = apply(SOURCE, addBlock({ id: 'archive' }), addVariable('attempt_note', 'archive'))
    const out = apply(built, renameVariable('attempt_note', 'note', 'archive'))

    expect(projected(out).blocks?.[0]?.vars?.map((v) => v.key)).toEqual(['note'])
    expect(projected(out).vars?.map((v) => v.key)).toEqual(['digest_to'])
  })

  it('refuses a rename onto a key the same block already holds', () => {
    const built = apply(
      SOURCE,
      addBlock({ id: 'archive' }),
      addVariable('one', 'archive'),
      addVariable('two', 'archive'),
    )
    expect(() => apply(built, renameVariable('one', 'two', 'archive'))).toThrow(/already exists/)
  })

  /* The workflow's own key is a different set, so it is not a collision. */
  it('allows a block variable to take a key the workflow also uses', () => {
    const built = apply(SOURCE, addBlock({ id: 'archive' }), addVariable('note', 'archive'))
    const out = apply(built, renameVariable('note', 'digest_to', 'archive'))

    expect(projected(out).blocks?.[0]?.vars?.map((v) => v.key)).toEqual(['digest_to'])
    expect(projected(out).vars?.map((v) => v.key)).toEqual(['digest_to'])
  })

  it('removes one from the block, leaving the workflow’s alone', () => {
    const built = apply(SOURCE, addBlock({ id: 'archive' }), addVariable('attempt_note', 'archive'))
    const out = apply(built, removeVariable('attempt_note', 'archive'))

    expect(projected(out).blocks?.[0]?.vars).toEqual([])
    expect(projected(out).vars?.map((v) => v.key)).toEqual(['digest_to'])
  })

  it('still edits the workflow’s variables when no board is named', () => {
    const out = apply(SOURCE, addVariable('threshold'))
    expect(projected(out).vars?.map((v) => v.key)).toEqual(['digest_to', 'threshold'])
  })
})

/**
 * Editing a declaration that is already there.
 *
 * `addDeclaration` writes a minted key, a label and a `t`, because the schema
 * requires all three and a row missing one stops the document projecting. So
 * naming a parameter is these three commands and not the add — which is what
 * makes the Contract section an editor rather than an add-and-remove list.
 */
describe('editing a declaration', () => {
  const WITH_CONTRACT = apply(
    SOURCE,
    addBlock({ id: 'archive' }),
    addDeclaration('archive', 'params', { k: 'thread', label: 'Thread', t: 'text' }),
    addDeclaration('archive', 'params', { k: 'urgent', label: 'Urgent', t: 'boolean' }),
    addDeclaration('archive', 'outputs', { k: 'url', label: 'Where it went', t: 'text' }),
  )

  const paramsOf = (yaml: string) => projected(yaml).blocks?.[0]?.params
  const outputsOf = (yaml: string) => projected(yaml).blocks?.[0]?.outputs

  /*
   * The same contract, called twice, with a Step reading each call's output and
   * a Step of its own holding an output under the same key. Written as YAML
   * rather than built from commands because `NewStep` carries no `with:` —
   * every field here is exactly what the rename has to find or leave alone.
   */
  const CALLED = `id: wf_morning
name: n
version: 4
status: draft

blocks:
  - id: archive
    params:
      - { k: thread, label: "Thread", t: text }
      - { k: urgent, label: "Urgent", t: boolean }
    outputs:
      - { k: url, label: "Where it went", t: text }
    steps:
      - id: inner
        use: component.email.send
        with:
          to: "{{ params.thread }}"

steps:
  - id: s1
    use: component.email.fetch
  - id: first
    use: block.archive
    with:
      # what the caller passes
      thread: "the thread"
  - id: second
    use: block.archive
    with:
      thread: "another"
  - id: reads
    use: component.email.send
    with:
      a: "{{ steps.first.url }}"
      b: "{{ steps.second.url }}"
      c: "{{ steps.s1.url }}"
`

  it('renames a key, leaving the label and the type where they were', () => {
    const out = apply(WITH_CONTRACT, renameDeclaration('archive', 'params', 'thread', 'subject'))

    expect(paramsOf(out)).toEqual([
      { k: 'subject', label: 'Thread', t: 'text' },
      { k: 'urgent', label: 'Urgent', t: 'boolean' },
    ])
  })

  /*
   * Every reader resolves the FIRST match — `boardScope` offers it, the rename
   * edits it, `removeDeclaration` deletes it — so two rows under one key would
   * make the second row's bin button delete the first row's declaration, and
   * `{{ params.<k> }}` a Reference with two answers and no diagnostic.
   */
  it('refuses a rename onto a key the same side already declares', () => {
    expect(() =>
      apply(WITH_CONTRACT, renameDeclaration('archive', 'params', 'thread', 'urgent')),
    ).toThrow(/already declared/)
  })

  /*
   * A parameter is read inside its Block through `params.`, and supplied at
   * every call site as a mapping KEY under `with:` — a name, not a path. So one
   * rename is two different edits, and only one of them is a substitution.
   */
  it('rewrites a parameter’s Reference inside the Block and its key at the call site', () => {
    const out = apply(CALLED, renameDeclaration('archive', 'params', 'thread', 'subject'))

    expect(out).toContain('{{ params.subject }}')
    expect(out).not.toContain('{{ params.thread }}')
    // The call site's key moved; its value and its comment stayed put.
    expect(out).toContain('subject: "the thread"')
    expect(out).not.toContain('thread: "the thread"')
    expect(out).toContain('# what the caller passes')
  })

  /*
   * An output is read at the call site through the CALLING Step's id, so the
   * prefix is `steps.<call>.` and a Block called twice is two prefixes.
   */
  it('rewrites an output’s Reference at every call site, through each caller’s id', () => {
    const out = apply(CALLED, renameDeclaration('archive', 'outputs', 'url', 'link'))

    expect(out).toContain('{{ steps.first.link }}')
    expect(out).toContain('{{ steps.second.link }}')
    expect(out).not.toContain('{{ steps.first.url }}')
    expect(out).not.toContain('{{ steps.second.url }}')
  })

  /* A Step that is not a call site keeps an output of the same name. */
  it('leaves an output Reference belonging to another Step alone', () => {
    const out = apply(CALLED, renameDeclaration('archive', 'outputs', 'url', 'link'))
    expect(out).toContain('{{ steps.s1.url }}')
  })

  /* A call site that never filled the parameter in has no pair to rename, and a
     rename that threw there would refuse the whole edit for a blank field. */
  it('renames a parameter even where a call site left it unset', () => {
    const out = apply(CALLED, renameDeclaration('archive', 'params', 'urgent', 'now'))
    expect(paramsOf(out)?.map((d) => d.k)).toEqual(['thread', 'now'])
  })

  /* The two sides are two lists and two namespaces: `params.url` and
     `steps.<call>.url` never meet. */
  it('allows a parameter to take a key an output already uses', () => {
    const out = apply(WITH_CONTRACT, renameDeclaration('archive', 'params', 'thread', 'url'))

    expect(paramsOf(out)?.map((d) => d.k)).toEqual(['url', 'urgent'])
    expect(outputsOf(out)?.map((d) => d.k)).toEqual(['url'])
  })

  it('writes a label, which nothing references', () => {
    const out = apply(
      WITH_CONTRACT,
      setDeclarationLabel('archive', 'outputs', 'url', 'Archive link'),
    )
    expect(outputsOf(out)).toEqual([{ k: 'url', label: 'Archive link', t: 'text' }])
  })

  it('writes a type, which every call site is checked against', () => {
    const out = apply(WITH_CONTRACT, setDeclarationType('archive', 'params', 'urgent', 'number'))
    expect(paramsOf(out)?.map((d) => d.t)).toEqual(['text', 'number'])
  })

  it('refuses to edit a key the side does not declare', () => {
    expect(() =>
      apply(WITH_CONTRACT, setDeclarationType('archive', 'params', 'url', 'number')),
    ).toThrow(/No "url" declared under params/)
  })

  /* A Workflow Definition lives in the Host's repository: an edit to one
     declaration must not reformat the file around it (ADR-0001). */
  it('leaves the rest of the document as the user wrote it', () => {
    const out = apply(WITH_CONTRACT, renameDeclaration('archive', 'params', 'thread', 'subject'))

    expect(out).toContain('# The overnight triage.')
    expect(out).toContain('# Weekday mornings only.')
    expect(out).toContain('name: "Morning inbox triage"')
    expect(out).toContain('# Everything starts here.')
  })
})

describe('naming a block that was declared without one', () => {
  it('writes `name:` under its `id`, not below the whole Board', () => {
    // `addBlock` writes `name:` only when it is given, so the first name a user
    // types is a key the mapping does not have. Appended, it lands under the
    // Block's `steps:` — on a Board with fifty Steps, fifty lines from the `id`
    // it belongs to, in a file that lives in the Host's repository.
    const declared = apply(SOURCE, addBlock({ id: 'block_1' }))
    const named = apply(declared, setBlockName('block_1', 'Archive an entry'))

    expect(named).toContain('  - id: block_1\n    name: Archive an entry\n    steps: []')
    expect(projected(named).blocks?.[0]?.name).toBe('Archive an entry')
  })

  it('rewrites a name the Block already has in place, moving nothing', () => {
    const declared = apply(SOURCE, addBlock({ id: 'block_1', name: 'First' }))
    const named = apply(declared, setBlockName('block_1', 'Second'))

    expect(named).toContain('  - id: block_1\n    name: Second\n    steps: []')
    expect(named).not.toContain('First')
  })
})

describe('minting an id', () => {
  it('counts from the ids already declared, so the same edits produce the same file twice', () => {
    const first = parseWorkflow(SOURCE)
    expect(nextBlockId(first)).toBe('block_1')

    const twice = apply(SOURCE, addBlock({ id: 'block_1' }))
    expect(nextBlockId(parseWorkflow(twice))).toBe('block_2')
  })

  it('steps over an id a user took by hand', () => {
    const held = apply(SOURCE, addBlock({ id: 'block_2' }))
    expect(nextBlockId(parseWorkflow(held))).toBe('block_1')
  })

  it('refuses to declare a second block under an id already taken', () => {
    // Every reader resolves the FIRST match, so a second block's Board would
    // open on the first's steps and `removeBlock` would delete the wrong one.
    const held = parseWorkflow(apply(SOURCE, addBlock({ id: 'archive_entry' })))

    expect(() => addBlock({ id: 'archive_entry' }).apply(held)).toThrow(/already exists/)
    // And the document is left as it was, holding one.
    expect(held.toString().match(/- id: archive_entry/g)).toHaveLength(1)
  })
})

/**
 * Extraction moves the Steps and leaves a call. It writes no contract and
 * rewrites no Template (ADR-0018), so what the Segment read from around it now
 * names nothing — and `EXPR_UNKNOWN_REFERENCE` is what says so.
 */
describe('extracting a segment into a block', () => {
  const TREE = `id: wf
name: W
version: 1
status: draft

steps:
  - id: s1
    use: component.email.fetch
  # Keep this one.
  - id: s2
    use: component.email.send
    with:
      subject: "{{ steps.s1.subject }}"
  - id: s3
    use: core.fork
    branches:
      - label: A
        when: "{{ steps.s2.sent }}"
        steps:
          - id: s4
            use: component.email.send
  - id: s5
    use: component.email.send
    with:
      body: "{{ steps.s2.sent }}"
`

  it('moves the Steps onto the new Board and leaves a call where they were', () => {
    const out = apply(TREE, extractBlock({ board: null, steps: ['s2', 's3'] }, { id: 'block_1' }))
    const doc = projected(out)

    expect(doc.steps.map((step) => step.id)).toEqual(['s1', 's6', 's5'])
    expect(doc.steps[1]?.use).toBe('block.block_1')
    expect(doc.blocks?.[0]?.id).toBe('block_1')
    expect(doc.blocks?.[0]?.steps.map((step) => step.id)).toEqual(['s2', 's3'])
  })

  it('carries the comment the user wrote above a Step across with it', () => {
    const out = apply(TREE, extractBlock({ board: null, steps: ['s2', 's3'] }, { id: 'block_1' }))
    expect(out).toContain('# Keep this one.')
    // On the Board it moved to, not left behind labelling the call.
    expect(out.indexOf('# Keep this one.')).toBeLessThan(out.indexOf('- id: s5'))
  })

  it('writes no contract and rewrites no Template', () => {
    const out = apply(TREE, extractBlock({ board: null, steps: ['s2', 's3'] }, { id: 'block_1' }))
    const block = projected(out).blocks?.[0]

    expect(block?.params).toBeUndefined()
    expect(block?.outputs).toBeUndefined()
    // Reaching out of the Segment, and left exactly as it was written.
    expect(out).toContain('subject: "{{ steps.s1.subject }}"')
    // Naming a Step that moved with it, so it still resolves and is untouched.
    expect(out).toContain('when: "{{ steps.s2.sent }}"')
    // On the Board the Segment left, now naming nothing, and equally untouched.
    expect(out).toContain('body: "{{ steps.s2.sent }}"')
  })

  it('mints the call an id no Step on the Board it lands on is using', () => {
    const out = projected(apply(TREE, extractBlock({ board: null, steps: ['s2'] }, { id: 'b' })))
    // `s2` moved away, but reusing its id for the call that replaces it reads
    // as a mistake in the diff.
    expect(out.steps.map((step) => step.id)).toEqual(['s1', 's6', 's3', 's5'])
  })

  it('refuses a Segment holding a return, at any depth', () => {
    const withReturn = TREE.replace(
      '          - id: s4\n            use: component.email.send\n',
      '          - id: s4\n            use: core.return\n',
    )
    expect(() =>
      apply(withReturn, extractBlock({ board: null, steps: ['s3'] }, { id: 'block_1' })),
    ).toThrow(/returns/)
  })

  it('refuses Steps that are not siblings, so execution cannot be reordered', () => {
    expect(() =>
      apply(TREE, extractBlock({ board: null, steps: ['s2', 's4'] }, { id: 'block_1' })),
    ).toThrow(/siblings/)
  })

  /*
   * The quiet half of the same rule. Siblings with a gap between them reorder
   * execution exactly as two lists do, and the result still projects and still
   * validates — so nothing downstream would report it.
   */
  it('refuses siblings with a Step between them', () => {
    const flat = `id: wf
name: W
version: 1
status: draft
steps:
  - { id: s1, use: component.email.send }
  - { id: s2, use: component.email.send }
  - { id: s3, use: component.email.send }
  - { id: s4, use: component.email.send }
`
    // Extracted, `s2` and `s4` would leave `s1`, the call, `s3` — putting `s4`
    // before `s3` rather than after it.
    expect(() =>
      apply(flat, extractBlock({ board: null, steps: ['s2', 's4'] }, { id: 'block_1' })),
    ).toThrow(/next to each other/)

    // The contiguous run through the same Steps is still allowed.
    const out = projected(
      apply(flat, extractBlock({ board: null, steps: ['s2', 's3'] }, { id: 'block_1' })),
    )
    expect(out.steps.map((step) => step.id)).toEqual(['s1', 's5', 's4'])
  })

  it('extracts from inside a Block’s Board as readily as from the root', () => {
    const nested = `id: wf
name: W
version: 1
status: draft

blocks:
  - id: inner
    steps:
      - { id: a, use: component.email.send }
      - { id: b, use: component.email.send }

steps: []
`
    const doc = projected(
      apply(nested, extractBlock({ board: 'inner', steps: ['b'] }, { id: 'x' })),
    )
    // `s1` and not `c`: ids are minted `s1`, `s2`… on every Board, which is the
    // one rule `addStep` follows too.
    expect(doc.blocks?.find((one) => one.id === 'inner')?.steps.map((s) => s.id)).toEqual([
      'a',
      's1',
    ])
    expect(doc.blocks?.find((one) => one.id === 'x')?.steps.map((s) => s.id)).toEqual(['b'])
  })
})
