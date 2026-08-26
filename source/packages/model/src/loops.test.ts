import { coreFunctions, validate } from '@hatua/expressions'
import type { Manifest, Step, WorkflowDefinition } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import { loopElementType, scopeFor } from './scope'
import { repeatSlot, setVarSlot, variableSlot, variableType } from './slots'

/**
 * `core.repeat` and `core.set_var`, on the side the rules corpus cannot reach.
 *
 * The corpus compares diagnostics; these follow the other half — what a Slot
 * expects and what the checker then says about it. That is where the type
 * marking lives, and it is the whole reason a var's type is declared: a
 * `core.set_var` writing a number into a var the builder marked `text` would
 * make every downstream check an answer to the wrong question.
 *
 * `sdk/go/slots_test.go` mirrors these assertion for assertion.
 */

const doc = (over: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  id: 'wf',
  name: 'W',
  version: 1,
  status: 'draft',
  steps: [],
  ...over,
})

const setVar = (key: unknown, value: unknown): Step => ({
  id: 'bump',
  use: 'core.set_var',
  with: { key, value } as Record<string, unknown>,
})

describe('a repeat’s condition', () => {
  it('is a boolean, typed by the language rather than by a manifest', () => {
    expect(repeatSlot('{{ var.done }}')).toEqual({
      name: 'until',
      template: '{{ var.done }}',
      expectedType: 'boolean',
    })
  })

  it('refuses a count where a condition belongs, which `with:` could not', () => {
    const scope = scopeFor(
      doc({
        vars: [{ key: 'seen', t: 'number', value: 0 }],
        steps: [{ id: 'again', use: 'core.repeat', until: '{{ var.seen }}', steps: [] }],
      }),
      { board: null, id: 'again' },
    )
    const slot = repeatSlot('{{ var.seen }}')

    expect(
      validate(slot.template, slot.expectedType, { scope, functions: coreFunctions() }),
    ).not.toEqual([])
    expect(
      validate('{{ var.seen > 3 }}', slot.expectedType, { scope, functions: coreFunctions() }),
    ).toEqual([])
  })
})

describe('what a set_var writes', () => {
  const WORKFLOW = doc({
    vars: [{ key: 'attempt', t: 'number', value: 0 }],
    steps: [setVar('attempt', '{{ 1 + 1 }}')],
  })

  it('is typed by the variable it names', () => {
    expect(setVarSlot(WORKFLOW, null, WORKFLOW.steps[0] as Step)).toEqual({
      name: 'value',
      template: '{{ 1 + 1 }}',
      expectedType: 'number',
    })
  })

  it('is not a Slot at all when the board declares no such variable', () => {
    expect(setVarSlot(WORKFLOW, null, setVar('attemp', '1'))).toBeNull()
    expect(setVarSlot(WORKFLOW, null, setVar(undefined, '1'))).toBeNull()
  })

  it('is not a Slot when the value is a literal rather than a Template', () => {
    expect(setVarSlot(WORKFLOW, null, setVar('attempt', 7))).toBeNull()
  })

  /**
   * The end of the argument, from the document to a verdict. A var declared
   * `boolean` refuses a number written into it, and the same document with `t:
   * number` accepts it — so the marking the builder shows and the value the
   * runner produces cannot disagree.
   */
  it('is refused when it does not match the declaration, and accepted when it does', () => {
    const asBoolean = doc({
      vars: [{ key: 'attempt', t: 'boolean', value: false }],
      steps: [setVar('attempt', '{{ 1 + 1 }}')],
    })
    const scope = scopeFor(asBoolean, { board: null, id: 'bump' })
    const wrong = setVarSlot(asBoolean, null, asBoolean.steps[0] as Step)
    expect(wrong).not.toBeNull()
    expect(
      validate(wrong?.template ?? '', wrong?.expectedType ?? 'text', {
        scope,
        functions: coreFunctions(),
      }),
    ).toEqual([expect.objectContaining({ code: 'EXPR_TYPE_MISMATCH' })])

    const right = setVarSlot(WORKFLOW, null, WORKFLOW.steps[0] as Step)
    expect(
      validate(right?.template ?? '', right?.expectedType ?? 'text', {
        scope: scopeFor(WORKFLOW, { board: null, id: 'bump' }),
        functions: coreFunctions(),
      }),
    ).toEqual([])
  })

  /**
   * A var declared on the wrong Board is out of reach rather than resolved
   * differently, which is what makes `core.set_var` Board-scoped by
   * construction rather than by a rule.
   */
  it('cannot reach the workflow’s variables from inside a block', () => {
    const inBlock = doc({
      vars: [{ key: 'attempt', t: 'number', value: 0 }],
      blocks: [
        {
          id: 'ask',
          vars: [{ key: 'note', t: 'text', value: '' }],
          steps: [setVar('attempt', '{{ 1 + 1 }}')],
        },
      ],
    })
    const block = inBlock.blocks?.[0]
    expect(setVarSlot(inBlock, 'ask', block?.steps[0] as Step)).toBeNull()
  })
})

