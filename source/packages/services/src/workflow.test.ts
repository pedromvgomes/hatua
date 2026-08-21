import { parseWorkflow, type WorkflowDocument } from '@hatua/document'
import { describe, expect, it } from 'vitest'
import type { EditCommand } from './command'
import { sequence } from './command'
import {
  addTrigger,
  declareConnection,
  removeTrigger,
  setTriggerField,
  setTriggerName,
  setWorkflowName,
  setWorkflowSlug,
} from './workflow'

/**
 * The identity and Trigger commands against a document directly.
 *
 * A Trigger is not a Step: it is one entry of a top-level list, reachable by id
 * and nothing else. `removeStep` cannot find one, `walkSteps` does not yield
 * one, and neither can this file's commands reach into `steps:`.
 */

const SOURCE = `# Runs before anyone is awake.
id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft

triggers:
  # Every weekday at six.
  - id: t1
    use: schedule.cron
    name: "Every morning"
    with:
      at: "0 6 * * 1-5"
  - id: t2
    use: email.received
    name: "When mail arrives"

steps:
  - id: s1
    use: email.fetch
`

const apply = (yaml: string, ...commands: EditCommand[]): WorkflowDocument => {
  const document = parseWorkflow(yaml)
  for (const command of commands) command.apply(document)
  return document
}

const definitionOf = (yaml: string) => {
  const projected = parseWorkflow(yaml).validate()
  if (!projected.success) throw new Error(projected.error.issues[0]?.message)
  return projected.data
}

describe('identity', () => {
  it('renames the workflow, keeping the quoting the user wrote', () => {
    // Hatua does not own the file's formatting (ADR-0001), so a rename must not
    // arrive as a change of quoting style as well.
    const text = apply(SOURCE, setWorkflowName('Overnight triage')).toString()
    expect(definitionOf(text).name).toBe('Overnight triage')
    expect(text).toContain('name: "Overnight triage"')
  })

  it('sets the slug, which is the `id:` key the top bar renders', () => {
    const text = apply(SOURCE, setWorkflowSlug('overnight-triage')).toString()
    expect(definitionOf(text).id).toBe('overnight-triage')
  })

  it('leaves everything around it alone', () => {
    const text = apply(
      SOURCE,
      setWorkflowName('Overnight triage'),
      setWorkflowSlug('overnight-triage'),
    ).toString()

    expect(text).toContain('# Runs before anyone is awake.')
    expect(text).toContain('# Every weekday at six.')
    expect(text).toContain('at: "0 6 * * 1-5"')
    // Key order is the user's, and neither command reorders the mapping.
    expect(text.indexOf('id:')).toBeLessThan(text.indexOf('name:'))
  })
})

