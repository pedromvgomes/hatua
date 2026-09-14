import { validate } from '@hatua/expressions'
import type { Manifest, WorkflowDefinition } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import {
  callSitesOf,
  callSlots,
  contractSummary,
  cyclicBlocks,
  returnSlots,
  troubledBlocks,
} from './blocks'
import { type Diagnostic, indexManifests } from './connections'
import { blockOutputType, boardScope, scopeFor } from './scope'
import { boards, stepKey, walkDocument } from './tree'
import { validateDefinition } from './validity'

/**
 * Blocks, and the contract that lets one be reached from many call sites while
 * scope stays an exact walk.
 *
 * The load-bearing test is the last one: a Reference from inside a Block to a
 * Step outside it must fail. If that ever passes, `blocks:` has become the back
 * door ADR-0013 refuses and the argument for nesting is void.
 */

const MANIFESTS: Manifest[] = [
  {
    kind: 'component',
    use: 'component.s3.upload',
    name: 'Upload',
    fields: [{ k: 'body', label: 'Body', kind: 'text', req: true }],
    outputs: [{ k: 'location', label: 'Location', t: 'text' }],
  },
  {
    kind: 'component',
    use: 'component.email.fetch',
    name: 'Fetch emails',
    fields: [],
    outputs: [{ k: 'count', label: 'Count', t: 'number' }],
  },
  { kind: 'component', use: 'core.return', name: 'Return', fields: [], outputs: [] },
  { kind: 'component', use: 'core.fork', name: 'Branch', fields: [], outputs: [] },
  { kind: 'component', use: 'core.for_each', name: 'For each', fields: [], outputs: [] },
  { kind: 'trigger', use: 'core.schedule', name: 'Schedule', fields: [], outputs: [] },
]

const CATALOGUE = indexManifests(MANIFESTS)

const doc = (overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  id: 'wf',
  name: 'W',
  version: 1,
  status: 'draft',
  triggers: [{ id: 'nightly', use: 'core.schedule' }],
  vars: [{ key: 'digest_to', t: 'text', value: 'me@dane.dev' }],
  steps: [],
  ...overrides,
})

/** The worked example: a block that archives, called from the root and from another block. */
const ARCHIVE: WorkflowDefinition = doc({
  blocks: [
    {
      id: 'archive_entry',
      name: 'Archive an entry',
      params: [
        {
          k: 'entry',
          label: 'Entry',
          t: 'object',
          of: [{ k: 'headline', label: 'Headline', t: 'text' }],
        },
      ],
      outputs: [{ k: 'url', label: 'Archive URL', t: 'text' }],
      vars: [{ key: 'attempt_note', t: 'text', value: '' }],
      steps: [
        {
          id: 'put',
          use: 'component.s3.upload',
          with: { body: '{{ params.entry.headline }}' },
        },
        { id: 'ret', use: 'core.return', with: { url: '{{ steps.put.location }}' } },
      ],
    },
    {
      id: 'notify_and_archive',
      name: 'Notify, then archive',
      params: [{ k: 'entry', label: 'Entry', t: 'object' }],
      outputs: [{ k: 'url', label: 'Archive URL', t: 'text' }],
      steps: [
        { id: 'kept', use: 'block.archive_entry', with: { entry: '{{ params.entry }}' } },
        { id: 'ret', use: 'core.return', with: { url: '{{ steps.kept.url }}' } },
      ],
    },
  ],
  steps: [
    { id: 's2', use: 'component.email.fetch' },
    { id: 'send_1', use: 'block.notify_and_archive', with: { entry: '{{ steps.s2 }}' } },
    { id: 'audit_1', use: 'block.archive_entry', with: { entry: '{{ steps.s2 }}' } },
    { id: 'audit_2', use: 'block.archive_entry', with: { entry: '{{ steps.s2 }}' } },
    { id: 's9', use: 'component.email.fetch' },
  ],
})

