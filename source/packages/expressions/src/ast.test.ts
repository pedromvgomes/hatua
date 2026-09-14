import { describe, expect, it } from 'vitest'
import { isExpression } from './ast.js'
import { parseTemplate } from './parse.js'

/**
 * A Template's segments and the expressions inside them are one union to walk,
 * and telling the two apart is what a walker does at every step.
 */
describe('isExpression', () => {
  it('separates the expression nodes from the segments a Template is made of', () => {
    const template = parseTemplate('Hello {{ var.name }}')
    const [text, hole] = template.segments

    // `Text` and `Hole` are the shape of the Template; everything below a hole
    // is the language.
    expect(text && isExpression(text)).toBe(false)
    expect(hole && isExpression(hole)).toBe(false)
    expect(hole?.kind === 'Hole' && isExpression(hole.expr)).toBe(true)
  })
})
