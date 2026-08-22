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

/*
 * A block is a whole second Board in one file, and the deepest structure a
 * Workflow Definition holds: a mapping of lists of mappings, with a nested `of:`
 * inside a declaration. If anything is going to be reformatted on the way
 * through, it is this.
 */
const WITH_BLOCKS = `id: wf_morning
name: "Morning inbox triage"
version: 9
status: draft

blocks:
  # Called from two places, which is the whole point of declaring it once.
  - id: archive_entry
    name: Archive an entry
    params:
      - k: entry
        label: Entry
        t: object
        of:
          - { k: headline, label: Headline, t: text }   # nested a level down
    outputs:
      - { k: url, label: "Archive URL", t: text }
    vars:
      - key: attempt_note
        value: ""
    steps:
      - id: put
        use: component.s3.upload
      - id: ret
        use: core.return
        with:
          url: "{{ steps.put.location }}"

steps:
  - id: audit_1
    use: block.archive_entry
    with:
      entry: "{{ steps.s8 }}"
`

describe('a document with blocks', () => {
  it('reproduces it byte for byte, flow entries and comments included', () => {
    expect(parseWorkflow(WITH_BLOCKS).toString()).toBe(WITH_BLOCKS)
  })

  it('projects both boards, with ids scoped to the one they are on', () => {
    const doc = parseWorkflow(WITH_BLOCKS).toJSON()
    const block = doc.blocks?.[0]

    expect(block?.id).toBe('archive_entry')
    expect(block?.steps.map((step) => step.id)).toEqual(['put', 'ret'])
    expect(doc.steps.map((step) => step.id)).toEqual(['audit_1'])
  })

  it('keeps a declaration’s nested shape, which is what types a member', () => {
    const doc = parseWorkflow(WITH_BLOCKS).toJSON()
    expect(doc.blocks?.[0]?.params?.[0]?.of).toEqual([
      { k: 'headline', label: 'Headline', t: 'text' },
    ])
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
  // toString() detects edits by comparing serialisations, not by a `dirty`
  // flag a caller has to remember to set. A flag nobody sets means the CST is
  // replayed and every AST edit is silently discarded — and since this text is
  // what gets saved, the edits are reported written and lost.
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

describe('multi-document sources', () => {
  /*
   * Rejected at parse rather than kept and re-serialised: a Workflow Definition
   * is one mapping, the Host stores one blob per version, and there is nothing
   * for a second document to be.
   *
   * Composing only the first document while stringifying the whole CST is the
   * trap this avoids — such a file round-trips byte for byte untouched, and
   * then the first mutation drops everything after document one. Failing where
   * the caller still holds the text beats losing half of it at the first edit.
   */
  const TWO = `id: wf_a\nname: A\nversion: 1\nstatus: draft\nsteps: []\n---\nid: wf_b\nname: B\nversion: 1\nstatus: draft\nsteps: []\n`

  it('refuses a source holding more than one YAML document', () => {
    expect(() => parseWorkflow(TWO)).toThrow(/single YAML document; this source holds 2/)
  })

  it('says how to proceed, because the caller still has the text', () => {
    expect(() => parseWorkflow(TWO)).toThrow(/Split the file/)
  })

  it('still accepts a lone document that opens with an explicit `---`', () => {
    // The marker is not what makes a file multi-document, and a Host whose
    // exporter always writes one would otherwise have been locked out.
    const source = `---\nid: wf_a\nname: A\nversion: 1\nstatus: draft\nsteps: []\n`
    expect(parseWorkflow(source).toString()).toBe(source)
  })

  it('still accepts a trailing document-end marker', () => {
    const source = `id: wf_a\nname: A\nversion: 1\nstatus: draft\nsteps: []\n...\n`
    expect(parseWorkflow(source).toString()).toBe(source)
  })
})
