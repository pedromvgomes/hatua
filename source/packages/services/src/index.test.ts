import { describe, expect, it } from 'vitest'
import * as api from './index'

/**
 * The package's surface, as one list.
 *
 * @hatua/react is the only consumer, and it re-exports the port types onward to
 * the Host — so a name that vanishes from here breaks a Host's `implements`
 * rather than anything in this repository, and it does it at their build rather
 * than at ours. A barrel with `export *` in it cannot report that: adding a
 * module is one line and removing a symbol is none, and neither shows up as a
 * failing test anywhere.
 *
 * So the list is written down. It is not a snapshot — a snapshot would be
 * updated by whoever broke it, which is the same as not having one. Changing it
 * is meant to take a line of thought about who was depending on the old name.
 *
 * Types are absent by construction: they do not exist at runtime, so
 * `ManifestSource`, `WorkflowStore` and the rest cannot appear below. What is
 * checked here is the runtime half — the stores and the commands.
 */
const SURFACE = [
  // The stores a region subscribes to.
  'createConnectionStore',
  'createEditingStore',
  'createManifestStore',
  'createValidationStore',

  // Paging, which a Host's port is drained with.
  'drain',

  // Composition.
  'sequence',

  // Commands: the Step tree.
  'addStep',
  'moveStep',
  'removeStep',
  'rootStepCount',
  'stepIn',

  // Commands: the workflow's own keys.
  'addTrigger',
  'declareConnection',
  'removeTrigger',
  'setTriggerField',
  'setTriggerName',
  'setWorkflowName',
  'setWorkflowSlug',

  // Commands: the variables.
  'addVariable',
  'removeVariable',
  'renameVariable',
  'setVariableValue',
].sort()

describe('the package surface', () => {
  it('exports exactly what it means to', () => {
    expect(Object.keys(api).sort()).toEqual(SURFACE)
  })

  it('exports them as callables, because every one of them is called', () => {
    for (const [name, value] of Object.entries(api)) {
      expect(typeof value, name).toBe('function')
    }
  })

  it('builds a command that names what an undo control would say', () => {
    // Every command carries a label, and it is the one thing about a command a
    // caller reads rather than applies.
    const commands = [
      api.addStep({ use: 'component.email.send', name: 'Reply' }, { index: 0 }),
      api.removeStep('s1'),
      api.moveStep('s1', { index: 1 }),
      api.addTrigger({ use: 'component.schedule.cron' }),
      api.removeTrigger('t1'),
      api.setTriggerName('t1', 'Nightly'),
      api.setTriggerField('t1', 'at', '0 6 * * *'),
      api.setWorkflowName('Renamed'),
      api.setWorkflowSlug('renamed'),
      api.declareConnection('ops', 'ref_ops'),
      api.addVariable(),
      api.removeVariable('digest_to'),
      api.renameVariable('digest_to', 'to'),
      api.setVariableValue('digest_to', 'ops@example.com'),
    ]

    for (const command of commands) {
      expect(typeof command.label, JSON.stringify(command.label)).toBe('string')
      expect(command.label.length).toBeGreaterThan(0)
      expect(typeof command.apply).toBe('function')
    }
  })
})