const codes = (found: readonly { code: string }[]) => found.map((d) => d.code)

describe('boards', () => {
  it('yields the root and one per block, root first', () => {
    expect([...boards(ARCHIVE)].map((board) => board.id)).toEqual([
      null,
      'archive_entry',
      'notify_and_archive',
    ])
  })

  it('walks every step on every board, so no validator can skip a block', () => {
    expect([...walkDocument(ARCHIVE)].map((found) => stepKey(found))).toEqual([
      's2',
      'send_1',
      'audit_1',
      'audit_2',
      's9',
      'archive_entry/put',
      'archive_entry/ret',
      'notify_and_archive/kept',
      'notify_and_archive/ret',
    ])
  })

  /* Two blocks each holding a `ret` is the case a flat key would collapse. */
  it('keys a step by its board and its id together', () => {
    expect(stepKey({ board: 'archive_entry', id: 'ret' })).not.toBe(
      stepKey({ board: 'notify_and_archive', id: 'ret' }),
    )
    expect(stepKey({ board: null, id: 's2' })).toBe('s2')
  })
})

describe('what a block can read', () => {
  it('offers its parameters, its own vars and the Run Context — and nothing else', () => {
    const paths = boardScope(ARCHIVE, 'archive_entry', MANIFESTS, [
      { k: 'tenant', label: 'Tenant', t: 'text' },
    ]).map((entry) => entry.path)

    expect(paths).toEqual(['run.tenant', 'params.entry', 'var.attempt_note'])
  })

  /*
   * The workflow's vars and triggers are the call site's, not the block's. A
   * block that needs one takes it as a parameter — which is the contract that
   * replaces the dataflow analysis a jump would have needed.
   */
  it('does not offer the workflow’s triggers or variables', () => {
    const paths = boardScope(ARCHIVE, 'archive_entry', MANIFESTS).map((entry) => entry.path)
    expect(paths).not.toContain('triggers.nightly')
    expect(paths).not.toContain('var.digest_to')
  })

  it('roots the walk at the block, so a call site’s ancestry is invisible', () => {
    const paths = scopeFor(ARCHIVE, { board: 'archive_entry', id: 'ret' }, MANIFESTS).map(
      (entry) => entry.path,
    )

    expect(paths).toContain('steps.put')
    expect(paths).not.toContain('steps.s2')
    expect(paths).not.toContain('steps.send_1')
  })

  it('types a parameter from its declaration, nesting included', () => {
    const entry = boardScope(ARCHIVE, 'archive_entry', MANIFESTS).find(
      (candidate) => candidate.path === 'params.entry',
    )
    expect(entry?.type).toEqual({
      type: 'object',
      members: { headline: { type: 'text' } },
    })
  })
})

describe('what a call publishes', () => {
  it('types a call site from the block’s declared outputs', () => {
    const entry = scopeFor(ARCHIVE, { board: null, id: 'audit_1' }, MANIFESTS).find(
      (candidate) => candidate.path === 'steps.send_1',
    )
    expect(entry?.type).toEqual({ type: 'object', members: { url: { type: 'text' } } })
  })

  it('so a downstream Reference to a block’s output type-checks', () => {
    const scope = scopeFor(ARCHIVE, { board: null, id: 'audit_1' }, MANIFESTS)
    expect(validate('{{ steps.send_1.url }}', 'text', { scope, functions: new Map() })).toEqual([])
    expect(
      validate('{{ steps.send_1.url }}', 'number', { scope, functions: new Map() }),
    ).toHaveLength(1)
  })

  /* One declaration, every call site — which is what a call buys over a copy. */
  it('gives two calls of one block the same output type', () => {
    const scope = scopeFor(ARCHIVE, { board: null, id: 's9' }, MANIFESTS)
    const shape = (id: string) => scope.find((candidate) => candidate.path === `steps.${id}`)?.type

    expect(shape('audit_1')).toEqual({ type: 'object', members: { url: { type: 'text' } } })
    expect(shape('audit_2')).toEqual(shape('audit_1'))
  })

  it('takes a call’s Slots from the params and a return’s from the outputs', () => {
    const block = ARCHIVE.blocks?.[0]
    if (!block) throw new Error('fixture')

    expect(callSlots(ARCHIVE.steps[2]!, block)).toEqual([
      { name: 'entry', template: '{{ steps.s2 }}', expectedType: 'object' },
    ])
    expect(returnSlots(block.steps[1]!, block)).toEqual([
      { name: 'url', template: '{{ steps.put.location }}', expectedType: 'text' },
    ])
  })
})