describe('a variable’s type', () => {
  it('comes from its declaration, whatever the value beside it looks like', () => {
    expect(variableType({ key: 'a', t: 'number', value: 'not a number' })).toBe('number')
    expect(variableType({ key: 'a', t: 'boolean', value: '{{ run.tenant }}' })).toBe('boolean')
  })

  it('is unknown when nothing declares one, rather than guessed from the value', () => {
    expect(variableType({ key: 'a', value: 7 } as never)).toBe('unknown')
    // Empty and absent alike, matching the Go SDK. A `t: ""` reaching here is a
    // hand-edit like a missing key is, and treating it as a type nothing
    // declares would report a mismatch on every read of the variable.
    expect(variableType({ key: 'a', t: '', value: 7 } as never)).toBe('unknown')
  })

  it('checks the initial value, which nothing could before it was declared', () => {
    expect(variableSlot({ key: 'attempt', t: 'number', value: '{{ 1 + 1 }}' })).toEqual({
      name: 'attempt',
      template: '{{ 1 + 1 }}',
      expectedType: 'number',
    })
    // A literal is not a Template, so there is no Slot and nothing to check.
    expect(variableSlot({ key: 'attempt', t: 'number', value: 0 })).toBeNull()
  })

  it('reaches the checker through scope, so `of:` shapes a member read', () => {
    const scope = scopeFor(
      doc({
        vars: [
          {
            key: 'entry',
            t: 'object',
            of: [{ k: 'headline', label: 'Headline', t: 'text' }],
            value: '',
          },
        ],
        steps: [{ id: 's1', use: 'component.email.send' }],
      }),
      { board: null, id: 's1' },
    )

    expect(
      validate('{{ var.entry.headline }}', 'text', { scope, functions: coreFunctions() }),
    ).toEqual([])
    expect(
      validate('{{ var.entry.headline }}', 'number', { scope, functions: coreFunctions() }),
    ).not.toEqual([])
  })
})

/**
 * `core.try` and the `item` binding, on the side the rules corpus cannot reach.
 *
 * The corpus compares diagnostics. What a container BINDS is a type, and a type
 * reaches a user through scope and the checker — so it is asserted here, and in
 * `sdk/go/slots_test.go` assertion for assertion.
 */

const listing = (): Manifest[] => [
  {
    kind: 'component',
    use: 'component.inbox.fetch',
    name: 'Fetch inbox',
    fields: [],
    outputs: [
      {
        k: 'messages',
        label: 'Messages',
        t: 'list',
        of: [{ k: 'subject', label: 'Subject', t: 'text' }],
      },
      { k: 'count', label: 'Count', t: 'number' },
      { k: 'tags', label: 'Tags', t: 'list' },
    ],
  },
  {
    kind: 'component',
    use: 'core.for_each',
    name: 'For each',
    fields: [{ k: 'list', label: 'List', kind: 'ref', req: true }],
    outputs: [{ k: 'item', label: 'Item', t: 'item' }],
  },
  {
    kind: 'component',
    use: 'core.try',
    name: 'Try',
    fields: [],
    outputs: [
      {
        k: 'error',
        label: 'Error',
        t: 'object',
        of: [{ k: 'message', label: 'Message', t: 'text' }],
      },
    ],
  },
  { kind: 'component', use: 'component.email.send', name: 'Send', fields: [], outputs: [] },
]

const pathsIn = (scope: readonly { path: string }[]) => scope.map((entry) => entry.path)