describe('addTrigger', () => {
  it('appends and mints the next free id', () => {
    const text = apply(SOURCE, addTrigger({ use: 'http.webhook', name: 'On a call' })).toString()
    const triggers = definitionOf(text).triggers ?? []

    expect(triggers.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    expect(triggers[2]?.use).toBe('http.webhook')
    expect(triggers[2]?.name).toBe('On a call')
  })

  it('keeps minting past the ids the document already has', () => {
    let text = SOURCE
    for (let n = 0; n < 3; n++) text = apply(text, addTrigger({ use: 'http.webhook' })).toString()

    expect((definitionOf(text).triggers ?? []).map((t) => t.id)).toEqual([
      't1',
      't2',
      't3',
      't4',
      't5',
    ])
  })

  it('writes `id`, `use`, `name` in the order the schema documents them', () => {
    // A Workflow Definition lives in the Host's repository and a person reads
    // the diff.
    const text = apply(SOURCE, addTrigger({ use: 'http.webhook', name: 'On a call' })).toString()
    const added = text.slice(text.indexOf('- id: t3'))
    expect(added.indexOf('use:')).toBeLessThan(added.indexOf('name:'))
  })

  it('creates `triggers:` in its schema position when the document has none', () => {
    const bare = 'id: wf\nname: n\nversion: 1\nstatus: draft\nsteps: []\n'
    const text = apply(bare, addTrigger({ use: 'schedule.cron' })).toString()

    expect(text.indexOf('triggers:')).toBeGreaterThan(text.indexOf('status:'))
    expect(text.indexOf('triggers:')).toBeLessThan(text.indexOf('steps:'))
    expect(definitionOf(text).triggers?.[0]?.id).toBe('t1')
  })

  it('refuses a `triggers:` key holding something that is not a list', () => {
    // Half-typed, not absent. Replacing it would discard text the user is in
    // the middle of writing.
    const half = 'id: wf\nname: n\nversion: 1\nstatus: draft\ntriggers: tomorrow\nsteps: []\n'
    expect(() => apply(half, addTrigger({ use: 'schedule.cron' }))).toThrow(/not a list/)
  })

  it('refuses a `triggers:` key written as a mapping, and leaves it intact', () => {
    // A mapping carries an `items` array too, so recognising a sequence by
    // shape accepts this — and the spliced node then makes the whole document
    // unserialisable, from a `toString()` no caller expects to fail.
    const mapping = 'id: wf\nname: n\nversion: 1\nstatus: draft\ntriggers:\n  cron: daily\n'
    const document = parseWorkflow(mapping)

    expect(() => addTrigger({ use: 'schedule.cron' }).apply(document)).toThrow(/not a list/)
    expect(document.toString()).toBe(mapping)
  })

  it('keeps every comment in the file', () => {
    const text = apply(SOURCE, addTrigger({ use: 'http.webhook' })).toString()
    expect(text).toContain('# Runs before anyone is awake.')
    expect(text).toContain('# Every weekday at six.')
  })
})

describe('removeTrigger', () => {
  it('removes the one named and leaves its neighbour', () => {
    const text = apply(SOURCE, removeTrigger('t2')).toString()
    expect((definitionOf(text).triggers ?? []).map((t) => t.id)).toEqual(['t1'])
  })

  it('takes the comment above it, rather than leaving it to label the next one', () => {
    const text = apply(SOURCE, removeTrigger('t1')).toString()
    expect((definitionOf(text).triggers ?? []).map((t) => t.id)).toEqual(['t2'])
    expect(text).not.toContain('# Every weekday at six.')
    expect(text).toContain('# Runs before anyone is awake.')
  })

  it('throws for a Trigger that is not there, so the store records nothing', () => {
    expect(() => apply(SOURCE, removeTrigger('t9'))).toThrow(/no trigger with id/i)
  })

  it('cannot reach a Step, because a Trigger is not one', () => {
    expect(() => apply(SOURCE, removeTrigger('s1'))).toThrow(/no trigger with id/i)
    expect(definitionOf(apply(SOURCE).toString()).steps).toHaveLength(1)
  })
})

describe('setTriggerName', () => {
  it('renames without disturbing the comments or the id a Reference points at', () => {
    const text = apply(SOURCE, setTriggerName('t1', 'Weekday mornings')).toString()
    const [first] = definitionOf(text).triggers ?? []

    expect(first?.name).toBe('Weekday mornings')
    expect(first?.id).toBe('t1')
    expect(text).toContain('# Every weekday at six.')
    expect(text).toContain('at: "0 6 * * 1-5"')
  })
})

describe('setTriggerField', () => {
  it('writes into `with:` under the manifest’s key', () => {
    const text = apply(SOURCE, setTriggerField('t1', 'at', '0 7 * * *')).toString()
    expect((definitionOf(text).triggers ?? [])[0]?.with?.at).toBe('0 7 * * *')
  })

  it('creates `with:` for a Trigger that has none yet', () => {
    const text = apply(SOURCE, setTriggerField('t2', 'folder', 'INBOX')).toString()
    expect((definitionOf(text).triggers ?? [])[1]?.with?.folder).toBe('INBOX')
  })

  it('stores a Template verbatim, holes and all', () => {
    const text = apply(SOURCE, setTriggerField('t2', 'folder', '{{ var.mailbox }}')).toString()
    expect((definitionOf(text).triggers ?? [])[1]?.with?.folder).toBe('{{ var.mailbox }}')
  })
})

describe('a document that does not project', () => {
  /*
   * The state ADR-0001 forces on every command: someone is halfway through
   * typing in Text Mode, so `toJSON()` throws — and that is exactly when they
   * are trying to edit their way out of it. Every command reads the loose
   * projection instead.
   */
  const HALF = 'name: half written\ntriggers:\n  - id: t1\n    use: schedule.cron\n'

  it('still finds a Trigger', () => {
    expect(parseWorkflow(HALF).validate().success).toBe(false)
    const text = apply(HALF, setTriggerName('t1', 'Named')).toString()
    expect(text).toContain('name: Named')
  })

  it('still adds and removes one', () => {
    const added = apply(HALF, addTrigger({ use: 'email.received' })).toString()
    expect(added).toContain('id: t2')
    expect(apply(added, removeTrigger('t1')).toString()).not.toContain('id: t1')
  })

  it('skips a bare `-` rather than compacting the list under it', () => {
    // A null item is what a user halfway through typing has, and the index a
    // command uses has to stay the index the document holds — filtering the
    // list first renumbers everything after the hole and removes the wrong one.
    const hole = 'triggers:\n  -\n  - id: t1\n    use: schedule.cron\n'
    const text = apply(hole, removeTrigger('t1')).toString()
    expect(text).toMatch(/^ {2}- ?$/m)
    expect(text).not.toContain('id: t1')
  })
})

describe('declareConnection', () => {
  /*
   * A `conn` field stores the workflow-local NAME, never the Host's handle:
   * `connections[]` holds the `ref` once and every field points at the id,
   * which is what lets the Host rename a Connection without touching a field.
   */
  it('binds a handle to a name, in the schema’s key position', () => {
    const bare = 'id: wf\nname: n\nversion: 1\nstatus: draft\nsteps: []\n'
    const text = apply(bare, declareConnection('ops_mailbox', 'ref_ops')).toString()

    expect(definitionOf(text).connections).toEqual([{ id: 'ops_mailbox', ref: 'ref_ops' }])
    // Before `triggers:` and `steps:`, where the schema documents it.
    expect(text.indexOf('connections:')).toBeLessThan(text.indexOf('steps:'))
  })

  it('refuses a handle the workflow already binds, and says what it is called', () => {
    // Two names for one handle is a workflow with connections nobody can tell
    // apart. Refusing rather than returning quietly matters because this is
    // composed with the command that points a field at the new name: a silent
    // no-op would leave the field naming a Connection nothing declares.
    const once = apply(SOURCE, declareConnection('ops_mailbox', 'ref_ops')).toString()
    expect(() => apply(once, declareConnection('ops_again', 'ref_ops'))).toThrow(
      /already declared as "ops_mailbox"/,
    )
  })

  it('refuses to reuse a name that is taken by another handle', () => {
    const once = apply(SOURCE, declareConnection('mailbox', 'ref_ops')).toString()
    expect(() => apply(once, declareConnection('mailbox', 'ref_other'))).toThrow(/already exists/)
  })

  it('keeps every comment in the file', () => {
    const text = apply(SOURCE, declareConnection('ops_mailbox', 'ref_ops')).toString()
    expect(text).toContain('# Runs before anyone is awake.')
    expect(text).toContain('# Every weekday at six.')
  })
})

describe('sequence', () => {
  it('records several commands as one undoable change', () => {
    // Picking a Connection the workflow does not declare yet is two edits and
    // one thing the user did. Left as two, undo puts the field back and leaves
    // a Connection nobody declared behind.
    const command = sequence(
      'Use ops_mailbox',
      declareConnection('ops_mailbox', 'ref_ops'),
      setTriggerField('t1', 'connection', 'ops_mailbox'),
    )
    const text = apply(SOURCE, command).toString()
    const definition = definitionOf(text)

    expect(command.label).toBe('Use ops_mailbox')
    expect(definition.connections).toEqual([{ id: 'ops_mailbox', ref: 'ref_ops' }])
    expect((definition.triggers ?? [])[0]?.with?.connection).toBe('ops_mailbox')
  })

  it('throws out of the member that failed, leaving the store to roll back', () => {
    // All-or-nothing comes from the store restoring the previous text, which
    // ADR-0001 makes lossless — not from anything this helper does.
    expect(() =>
      apply(
        SOURCE,
        sequence(
          'Both',
          declareConnection('ops_mailbox', 'ref_ops'),
          setTriggerField('t9', 'connection', 'ops_mailbox'),
        ),
      ),
    ).toThrow(/No Trigger with id/)
  })
})