describe('recursion', () => {
  it('accepts a block calling another block', () => {
    expect(cyclicBlocks(ARCHIVE).size).toBe(0)
    expect(codes(validateDefinition(ARCHIVE, CATALOGUE).all)).not.toContain('BLOCK_RECURSION')
  })

  it('refuses a block that calls itself', () => {
    const direct = doc({
      blocks: [{ id: 'loop', steps: [{ id: 'again', use: 'block.loop' }] }],
    })
    expect([...cyclicBlocks(direct)]).toEqual(['loop'])
    expect(codes(validateDefinition(direct, CATALOGUE).all)).toContain('BLOCK_RECURSION')
  })

  it('refuses a cycle through another block, and names only the blocks on it', () => {
    const indirect = doc({
      blocks: [
        { id: 'entry', steps: [{ id: 'a', use: 'block.middle' }] },
        { id: 'middle', steps: [{ id: 'b', use: 'block.tail' }] },
        { id: 'tail', steps: [{ id: 'c', use: 'block.middle' }] },
      ],
    })
    // `entry` reaches the cycle without being on it, so it is not recursive.
    expect([...cyclicBlocks(indirect)].sort()).toEqual(['middle', 'tail'])
  })

  /*
   * A Block reaching the cycle through one already walked is still on it.
   *
   * `b4 → b3 → b1 → b2 → b4` is a cycle, and the depth-first walk finishes `b3`
   * while proving `b1 → b2 → b3 → b1`. Skipping a finished node then hides
   * every cycle that only closes through it, so a recursive Block is published
   * with no BLOCK_RECURSION against it — the design-time answer ADR-0013 asks
   * for, missing exactly where a runner would not survive it.
   */
  it('finds a cycle that closes through a block already walked', () => {
    const shared = doc({
      blocks: [
        { id: 'b1', steps: [{ id: 'a', use: 'block.b2' }] },
        {
          id: 'b2',
          steps: [
            { id: 'b', use: 'block.b3' },
            { id: 'c', use: 'block.b4' },
          ],
        },
        { id: 'b3', steps: [{ id: 'd', use: 'block.b1' }] },
        { id: 'b4', steps: [{ id: 'e', use: 'block.b3' }] },
      ],
    })
    expect([...cyclicBlocks(shared)].sort()).toEqual(['b1', 'b2', 'b3', 'b4'])
  })

  /* A call nested inside a fork or a loop still reaches. */
  it('finds a cycle through a call buried in a branch', () => {
    const nested = doc({
      blocks: [
        {
          id: 'loop',
          steps: [
            {
              id: 'fork',
              use: 'core.fork',
              branches: [
                { label: 'A', steps: [{ id: 'again', use: 'block.loop' }] },
                { label: 'B', steps: [] },
              ],
            },
          ],
        },
      ],
    })
    expect([...cyclicBlocks(nested)]).toEqual(['loop'])
  })
})

