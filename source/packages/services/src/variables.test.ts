import { parseWorkflow } from '@hatua/document'
import { coreFunctions, validate } from '@hatua/expressions'
import { scopeFor } from '@hatua/model'
import { describe, expect, it } from 'vitest'
import {
  addVariable,
  removeVariable,
  renameVariable,
  setVariableType,
  setVariableValue,
} from './variables'

/**
 * The variable commands against a document directly.
 *
 * Two things are being protected. The first is the round trip: a variable is
 * added, renamed and removed out of a file that lives in the Host's repository,
 * and the comments, key order and quoting around it come back untouched
 * (ADR-0001). The second is which edit re-types a variable: `t` is declared, so
 * the type control moves every downstream verdict and the value box moves none,
 * and the last tests here follow both all the way to a verdict.
 */

const SOURCE = `# The overnight triage.
id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft

vars:
  # Where the digest goes.
  - key: digest_to
    t: text
    value: "ops@example.com"
  - key: threshold
    t: number
    value: 10

steps:
  - id: s1
    use: component.email.fetch
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

  it('keeps counting past the second minted key', () => {
    // Deterministic, so the same edits produce the same document twice — which
    // is what makes the round-trip assertable and the diff readable.
    let text = SOURCE
    for (let n = 0; n < 3; n++) text = apply(text, addVariable()).toString()

    expect(varsOf(text).map((v) => v.key)).toEqual([
      'digest_to',
      'threshold',
      'new_variable',
      'new_variable_2',
      'new_variable_3',
    ])
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
  /* A named edit repairs what it invalidates (ADR-0021). */
  it('renames the key and rewrites every Reference that read it', () => {
    const withReference = `${SOURCE}    with:\n      to: "{{ var.digest_to }}"\n`
    const text = apply(withReference, renameVariable('digest_to', 'digest_recipient')).toString()

    expect(varsOf(text).map((v) => v.key)).toEqual(['digest_recipient', 'threshold'])
    expect(text).toContain('{{ var.digest_recipient }}')
    expect(text).not.toContain('{{ var.digest_to }}')
  })

  /* The walk is over Reference nodes, not over whether the Template is one —
     a computed hole names the variable exactly as much as a bare path does. */
  it('rewrites a Reference inside a computed hole', () => {
    const withReference = `${SOURCE}    with:\n      to: "{{ text.upper(var.digest_to) }}!"\n`
    const text = apply(withReference, renameVariable('digest_to', 'recipient')).toString()

    expect(text).toContain('{{ text.upper(var.recipient) }}!')
  })

  /*
   * A Board's variables are its own, so `{{ var.x }}` on the root and inside a
   * Block are different names. A rewrite that walked the document would repair
   * one by corrupting the other.
   */
  it('leaves a Block’s Templates alone when a root variable is renamed', () => {
    const bothBoards = `id: wf
name: n
version: 1
status: draft

vars:
  - key: digest_to
    t: text
    value: "root"

blocks:
  - id: inner
    vars:
      - key: digest_to
        t: text
        value: "the block's own"
    steps:
      - id: b1
        use: component.email.send
        with:
          to: "{{ var.digest_to }}"

steps:
  - id: s1
    use: component.email.send
    with:
      to: "{{ var.digest_to }}"
`
    const text = apply(bothBoards, renameVariable('digest_to', 'root_only', null)).toString()

    // The root's Step follows its rename; the Block's Step still reads the
    // variable the Block declares, which was not renamed.
    expect(text).toContain('to: "{{ var.root_only }}"')
    expect(text).toContain('to: "{{ var.digest_to }}"')
    expect(text.match(/var\.root_only/g)).toHaveLength(1)
  })

  /* The mirror of it: renaming the Block's own key leaves the root's alone. */
  it('leaves the root’s Templates alone when a Block’s variable is renamed', () => {
    const bothBoards = `id: wf
name: n
version: 1
status: draft

vars:
  - key: shared
    t: text
    value: "root"

blocks:
  - id: inner
    vars:
      - key: shared
        t: text
        value: "block"
    steps:
      - id: b1
        use: component.email.send
        with:
          to: "{{ var.shared }}"

steps:
  - id: s1
    use: component.email.send
    with:
      to: "{{ var.shared }}"
