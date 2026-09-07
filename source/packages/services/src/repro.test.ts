import { parseWorkflow } from '@hatua/document'
import { describe, expect, it } from 'vitest'
import { sequence } from './command'
import { declareConnection, setStepField } from './index'

const SEED = `id: wf_morning
name: "Morning inbox triage"
version: 1
status: draft

connections:
  - id: mailbox
    ref: cx_9f2a

steps:
  - id: s1
    use: component.agent.act
    name: "Sort by urgency"
    # The Model connection is deliberately left empty: the Flow tab marks a
    # Step that is not filled in, and a workflow where nothing is wrong shows
    # nothing to look at.
  - id: s2
    use: core.fork
    name: "How much came in?"
`

describe('repro', () => {
  it('declares and points on a step whose last line is a comment', () => {
    const doc = parseWorkflow(SEED)
    const cmd = sequence(
      'Use claude',
      declareConnection('claude_code_haiku_4_5', 'cx_7c04'),
      setStepField({ board: null, id: 's1' }, 'connection', 'claude_code_haiku_4_5'),
    )
    cmd.apply(doc)
    console.log('---- after ----')
    console.log(doc.toString())
    const projection = doc.validate()
    console.log('projects:', projection.success)
    if (!projection.success) console.log(projection.error.issues[0])
    expect(projection.success).toBe(true)
  })
})