describe('what a core.try binds, and for whom', () => {
  const TRIED = doc({
    steps: [
      { id: 'before', use: 'component.email.send' },
      {
        id: 'guard',
        use: 'core.try',
        steps: [{ id: 'body', use: 'component.email.send' }],
        handler: [{ id: 'rescue', use: 'component.email.send' }],
      },
      { id: 'after', use: 'component.email.send' },
    ],
  })

  it('is in scope for a handler’s children, and is the failure it is handling', () => {
    const scope = scopeFor(TRIED, { board: null, id: 'rescue' }, listing())
    expect(pathsIn(scope)).toEqual(['steps.before', 'steps.guard'])
    expect(
      validate('{{ steps.guard.error.message }}', 'text', {
        scope,
        functions: coreFunctions(),
      }),
    ).toEqual([])
  })

  /**
   * The body is what PRODUCES the failure, so a body Step reading it would be
   * reading a value that cannot exist where it stands.
   */
  it('is out of scope inside the body', () => {
    const scope = scopeFor(TRIED, { board: null, id: 'body' }, listing())
    expect(pathsIn(scope)).toEqual(['steps.before'])
  })

  /**
   * Past the try, whether there was a failure at all is a run-time fact — so
   * offering it would be the intersection-over-paths problem arriving through a
   * different door.
   */
  it('is out of scope for a Step after the try', () => {
    const scope = scopeFor(TRIED, { board: null, id: 'after' }, listing())
    expect(pathsIn(scope)).toEqual(['steps.before'])
  })

  /**
   * The two regions are siblings, which is what a Fork's branches already are.
   * Which of the body's Steps completed before the failure is not a property of
   * the document.
   */
  it('does not let a handler’s children read the body’s Steps, or the reverse', () => {
    const scope = scopeFor(TRIED, { board: null, id: 'rescue' }, listing())
    expect(pathsIn(scope)).not.toContain('steps.body')
    expect(pathsIn(scopeFor(TRIED, { board: null, id: 'body' }, listing()))).not.toContain(
      'steps.rescue',
    )
  })
})