describe('what a document gets wrong', () => {
  it('reports a call to a block nothing declares, without blocking editing', () => {
    const missing = doc({ steps: [{ id: 'call', use: 'block.nowhere' }] })
    const [found] = validateDefinition(missing, CATALOGUE).all

    expect(found?.code).toBe('BLOCK_UNKNOWN')
    expect(found?.blocks).toBe('publish')
    expect(found?.message).toContain('nowhere')
  })

  it('reports a parameter nobody filled in, against the declaration', () => {
    const unfilled = doc({
      blocks: [
        {
          id: 'archive',
          params: [{ k: 'entry', label: 'Entry', t: 'object' }],
          steps: [],
        },
      ],
      steps: [{ id: 'call', use: 'block.archive', with: {} }],
    })

    const found = validateDefinition(unfilled, CATALOGUE).all.filter(
      (d) => d.code === 'FIELD_REQUIRED',
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.fieldKey).toBe('entry')
    expect(found[0]?.message).toBe('Entry is required.')
  })

  it('refuses a return outside a block, where there is nothing to bind', () => {
    const stray = doc({ steps: [{ id: 'ret', use: 'core.return' }] })
    expect(codes(validateDefinition(stray, CATALOGUE).all)).toContain('RETURN_OUTSIDE_BLOCK')
  })

  it('files a diagnostic under the board it is on, so two `ret`s do not collide', () => {
    const { byStep } = validateDefinition(ARCHIVE, CATALOGUE)
    expect(byStep.has('archive_entry/ret')).toBe(false)
    expect(byStep.has('notify_and_archive/ret')).toBe(false)

    const clash = doc({
      blocks: [
        { id: 'a', outputs: [{ k: 'x', label: 'X', t: 'text' }], steps: [] },
        { id: 'b', outputs: [{ k: 'x', label: 'X', t: 'text' }], steps: [] },
      ],
    })
    const { byBlock } = validateDefinition(clash, CATALOGUE)
    expect([...byBlock.keys()].sort()).toEqual(['a', 'b'])
  })

  /* A call resolves to the first block under an id, so a second is unreachable. */
  it('reports two blocks declared under one id', () => {
    const twice = doc({
      blocks: [
        { id: 'archive', steps: [] },
        { id: 'archive', steps: [{ id: 'x', use: 'component.email.fetch' }] },
      ],
    })
    const found = validateDefinition(twice, CATALOGUE).all.filter(
      (d) => d.code === 'BLOCK_ID_DUPLICATE',
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.message).toContain('archive')
  })

  /* Both readers must agree which one `block.archive` names, or recursion is
     analysed against one block's steps and reported against another's. */
  it('resolves a repeated block id the same way in both readers', () => {
    const twice = doc({
      blocks: [
        { id: 'archive', steps: [] },
        { id: 'archive', steps: [{ id: 'again', use: 'block.archive' }] },
      ],
    })
    // The second block is what would look recursive; the first is what a call
    // resolves to, and first-wins is the answer both give.
    expect(cyclicBlocks(twice).size).toBe(0)
  })

  it('reports two steps on one board sharing an id, and allows one per board', () => {
    const twice = doc({
      blocks: [{ id: 'a', steps: [{ id: 'ret', use: 'core.return' }] }],
      steps: [
        { id: 'x', use: 'component.email.fetch' },
        { id: 'x', use: 'component.email.fetch' },
      ],
    })
    const found = validateDefinition(twice, CATALOGUE).all.filter(
      (d) => d.code === 'STEP_ID_DUPLICATE',
    )
    expect(found).toHaveLength(1)
  })
})

describe('a name that would resolve two ways', () => {
  it('reports two parameters under one key, and offers the first once', () => {
    const twice = doc({
      blocks: [
        {
          id: 'archive',
          params: [
            { k: 'entry', label: 'First', t: 'text' },
            { k: 'entry', label: 'Second', t: 'number' },
          ],
          steps: [],
        },
      ],
    })

    const found = validateDefinition(twice, CATALOGUE).all.filter(
      (d) => d.code === 'DECLARATION_KEY_DUPLICATE',
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.message).toContain('parameter')

    // One row, and the first declaration is the one every reader resolves to.
    const offered = boardScope(twice, 'archive', MANIFESTS).filter(
      (entry) => entry.path === 'params.entry',
    )
    expect(offered).toHaveLength(1)
    expect(offered[0]?.type).toEqual({ type: 'text' })
  })

  it('reports two outputs under one key', () => {
    const twice = doc({
      blocks: [
        {
          id: 'archive',
          outputs: [
            { k: 'url', label: 'First', t: 'text' },
            { k: 'url', label: 'Second', t: 'text' },
          ],
          steps: [{ id: 'ret', use: 'core.return', with: { url: 'x' } }],
        },
      ],
    })
    expect(codes(validateDefinition(twice, CATALOGUE).all)).toContain('DECLARATION_KEY_DUPLICATE')
  })
})

