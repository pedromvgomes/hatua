import { describe, expect, it } from 'vitest'
import { CST, Parser } from 'yaml'
import { parseWorkflow } from './index'

// The property ADR-0001 exists to guarantee: Hatua does not own the file, so
// anything the user wrote must survive being read and written back.
const SOURCE = `name: "Morning inbox triage"
id: wf_morning_inbox_triage

# The host runs this on a schedule; we only ever edit it.
steps:
  - id: s1
    use: core.start
    name: "Start workflow"
    with:
      trigger: schedule
      cron: "0 7 * * 1-5"   # weekdays only
`

describe('workflow document round trip', () => {
  it('reproduces an untouched document byte for byte', () => {
    expect(parseWorkflow(SOURCE).toString()).toBe(SOURCE)
  })

  it('projects to the typed Workflow Definition', () => {
    const doc = parseWorkflow(SOURCE).toJSON()
    expect(doc.id).toBe('wf_morning_inbox_triage')
    expect(doc.steps[0]?.use).toBe('core.start')
  })
})

describe('yaml layer fidelity', () => {
  // Pins the reason @hatua/document keeps the CST rather than the Document API
  // alone. If a future yaml release makes the AST byte-exact, this test fails
  // and the extra layer can go.
  it('the AST layer normalises whitespace before an inline comment', () => {
    const cst = [...new Parser().parse(SOURCE)]
    expect(cst.map((t) => CST.stringify(t)).join('')).toBe(SOURCE)

    const { ast } = parseWorkflow(SOURCE)
    expect(String(ast)).toContain('# weekdays only') // comment survives
    expect(String(ast)).not.toContain('"0 7 * * 1-5"   #') // its spacing does not
  })
})
