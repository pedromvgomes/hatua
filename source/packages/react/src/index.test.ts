import { describe, expect, it } from 'vitest'
import * as api from './index'

/**
 * The published surface, asserted as a set rather than one export at a time.
 *
 * A barrel is the one file where a mistake is invisible: dropping a re-export
 * still compiles everywhere inside the package, because nothing here imports
 * through the barrel — only Hosts do. This is the test that notices.
 */
describe('@hatua/react exports', () => {
  it('exports exactly the public surface', () => {
    expect(Object.keys(api).sort()).toEqual([
      'Build',
      'Button',
      'Components',
      'ConfirmDialog',
      'Data',
      'FlowMap',
      'Hatua',
      'HatuaProvider',
      'Input',
      'Inspector',
      'Select',
      'StepList',
      'TabbedPanel',
      'Toast',
      'Toggle',
      'TopBar',
      'Workflow',
      'createTheme',
    ])
  })

  /**
   * ADR-0003's claim is that a Host embedding one part does not pay for the
   * rest, and that only holds if a part can be imported without dragging the
   * container in. A static property would make that impossible — you cannot
   * reach Hatua.FlowMap without evaluating Hatua — so every part is a named
   * export and nothing hangs off <Hatua> itself.
   */
  it('exports the parts individually, not as properties of Hatua', () => {
    for (const part of [
      'Build',
      'TopBar',
      'FlowMap',
      'StepList',
      'Inspector',
      'Components',
      'Workflow',
    ]) {
      expect(api).toHaveProperty(part)
      expect(api.Hatua).not.toHaveProperty(part)
    }
  })

  it('exports them as callables a Host can actually render', () => {
    for (const [name, value] of Object.entries(api)) {
      expect(typeof value, name).toBe('function')
    }
  })
})