describe('every path returns', () => {
  const withBody = (steps: WorkflowDefinition['steps']) =>
    doc({
      blocks: [
        {
          id: 'b',
          outputs: [{ k: 'url', label: 'URL', t: 'text' }],
          steps,
        },
      ],
    })

  const returned = (steps: WorkflowDefinition['steps']) =>
    !codes(validateDefinition(withBody(steps), CATALOGUE).all).includes('BLOCK_PATH_WITHOUT_RETURN')

  it('accepts a return at the board’s root level', () => {
    expect(returned([{ id: 'ret', use: 'core.return', with: { url: 'x' } }])).toBe(true)
  })

  /*
   * A condition fork, and it says so: exactly one branch runs, so the question
   * is whether every one of them returns. Which fork this is comes from the
   * branches — a fork where NO branch carries `when` is the parallel one — so a
   * fixture that omits `when` is asking a different question from the one its
   * name states.
   */
  it('accepts a condition fork whose every branch returns', () => {
    expect(
      returned([
        {
          id: 'fork',
          use: 'core.fork',
          branches: [
            {
              label: 'A',
              when: '{{ params.a }}',
              steps: [{ id: 'r1', use: 'core.return', with: { url: 'x' } }],
            },
            { label: 'B', steps: [{ id: 'r2', use: 'core.return', with: { url: 'y' } }] },
          ],
        },
      ]),
    ).toBe(true)
  })

  /*
   * A condition fork is first-match-wins, so one whose every branch carries a
   * `when` can match none of them and fall straight through. Crediting it both
   * hides a block that can finish without returning and refuses publish to a
   * Step legitimately placed after the fork.
   */
  it('does not accept a fork that can match no branch at all', () => {
    expect(
      returned([
        {
          id: 'fork',
          use: 'core.fork',
          branches: [
            {
              label: 'A',
              when: '{{ params.a }}',
              steps: [{ id: 'r1', use: 'core.return', with: { url: 'x' } }],
            },
            {
              label: 'B',
              when: '{{ params.b }}',
              steps: [{ id: 'r2', use: 'core.return', with: { url: 'y' } }],
            },
          ],
        },
      ]),
    ).toBe(false)
  })

  /*
   * A parallel fork is the opposite quantifier from a condition one, for the
   * opposite reason: every branch runs, so ONE that always returns ends the
   * Block. Asking `every` here — which is what a fork read without its mode
   * gets — refuses publish to a Block that does return on every path.
   */
  it('accepts a parallel fork where one branch returns', () => {
    expect(
      returned([
        {
          id: 'fork',
          use: 'core.fork',
          branches: [
            {
              label: 'Archive it',
              steps: [{ id: 'r1', use: 'core.return', with: { url: 'x' } }],
            },
            { label: 'Notify', steps: [{ id: 's1', use: 'component.email.send' }] },
          ],
        },
      ]),
    ).toBe(true)
  })

  it('calls a Step after one unreachable, which is the same claim said twice', () => {
    const after = withBody([
      {
        id: 'fork',
        use: 'core.fork',
        branches: [
          { label: 'Archive it', steps: [{ id: 'r1', use: 'core.return', with: { url: 'x' } }] },
          { label: 'Notify', steps: [{ id: 's1', use: 'component.email.send' }] },
        ],
      },
      { id: 'later', use: 'component.email.send' },
    ])
    expect(
      validateDefinition(after, CATALOGUE).all.filter((d) => d.code === 'STEP_AFTER_RETURN'),
    ).toHaveLength(1)
  })

  it('still refuses a parallel fork where no branch returns', () => {
    expect(
      returned([
        {
          id: 'fork',
          use: 'core.fork',
          branches: [
            { label: 'Archive it', steps: [{ id: 's1', use: 'component.email.send' }] },
            { label: 'Notify', steps: [{ id: 's2', use: 'component.email.send' }] },
          ],
        },
      ]),
    ).toBe(false)
  })

  it('does not call a Step after such a fork unreachable', () => {
    const after = withBody([
      {
        id: 'fork',
        use: 'core.fork',
        branches: [
          {
            label: 'A',
            when: '{{ params.a }}',
            steps: [{ id: 'r1', use: 'core.return', with: { url: 'x' } }],
          },
          {
            label: 'B',
            when: '{{ params.b }}',
            steps: [{ id: 'r2', use: 'core.return', with: { url: 'y' } }],
          },
        ],
      },
      { id: 'ret', use: 'core.return', with: { url: 'z' } },
    ])
    expect(codes(validateDefinition(after, CATALOGUE).all)).not.toContain('STEP_AFTER_RETURN')
  })

  /*
   * `when: ""` is schema-legal, and the distinction the schema draws is absent
   * versus present: a branch carrying an empty condition carries one nobody has
   * written yet, so it is not the fallback. `malformedContainers` and
   * `branchKeyword` read it the same way — one rule calling it the fallback
   * while another calls it a condition is how a Fork ends up exhaustive on one
   * screen and not on the next.
   */
  it('reads an empty `when` on the last branch as a condition, as the fork rule does', () => {
    expect(
      returned([
        {
          id: 'fork',
          use: 'core.fork',
          branches: [
            {
              label: 'A',
              when: '{{ params.a }}',
              steps: [{ id: 'r1', use: 'core.return', with: { url: 'x' } }],
            },
            {
              label: 'B',
              when: '',
              steps: [{ id: 'r2', use: 'core.return', with: { url: 'y' } }],
            },
          ],
        },
      ]),
    ).toBe(false)
  })

  it('reads a missing `when` on the last branch as the fallback', () => {
    expect(
      returned([
        {
          id: 'fork',
          use: 'core.fork',
          branches: [
            {
              label: 'A',
              when: '{{ params.a }}',
              steps: [{ id: 'r1', use: 'core.return', with: { url: 'x' } }],
            },
            {
              label: 'B',
              steps: [{ id: 'r2', use: 'core.return', with: { url: 'y' } }],
            },
          ],
        },
      ]),
    ).toBe(true)
  })

  it('refuses a condition fork where one branch does not', () => {
    expect(
      returned([
        {
          id: 'fork',
          use: 'core.fork',
          branches: [
            {
              label: 'A',
              when: '{{ params.a }}',
              steps: [{ id: 'r1', use: 'core.return', with: { url: 'x' } }],
            },
            { label: 'B', steps: [] },
          ],
        },
      ]),
    ).toBe(false)
  })

  /*
   * The load-bearing case. A return inside a loop exits the block early and is
   * legal, but the list may be empty and the body may never run — the same
   * reasoning that keeps sibling branches out of scope, applied to time.
   */
  it('does not accept a return that only a loop body reaches', () => {
    expect(
      returned([
        {
          id: 'each',
          use: 'core.for_each',
          with: { list: '{{ params.xs }}' },
          steps: [{ id: 'r', use: 'core.return', with: { url: 'x' } }],
        },
      ]),
    ).toBe(false)
  })

  it('asks nothing of a block that declares no outputs', () => {
    const effects = doc({ blocks: [{ id: 'b', steps: [{ id: 's', use: 'core.fork' }] }] })
    expect(codes(validateDefinition(effects, CATALOGUE).all)).not.toContain(
      'BLOCK_PATH_WITHOUT_RETURN',
    )
  })

  it('reports what sits after a return, which can never run', () => {
    const after = withBody([
      { id: 'ret', use: 'core.return', with: { url: 'x' } },
      { id: 'later', use: 'component.email.fetch' },
    ])
    const found = validateDefinition(after, CATALOGUE).all.filter(
      (d) => d.code === 'STEP_AFTER_RETURN',
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.stepId).toBe('later')
  })
})

