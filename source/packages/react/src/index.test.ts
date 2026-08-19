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
      'Button',
      'ConfirmDialog',
      'Hatua',
      'Input',
      'Select',
      'Toast',
      'Toggle',
      'createTheme',
    ])
  })

  it('exports them as callables a Host can actually render', () => {
    for (const [name, value] of Object.entries(api)) {
      expect(typeof value, name).toBe('function')
    }
  })
})
