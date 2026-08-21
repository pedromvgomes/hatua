import { parseWorkflow } from '@hatua/document'
import { coreFunctions, validate } from '@hatua/expressions'
import { scopeFor } from '@hatua/model'
import { describe, expect, it } from 'vitest'
import { addVariable, removeVariable, renameVariable, setVariableValue } from './variables'

/**
 * The variable commands against a document directly.
 *
 * Two things are being protected. The first is the round trip: a variable is
 * added, renamed and removed out of a file that lives in the Host's repository,
 * and the comments, key order and quoting around it come back untouched
 * (ADR-0001). The second is the consequence of editing one — `varType` reads a
 * variable's type off its value, so a value box is also a type control, and the
 * last test here follows that all the way to a verdict.
 */

const SOURCE = `# The overnight triage.
id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft

vars:
  # Where the digest goes.
  - key: digest_to
    value: "ops@example.com"
  - key: threshold
    value: 10

steps:
  - id: s1
    use: email.fetch
`

const apply = (yaml: string, ...commands: ReturnType<typeof addVariable>[]) => {
  const document = parseWorkflow(yaml)
  for (const command of commands) command.apply(document)
  return document
}

const varsOf = (yaml: string) => {
  const projected = parseWorkflow(yaml).validate()
  if (!projected.success) throw new Error('not a Workflow Definition')
  return projected.data.vars ?? []
}

describe('addVariable', () => {
  it('appends, so an existing variable cannot lose sight of what it reads', () => {
    // Order is meaningful: a variable may read the ones declared before it, so
    // inserting above an existing row would change what that row may see.
    const text = apply(SOURCE, addVariable()).toString()
    expect(varsOf(text).map((v) => v.key)).toEqual(['digest_to', 'threshold', 'new_variable'])
  })

  it('mints a key rather than leaving a blank one the schema refuses', () => {
    const once = apply(SOURCE, addVariable()).toString()
    const twice = apply(once, addVariable()).toString()
    expect(varsOf(twice).map((v) => v.key)).toContain('new_variable_2')
    expect(parseWorkflow(twice).validate().success).toBe(true)
  })

  it('takes a key when the caller has one', () => {
    const text = apply(SOURCE, addVariable('digest_subject')).toString()
    expect(varsOf(text).map((v) => v.key)).toContain('digest_subject')
  })

  it('creates `vars:` in its schema position when the document has none', () => {
    const bare = 'id: wf\nname: n\nversion: 1\nstatus: draft\nsteps: []\n'
    const text = apply(bare, addVariable()).toString()
    // Before `steps:`, where the schema documents it — a person reads the diff.
    expect(text.indexOf('vars:')).toBeGreaterThan(-1)
    expect(text.indexOf('vars:')).toBeLessThan(text.indexOf('steps:'))
    expect(parseWorkflow(text).validate().success).toBe(true)
  })

  it('keeps the user’s comments and quoting, which is the round-trip promise', () => {
    const text = apply(SOURCE, addVariable()).toString()
    expect(text).toContain('# The overnight triage.')
    expect(text).toContain('# Where the digest goes.')
    expect(text).toContain('name: "Morning inbox triage"')
    expect(text).toContain('value: "ops@example.com"')
  })
})

describe('removeVariable', () => {
  it('removes the one named and leaves its neighbour', () => {
    const text = apply(SOURCE, removeVariable('threshold')).toString()
    expect(varsOf(text).map((v) => v.key)).toEqual(['digest_to'])
  })

  it('takes the comment above a variable with it, not the one below', () => {
    // A comment above the FIRST item of a block sequence is anchored to the
    // sequence, so without lifting it onto the item it stays behind and ends up
    // labelling whatever moves up.
    const text = apply(SOURCE, removeVariable('digest_to')).toString()
    expect(varsOf(text).map((v) => v.key)).toEqual(['threshold'])
    expect(text).not.toContain('# Where the digest goes.')
    expect(text).toContain('# The overnight triage.')
  })

  it('throws for a variable that is not there, so the store records nothing', () => {
    expect(() => apply(SOURCE, removeVariable('nope'))).toThrow(/no variable named/i)
  })
})