/**
 * The contract, stated as a test.
 *
 * A Block reads only what it declares. If a Reference from inside one to a Step
 * outside it ever resolves, scope has stopped being an exact walk and `blocks:`
 * has become the jump ADR-0013 refuses.
 */
describe('the contract', () => {
  it('refuses a Reference from inside a block to a step outside it', () => {
    const scope = scopeFor(ARCHIVE, { board: 'archive_entry', id: 'ret' }, MANIFESTS)

    expect(validate('{{ steps.s2.count }}', 'number', { scope, functions: new Map() })).toEqual([
      expect.objectContaining({ code: 'EXPR_UNKNOWN_REFERENCE' }),
    ])
    expect(validate('{{ var.digest_to }}', 'text', { scope, functions: new Map() })).toEqual([
      expect.objectContaining({ code: 'EXPR_UNKNOWN_REFERENCE' }),
    ])
    expect(validate('{{ triggers.nightly.at }}', 'text', { scope, functions: new Map() })).toEqual([
      expect.objectContaining({ code: 'EXPR_UNKNOWN_REFERENCE' }),
    ])

    // And what it does declare resolves, so the refusal is about scope rather
    // than about the block being empty.
    expect(validate('{{ steps.put.location }}', 'text', { scope, functions: new Map() })).toEqual(
      [],
    )
    expect(
      validate('{{ params.entry.headline }}', 'text', { scope, functions: new Map() }),
    ).toEqual([])
    expect(validate('{{ var.attempt_note }}', 'text', { scope, functions: new Map() })).toEqual([])
  })
})

