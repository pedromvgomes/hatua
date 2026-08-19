import { describe, expect, it } from 'vitest'
import { CST, Parser } from 'yaml'
import { parseWorkflow } from './index'

// The property ADR-0001 exists to guarantee: Hatua does not own the file, so
// anything the user wrote must survive being read and written back.
const SOURCE = `name: "Morning inbox triage"
id: wf_morning_inbox_triage
version: 7
status: published

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

describe('edits', () => {
  // Regression: toString() previously keyed off a `dirty` flag nothing ever
  // set, so it always replayed the CST and silently discarded every AST edit.
  // HostPorts.save() takes this text, so edits were reported saved and lost.
  it('reflects an AST edit in the serialised output', () => {
    const doc = parseWorkflow(SOURCE)
    doc.ast.setIn(['steps', 0, 'name'], 'Kick off')

    expect(doc.toString()).toContain('Kick off')
    expect(doc.toString()).not.toContain('"Start workflow"')
  })

  it('still keeps comments after an edit', () => {
    const doc = parseWorkflow(SOURCE)
    doc.ast.setIn(['steps', 0, 'name'], 'Kick off')
    expect(doc.toString()).toContain('# weekdays only')
  })

  it('leaves an untouched document byte-identical even after reading it', () => {
    const doc = parseWorkflow(SOURCE)
    doc.toJSON()
    doc.toString()
    expect(doc.toString()).toBe(SOURCE)
  })
})

describe('validation', () => {
  it('rejects YAML that parses but is not a workflow', () => {
    const doc = parseWorkflow('just: a mapping\n')
    expect(doc.validate().success).toBe(false)
    // Previously this cast straight through, and the first consumer blew up
    // inside walkSteps with "steps is not iterable".
    expect(() => doc.toJSON()).toThrow(/not a valid workflow definition/i)
  })

  it('still exposes the text of an invalid document, so Text Mode can fix it', () => {
    const broken = 'name: half written\n'
    expect(parseWorkflow(broken).toString()).toBe(broken)
  })
})