`
    const text = apply(bothBoards, renameVariable('shared', 'inner_only', 'inner')).toString()

    expect(text.match(/var\.inner_only/g)).toHaveLength(1)
    expect(text.match(/var\.shared/g)).toHaveLength(1)
  })

  /* A longer key that merely begins the same way is a different variable. */
  it('leaves a Reference to a key that only starts the same way', () => {
    const withReference = `${SOURCE}    with:\n      to: "{{ var.digest_to_cc }}"\n`
    const text = apply(withReference, renameVariable('digest_to', 'sent_to')).toString()

    expect(text).toContain('{{ var.digest_to_cc }}')
  })

  /* The collision throws before a character of the user's file has moved. */
  it('leaves every Reference alone when the rename is refused', () => {
    const withReference = `${SOURCE}    with:\n      to: "{{ var.digest_to }}"\n`
    const document = parseWorkflow(withReference)
    expect(() => renameVariable('digest_to', 'threshold').apply(document)).toThrow(/already exists/)
    expect(document.toString()).toContain('{{ var.digest_to }}')
  })

  it('refuses a key another variable already has', () => {
    // Two rows under one key is worse than a refused rename: every reader here
    // finds the FIRST match, so the second row's bin deletes the first and its
    // value box edits the first one's value — and `{{ var.threshold }}` becomes
    // a Reference with two answers and no diagnostic.
    expect(() => apply(SOURCE, renameVariable('digest_to', 'threshold'))).toThrow(/already exists/)
    expect(varsOf(apply(SOURCE).toString()).map((v) => v.key)).toEqual(['digest_to', 'threshold'])
  })

  it('allows renaming a key to itself, which is what an unchanged box commits', () => {
    const text = apply(SOURCE, renameVariable('digest_to', 'digest_to')).toString()
    expect(varsOf(text).map((v) => v.key)).toEqual(['digest_to', 'threshold'])
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

describe('retyping a variable changes what an Expression checks against', () => {
  /**
   * The consequence of declaring `t`: the type control is what re-types every
   * Expression reading the variable, and the value box is not — because a
   * `core.set_var` writes the same variable from a Step, so the literal in the
   * document is only what it starts as.
   *
   * Through `@hatua/expressions` over `scopeFor` output, which is where
   * expression type-checking happens. The validation store does none — it
   * checks required fields, unknown components and malformed containers.
   */
  const verdicts = (yaml: string, template: string, expected: 'text' | 'number') => {
    const projected = parseWorkflow(yaml).validate()
    if (!projected.success) throw new Error('not a Workflow Definition')
    return validate(template, expected, {
      scope: scopeFor(projected.data, { board: null, id: 's1' }),
      functions: coreFunctions(),
    })
  }

  it('goes from clean to reported when a number field starts reading text', () => {
    expect(verdicts(SOURCE, '{{ var.threshold }}', 'number')).toEqual([])

    const asText = apply(SOURCE, setVariableType('threshold', 'text')).toString()
    expect(verdicts(asText, '{{ var.threshold }}', 'number')).not.toEqual([])
  })

  it('clears the report when the type is set back, in the same control', () => {
    const asText = apply(SOURCE, setVariableType('threshold', 'text')).toString()
    expect(verdicts(asText, '{{ var.threshold }}', 'number')).toHaveLength(1)

    const repaired = apply(asText, setVariableType('threshold', 'number')).toString()
    expect(verdicts(repaired, '{{ var.threshold }}', 'number')).toEqual([])
  })

  it('leaves the marking alone when only the value changes, because the value is only the first one', () => {
    const written = apply(SOURCE, setVariableValue('threshold', 'twenty five')).toString()
    expect(verdicts(written, '{{ var.threshold }}', 'number')).toEqual([])
  })
})

/**
 * A key the schema cannot hold.
 *
 * `Variable 1` is not an `identifier`, so writing it stops the whole document
 * projecting — and every surface in the product reads the projection, so one
 * committed keystroke empties the canvas, the side panel and the step editor
 * together. Refused by name here, so a field has something to report;
 * `EditingStore.apply` refuses the outcome generically underneath.
 */
describe('a name the document cannot address', () => {
  it('refuses a rename onto one, whatever is wrong with it', () => {
    for (const bad of ['Variable 1', 'digest-to', '1st', '', 'olá']) {
      expect(() => apply(SOURCE, renameVariable('digest_to', bad)), bad).toThrow(/usable name/)
    }
  })

  it('still allows every name the schema does hold', () => {
    for (const good of ['digest_cc', '_private', 'a1', 'A_LONG_ONE']) {
      const text = apply(SOURCE, renameVariable('digest_to', good)).toString()
      expect(varsOf(text).map((variable) => variable.key)).toContain(good)
    }
  })

  it('refuses one handed to addVariable, rather than writing a row that stops projecting', () => {
    expect(() => apply(SOURCE, addVariable('Variable 1'))).toThrow(/usable name/)
  })

  /* A minted key is the command's own and is always one the schema holds. */
  it('mints without complaint when no key is given', () => {
    const text = apply(SOURCE, addVariable()).toString()
    expect(varsOf(text).map((variable) => variable.key)).toContain('new_variable')
  })
})