/**
 * A repeated output key, which the schema permits into a file and
 * DECLARATION_KEY_DUPLICATE only stops at Publish — so both languages have to
 * pick the same one of the two while the document is being edited.
 *
 * First-wins, matching `blockOf` and `cyclicBlocks`. Which one is picked matters
 * less than that one answer exists: last here and first in the Go SDK types the
 * same call site `number` in one builder and `text` in the other, and a
 * hand-edited document then checks differently depending on who opened it.
 */
describe('a block that declares one output twice', () => {
  it('types the call site from the first declaration', () => {
    const block = {
      id: 'twice',
      outputs: [
        { k: 'out', label: 'Out', t: 'text' as const },
        { k: 'out', label: 'Out', t: 'number' as const },
      ],
      steps: [],
    }

    expect(blockOutputType(block)).toEqual({ type: 'object', members: { out: { type: 'text' } } })
  })
})

describe('who calls a block', () => {
  it('finds every call site on every board, not just the root', () => {
    // A count taken off the root alone tells a user deleting a block that one
    // step calls it while another block calls it too.
    expect(callSitesOf(ARCHIVE, 'archive_entry')).toEqual([
      { board: null, id: 'audit_1' },
      { board: null, id: 'audit_2' },
      { board: 'notify_and_archive', id: 'kept' },
    ])
  })

  it('finds a call nested inside a container', () => {
    // A call inside a Fork branch is a call. Read off the top level alone, the
    // sites hardest to find again are the ones that go unreported.
    const nested = doc({
      blocks: [{ id: 'inner', steps: [] }],
      steps: [
        {
          id: 'fork',
          use: 'core.fork',
          branches: [
            { label: 'A', when: '{{ true }}', steps: [{ id: 'deep', use: 'block.inner' }] },
          ],
        },
      ],
    })

    expect(callSitesOf(nested, 'inner')).toEqual([{ board: null, id: 'deep' }])
  })

  it('answers nothing for a block nobody calls', () => {
    expect(callSitesOf(ARCHIVE, 'notify_and_archive')).toHaveLength(1)
    expect(callSitesOf(ARCHIVE, 'nobody_calls_this')).toEqual([])
  })
})