describe('what a core.for_each binds', () => {
  const looping = (list: string): WorkflowDefinition =>
    doc({
      steps: [
        { id: 'fetch', use: 'component.inbox.fetch' },
        {
          id: 'each',
          use: 'core.for_each',
          with: { list: `{{ ${list} }}` },
          steps: [{ id: 's1', use: 'component.email.send' }],
        },
      ],
    })

  it('is one element of the list its `list` names, with the members the source declared', () => {
    const document = looping('steps.fetch.messages')
    expect(loopElementType(document, null, document.steps[1] as Step, listing())).toEqual({
      type: 'object',
      members: { subject: { type: 'text' } },
    })
  })

  it('reaches the checker, so a member of an item type-checks and a wrong type does not', () => {
    const document = looping('steps.fetch.messages')
    const scope = scopeFor(document, { board: null, id: 's1' }, listing())

    expect(
      validate('{{ steps.each.item.subject }}', 'text', { scope, functions: coreFunctions() }),
    ).toEqual([])
    expect(
      validate('{{ steps.each.item.subject }}', 'number', { scope, functions: coreFunctions() }),
    ).not.toEqual([])
  })

  /**
   * The whole reason the binding is an output of the container rather than a
   * bare token: two loops are two Step ids, so nesting needs no shadowing rule
   * and there is nothing for an inner loop to hide.
   */
  it('is resolved per loop, so two nested loops do not shadow each other', () => {
    const nested = doc({
      steps: [
        { id: 'fetch', use: 'component.inbox.threads' },
        {
          id: 'outer',
          use: 'core.for_each',
          with: { list: '{{ steps.fetch.threads }}' },
          steps: [
            {
              id: 'inner',
              use: 'core.for_each',
              with: { list: '{{ steps.outer.item.entries }}' },
              steps: [{ id: 's1', use: 'component.email.send' }],
            },
          ],
        },
      ],
    })
    const manifests: Manifest[] = [
      ...listing(),
      {
        kind: 'component',
        use: 'component.inbox.threads',
        name: 'Threads',
        fields: [],
        outputs: [
          {
            k: 'threads',
            label: 'Threads',
            t: 'list',
            of: [
              {
                k: 'entries',
                label: 'Entries',
                t: 'list',
                of: [{ k: 'body', label: 'Body', t: 'text' }],
              },
            ],
          },
        ],
      },
    ]

    const scope = scopeFor(nested, { board: null, id: 's1' }, manifests)
    expect(
      validate('{{ steps.inner.item.body }}', 'text', { scope, functions: coreFunctions() }),
    ).toEqual([])
    // The outer loop's element is still reachable and still its own shape — an
    // inner `item` hides nothing, because the two live under different Step ids.
    expect(
      validate('{{ steps.outer.item.entries }}', 'list', { scope, functions: coreFunctions() }),
    ).toEqual([])
  })

  /**
   * Null rather than a guess. `item` then stays `item`, which the checker treats
   * as matching anything — the honest answer where `object` would be a shape
   * nothing declared, and where the wrongness is reported by
   * LOOP_LIST_NOT_A_LIST rather than smuggled into a type.
   */
  it('is nothing when the list names something that is not one', () => {
    const document = looping('steps.fetch.count')
    expect(loopElementType(document, null, document.steps[1] as Step, listing())).toBeNull()
  })

  /*
   * A list of scalars. `tags`, `recipients`, `labels` — an output declared
   * `t: list` with no `of:` says what it holds many of and nothing about what
   * each one is, so there is no element shape to hand back. A memberless
   * `{type: 'object'}` is the guess the paragraph above refuses, and it is worse
   * than a guess in one direction: `{{ steps.<loop>.item }}` into a `text` field
   * reads as an object against text and is reported as a conflict on a workflow
   * with nothing wrong with it.
   */
  it('is nothing when the list declares no shape for its elements', () => {
    const scalars: Manifest[] = [
      {
        kind: 'component',
        use: 'component.inbox.fetch',
        name: 'Fetch inbox',
        fields: [],
        outputs: [{ k: 'messages', label: 'Tags', t: 'list' }],
      },
      ...listing().slice(1),
    ]
    const document = looping('steps.fetch.messages')

    expect(loopElementType(document, null, document.steps[1] as Step, scalars)).toBeNull()
  })

  it('leaves `item` matching a text field, rather than conflicting with it', () => {
    const scalars: Manifest[] = [
      {
        kind: 'component',
        use: 'component.inbox.fetch',
        name: 'Fetch inbox',
        fields: [],
        outputs: [{ k: 'messages', label: 'Tags', t: 'list' }],
      },
      ...listing().slice(1),
    ]
    const document = looping('steps.fetch.messages')
    // From inside the loop, which is where a Step reads the binding.
    const scope = scopeFor(document, { board: null, id: 's1' }, scalars)

    // Unknown, which is what `item` means, rather than a mismatch — the
    // checker treats an unresolved element as matching anything, and says so
    // instead of reporting the workflow as wrong.
    const reported = validate('{{ steps.each.item }}', 'text', {
      scope,
      functions: coreFunctions(),
    })
    expect(reported.map((diagnostic) => diagnostic.code)).toEqual(['EXPR_TYPE_UNKNOWN'])
    expect(reported.every((diagnostic) => diagnostic.severity !== 'error')).toBe(true)
  })

  /**
   * Terminating is not the same as finishing.
   *
   * Typing a loop's `item` asks for the scope AT that loop, which types every
   * loop upstream of it, which asks again — so a chain of n loops costs 2ⁿ
   * unless what has already been worked out is remembered. Twenty of them take
   * minutes, and `validateDefinition` runs on every keystroke.
   *
   * Bounded rather than merely asserted to finish: without the memo this does
   * not fail, it hangs, and a suite that hangs is a suite nobody runs. The
   * bound is loose enough for a loaded machine and ~30 orders of magnitude
   * under the unmemoised cost.
   */
  it('types a long chain of loops in one pass, not once per path that reaches it', () => {
    const deep = (n: number): WorkflowDefinition => {
      const steps: WorkflowDefinition['steps'] = [{ id: 'fetch', use: 'component.inbox.fetch' }]
      let previous = 'steps.fetch.messages'
      for (let i = 0; i < n; i++) {
        steps.push({ id: `L${i}`, use: 'core.for_each', with: { list: `{{ ${previous} }}` } })
        previous = `steps.L${i}.item`
      }
      steps.push({ id: 'tail', use: 'component.email.send' })
      return doc({ steps })
    }

    const started = performance.now()
    const scope = scopeFor(deep(30), { board: null, id: 'tail' }, listing())
    expect(performance.now() - started).toBeLessThan(500)

    // And the answers are the answers. The first loop reads a declared list, so
    // its element is the shape the source declared; every loop after it reads
    // the previous one's element, which is an object rather than a list — so
    // `item` stays `item` down the chain, which is the honest answer and not a
    // casualty of remembering.
    expect(scope.find((entry) => entry.path === 'steps.L0')?.type).toEqual({
      type: 'object',
      members: { item: { type: 'object', members: { subject: { type: 'text' } } } },
    })
    expect(scope.find((entry) => entry.path === 'steps.L29')?.type).toEqual({
      type: 'object',
      members: { item: { type: 'item' } },
    })
  })

  it('is nothing when the list is not a plain Reference, or names nothing at all', () => {
    const computed = looping('json.parse(steps.fetch.count)')
    expect(loopElementType(computed, null, computed.steps[1] as Step, listing())).toBeNull()

    const gone = looping('steps.gone.messages')
    expect(loopElementType(gone, null, gone.steps[1] as Step, listing())).toBeNull()
  })
})