describe('renameVariable', () => {
  it('renames the key and rewrites no Reference', () => {
    // Settled in docs/handoff.md: a Reference is stored verbatim, the rename is
    // allowed, and `{{ var.digest_to }}` goes stale and is reported like any
    // other stale Reference rather than being repaired behind the user.
    const withReference = `${SOURCE}    with:\n      to: "{{ var.digest_to }}"\n`
    const text = apply(withReference, renameVariable('digest_to', 'digest_recipient')).toString()

    expect(varsOf(text).map((v) => v.key)).toEqual(['digest_recipient', 'threshold'])
    expect(text).toContain('{{ var.digest_to }}')
  })

  it('keeps every comment through the rename', () => {
    const text = apply(SOURCE, renameVariable('digest_to', 'recipient')).toString()
    expect(text).toContain('# Where the digest goes.')
    expect(text).toContain('value: "ops@example.com"')
  })
})

describe('setVariableValue', () => {
  it('stores what the text denotes, the way Text Mode would read it', () => {
    // Both directions have to agree (ADR-0001): typing `7` here and typing `7`
    // into the same key in Text Mode must leave the document meaning one thing.
    const text = apply(
      SOURCE,
      setVariableValue('threshold', '25'),
      setVariableValue('digest_to', 'team@example.com'),
    ).toString()

    const [to, threshold] = varsOf(text)
    expect(threshold?.value).toBe(25)
    expect(to?.value).toBe('team@example.com')
  })

  it('stores a Template as text, holes and all', () => {
    const text = apply(SOURCE, setVariableValue('digest_to', '{{ triggers.t1.from }}')).toString()
    expect(varsOf(text)[0]?.value).toBe('{{ triggers.t1.from }}')
  })

  it('leaves what does not round-trip alone rather than normalising it', () => {
    // `007` is not the number 7 written differently — it is what the user
    // typed, and a value box that rewrites it is worse than one that does not
    // understand it.
    const text = apply(SOURCE, setVariableValue('threshold', '007')).toString()
    expect(varsOf(text)[1]?.value).toBe('007')
  })

  it('turns a quoted value into a number, which quoting-preservation would forbid', () => {
    const text = apply(SOURCE, setVariableValue('digest_to', '3')).toString()
    expect(varsOf(text)[0]?.value).toBe(3)
  })
})

describe('editing a variable changes what an Expression checks against', () => {
  /**
   * The consequence of `varType`: a variable is the one addressable thing with
   * no declaration to consult, so its type is read off its value. Editing one
   * therefore re-types every Expression that reads it.
   *
   * Through `@hatua/expressions` over `scopeFor` output, which is where
   * expression type-checking happens. The validation store does none — it
   * checks required fields, unknown components and malformed containers.
   */
  const verdicts = (yaml: string, template: string, expected: 'text' | 'number') => {
    const projected = parseWorkflow(yaml).validate()
    if (!projected.success) throw new Error('not a Workflow Definition')
    return validate(template, expected, {
      scope: scopeFor(projected.data, 's1'),
      functions: coreFunctions(),
    })
  }

  it('goes from clean to reported when a number field starts reading text', () => {
    const asNumber = apply(SOURCE, setVariableValue('threshold', '25')).toString()
    expect(verdicts(asNumber, '{{ var.threshold }}', 'number')).toEqual([])

    const asText = apply(SOURCE, setVariableValue('threshold', 'twenty five')).toString()
    expect(verdicts(asText, '{{ var.threshold }}', 'number')).not.toEqual([])
  })

  it('clears the report when the value is edited back, in the same field', () => {
    const asText = apply(SOURCE, setVariableValue('threshold', 'twenty five')).toString()
    const reported = verdicts(asText, '{{ var.threshold }}', 'number')
    expect(reported).toHaveLength(1)

    const repaired = apply(asText, setVariableValue('threshold', '25')).toString()
    expect(verdicts(repaired, '{{ var.threshold }}', 'number')).toEqual([])
  })
})
