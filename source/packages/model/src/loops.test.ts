import { coreFunctions, validate } from '@hatua/expressions'
import type { Step, WorkflowDefinition } from '@hatua/schema'
import { describe, expect, it } from 'vitest'
import { scopeFor } from './scope'
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
    expect(setVarSlot(WORKFLOW.steps[0] as Step, WORKFLOW.vars ?? [])).toEqual({
      name: 'value',
      template: '{{ 1 + 1 }}',
      expectedType: 'number',
    })
  })

  it('is not a Slot at all when the board declares no such variable', () => {
    expect(setVarSlot(setVar('attemp', '1'), WORKFLOW.vars ?? [])).toBeNull()
    expect(setVarSlot(setVar(undefined, '1'), WORKFLOW.vars ?? [])).toBeNull()
  })

  it('is not a Slot when the value is a literal rather than a Template', () => {
    expect(setVarSlot(setVar('attempt', 7), WORKFLOW.vars ?? [])).toBeNull()
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
    const wrong = setVarSlot(asBoolean.steps[0] as Step, asBoolean.vars ?? [])
    expect(wrong).not.toBeNull()
    expect(
      validate(wrong?.template ?? '', wrong?.expectedType ?? 'text', {
        scope,
        functions: coreFunctions(),
      }),
    ).toEqual([expect.objectContaining({ code: 'EXPR_TYPE_MISMATCH' })])

    const right = setVarSlot(WORKFLOW.steps[0] as Step, WORKFLOW.vars ?? [])
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
    expect(setVarSlot(block?.steps[0] as Step, block?.vars ?? [])).toBeNull()
  })
})

describe('a variable’s type', () => {
  it('comes from its declaration, whatever the value beside it looks like', () => {
    expect(variableType({ key: 'a', t: 'number', value: 'not a number' })).toBe('number')
    expect(variableType({ key: 'a', t: 'boolean', value: '{{ run.tenant }}' })).toBe('boolean')
  })

  it('is unknown when nothing declares one, rather than guessed from the value', () => {
    expect(variableType({ key: 'a', value: 7 } as never)).toBe('unknown')
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
