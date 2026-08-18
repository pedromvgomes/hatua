import { describe, expect, it } from 'vitest'
import { parseExpression, parseTemplate } from './parse.js'

/**
 * The smoke test. It exists so `make build` has something to verify against
 * from the very first generation — the whole point of generate → verify →
 * promote is that the destination is only ever written by output that passed,
 * and that is only true if a suite exists before the parser does.
 *
 * The real coverage lives in the shared scenarios under
 * conformance/expression/, which run against Go too.
 */
describe('parseTemplate', () => {
  it('reads literal text with no holes', () => {
    expect(parseTemplate('hello')).toEqual({
      kind: 'Template',
      segments: [{ kind: 'Text', value: 'hello' }],
    })
  })

  it('reads a Reference as a path', () => {
    const template = parseTemplate('{{ s2.count }}')
    expect(template.segments).toHaveLength(1)
    expect(template.segments[0]).toMatchObject({ kind: 'Hole', at: 3 })
  })

  it('treats `{{ \'{{\' }}` as a hole holding a text literal, not a special case', () => {
    const template = parseTemplate("{{ '{{' }}")
    expect(template.segments[0]).toMatchObject({
      kind: 'Hole',
      expr: { kind: 'Literal', type: 'text', value: '{{' },
    })
  })

  it('refuses an unclosed hole', () => {
    expect(() => parseTemplate('unclosed {{ a')).toThrow(/EXPR_PARSE_ERROR|Expected/)
  })
})

describe('parseExpression', () => {
  it('binds `*` tighter than `+`', () => {
    expect(parseExpression('1 + 2 * 3')).toMatchObject({
      kind: 'Binary',
      op: '+',
      right: { kind: 'Binary', op: '*' },
    })
  })

  it('folds same-precedence operators to the left', () => {
    expect(parseExpression('1 - 2 - 3')).toMatchObject({
      kind: 'Binary',
      op: '-',
      left: { kind: 'Binary', op: '-' },
    })
  })

  it('folds the conditional to the right', () => {
    expect(parseExpression('a ? b : c ? d : e')).toMatchObject({
      kind: 'Ternary',
      otherwise: { kind: 'Ternary' },
    })
  })
})