describe('the contract in a line', () => {
  it('counts what a block takes and what it publishes, singular and plural', () => {
    expect(contractSummary(ARCHIVE.blocks?.[0])).toBe('1 param · 1 output')
    expect(contractSummary({ id: 'x', steps: [] })).toBe('0 params · 0 outputs')
    expect(
      contractSummary({
        id: 'x',
        steps: [],
        params: [
          { k: 'a', label: 'A', t: 'text' },
          { k: 'b', label: 'B', t: 'text' },
        ],
      }),
    ).toBe('2 params · 0 outputs')
  })

  it('reads an absent block as a contract of nothing rather than as an empty line', () => {
    // A Board resolved against a document that no longer declares it still
    // draws a node, and a summary that vanishes reads as a Board with no
    // contract instead of one that is not there.
    expect(contractSummary(undefined)).toBe('0 params · 0 outputs')
  })
})

/**
 * A call is a doorway, and a doorway says nothing about what is behind it. This
 * is what lets a surface say so.
 */
describe('troubledBlocks', () => {
  const broken = (blockId: string, stepId: string): Diagnostic =>
    ({ code: 'X', message: '', blocks: 'publish', blockId, stepId }) as Diagnostic

  const doc = (blocks: { id: string; calls?: string[] }[]): WorkflowDefinition =>
    ({
      id: 'wf',
      name: 'W',
      version: 1,
      status: 'draft',
      blocks: blocks.map((one) => ({
        id: one.id,
        steps: (one.calls ?? []).map((to, i) => ({ id: `c${i}`, use: `block.${to}` })),
      })),
      steps: [],
    }) as unknown as WorkflowDefinition

  it('is empty when nothing is wrong', () => {
    expect([...troubledBlocks(doc([{ id: 'a' }]), [])]).toEqual([])
  })

  it('holds a Block with a diagnostic on its own Board', () => {
    expect([...troubledBlocks(doc([{ id: 'a' }]), [broken('a', 's1')])]).toEqual(['a'])
  })

  /*
   * The reason it is transitive. A Block whose own Steps are all fine but which
   * calls a broken one does not run either — and marking only the immediate
   * caller leaves every Board above it clean, with nothing suggesting the walk
   * down to the level that says so.
   */
  it('holds every caller that reaches one, however far', () => {
    const tree = doc([{ id: 'top', calls: ['mid'] }, { id: 'mid', calls: ['low'] }, { id: 'low' }])
    expect([...troubledBlocks(tree, [broken('low', 's1')])].sort()).toEqual(['low', 'mid', 'top'])
  })

  it('leaves a Block that reaches nothing broken alone', () => {
    const tree = doc([{ id: 'a', calls: ['fine'] }, { id: 'fine' }, { id: 'bad' }])
    expect([...troubledBlocks(tree, [broken('bad', 's1')])]).toEqual(['bad'])
  })

  it('terminates on Blocks that call each other', () => {
    const tree = doc([
      { id: 'a', calls: ['b'] },
      { id: 'b', calls: ['a'] },
    ])
    expect([...troubledBlocks(tree, [broken('a', 's1')])].sort()).toEqual(['a', 'b'])
  })

  it('reads a diagnostic about the Block itself, which carries no stepId', () => {
    const tree = doc([{ id: 'caller', calls: ['a'] }, { id: 'a' }])
    const own = { code: 'X', message: '', blocks: 'publish', blockId: 'a' } as Diagnostic
    expect([...troubledBlocks(tree, [own])].sort()).toEqual(['a', 'caller'])
  })
})
