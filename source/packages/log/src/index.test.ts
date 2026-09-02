import { afterEach, describe, expect, it } from 'vitest'
import { configureLogging, type Line, levelsFrom, logger, resetLogging, setLogLevel } from './index'

const collected = (): { lines: Line[]; sink: (line: Line) => void } => {
  const lines: Line[] = []
  return { lines, sink: (line) => lines.push(line) }
}

afterEach(resetLogging)

describe('what is written by default', () => {
  /*
   * Hatua renders inside somebody else's product. A library that writes `info`
   * to a Host's console by default is one every integrator has to go and turn
   * off, and one whose noise buries their own logs.
   */
  it('says nothing below a warning until somebody asks', () => {
    const { lines, sink } = collected()
    configureLogging({ sink })

    const log = logger('services.editing')
    log.info('kept')
    log.debug('kept')
    log.trace('kept')

    expect(lines).toEqual([])
  })

  /*
   * A misconfiguration reaches an integrator who has not switched logging on,
   * precisely because they do not yet know anything is wrong.
   */
  it('lets a warning and an error through unasked', () => {
    const { lines, sink } = collected()
    configureLogging({ sink })

    logger('services.editing').warn('a port answered with the wrong shape')
    logger('react.fields').error('nothing to draw')

    expect(lines.map((one) => one.level)).toEqual(['warn', 'error'])
  })
})

describe('turning a category up', () => {
  it('writes that category and leaves the rest alone', () => {
    const { lines, sink } = collected()
    configureLogging({ sink, levels: { 'services.editing': 'trace' } })

    logger('services.editing').trace('applied', { command: 'setStepField' })
    logger('services.versions').trace('paged')

    expect(lines.map((one) => one.category)).toEqual(['services.editing'])
    expect(lines[0]?.detail).toEqual({ command: 'setStepField' })
  })

  it('covers what sits under it, because a category is a prefix', () => {
    const { lines, sink } = collected()
    configureLogging({ sink, levels: { services: 'debug' } })

    logger('services.editing').debug('one')
    logger('services.versions').debug('two')
    logger('react.fields').debug('three')

    expect(lines.map((one) => one.category)).toEqual(['services.editing', 'services.versions'])
  })

  /*
   * Longest prefix rather than first, so the two can both be set and the more
   * specific one wins whichever order they were written in.
   */
  it('lets the more specific setting win', () => {
    const { lines, sink } = collected()
    configureLogging({ sink, levels: { 'services.editing': 'warn', services: 'trace' } })

    logger('services.editing').debug('hidden by the specific rule')
    logger('services.versions').debug('shown by the general one')

    expect(lines.map((one) => one.category)).toEqual(['services.versions'])
  })

  it('takes everything when asked for everything', () => {
    const { lines, sink } = collected()
    configureLogging({ sink, levels: { '*': 'trace' } })

    logger('react.fields').trace('drawn')
    expect(lines).toHaveLength(1)
  })
})

describe('configuring twice', () => {
  it('merges rather than replacing, so turning one up does not reset the rest', () => {
    const { lines, sink } = collected()
    configureLogging({ sink, levels: { services: 'debug' } })
    configureLogging({ levels: { react: 'debug' } })

    logger('services.editing').debug('one')
    logger('react.fields').debug('two')

    expect(lines).toHaveLength(2)
  })
})

describe('a caller with work to do to build a line', () => {
  it('can ask whether the line would be written at all', () => {
    configureLogging({ levels: { services: 'debug' } })

    expect(logger('services.editing').enabled('debug')).toBe(true)
    expect(logger('services.editing').enabled('trace')).toBe(false)
    expect(logger('react.fields').enabled('debug')).toBe(false)
  })
})

describe('more than one copy of this module', () => {
  /*
   * A module holds its state once per instance, and nothing promises this
   * module is instantiated once: a dev server resolving symlinked workspace
   * packages, or a Host bundling `@hatua/react` while its own code imports
   * `@hatua/log`, gives the app one table and the packages another. Held in the
   * module, turning a category up changes a table nothing reads — and the
   * switch appears to do nothing at all, which is the one failure a logging
   * seam must not have.
   */
  it('shares its settings with the copies it cannot see', async () => {
    const { lines, sink } = collected()
    configureLogging({ sink, levels: { 'services.editing': 'debug' } })

    // A second evaluation of this module, which is what a duplicate import is.
    const second = (await import(`./index?copy=${Date.now()}`)) as typeof import('./index')
    second.logger('services.editing').debug('written by the other copy')

    expect(lines.map((one) => one.message)).toEqual(['written by the other copy'])
  })

  it('reports what is in force, so a console can show the switch took', () => {
    const settings = configureLogging({ levels: { react: 'trace' } })
    expect(settings.levels).toMatchObject({ '*': 'warn', react: 'trace' })
  })
})

describe('what the console sink writes', () => {
  const spied = () => {
    const calls: unknown[][] = []
    const original = { log: console.log, warn: console.warn, error: console.error }
    console.log = (...args: unknown[]) => calls.push(['log', ...args])
    console.warn = (...args: unknown[]) => calls.push(['warn', ...args])
    console.error = (...args: unknown[]) => calls.push(['error', ...args])
    return {
      calls,
      restore: () => {
        console.log = original.log
        console.warn = original.warn
        console.error = original.error
      },
    }
  }

  /*
   * The level first and the category second, both in the label, so a console
   * filter can be typed against either — `[DEBUG]` for everything noisy,
   * `[services.editing]` for one package's worth.
   */
  it('labels a line with its level and its category', () => {
    const { calls, restore } = spied()
    try {
      configureLogging({ levels: { 'services.editing': 'debug' } })
      logger('services.editing').debug('command applied')
    } finally {
      restore()
    }

    expect(String(calls[0]?.[1])).toContain('[DEBUG][services.editing]')
    expect(String(calls[0]?.[1])).toContain('command applied')
  })

  it('sends a warning and an error to the console channels that match', () => {
    const { calls, restore } = spied()
    try {
      logger('services.editing').warn('a port answered with the wrong shape')
      logger('services.editing').error('nothing to draw')
    } finally {
      restore()
    }

    expect(calls.map((one) => one[0])).toEqual(['warn', 'error'])
  })

  /*
   * Node's console prints the directive and the style string as text, which is
   * worse than no colour at all — so the plain form is what a terminal gets.
   */
  it('writes plainly where `%c` means nothing', () => {
    const { calls, restore } = spied()
    try {
      logger('services.editing').warn('said once')
    } finally {
      restore()
    }

    expect(String(calls[0]?.[1])).not.toContain('%c')
    expect(calls[0]).toHaveLength(2)
  })
})

describe('levels from a string', () => {
  /*
   * The form a person types under time pressure — into a console, a query
   * string, an environment variable. Every caller would otherwise write its own
   * splitter and get a different one wrong.
   */
  it('reads a category and a level', () => {
    expect(levelsFrom('services.editing:trace')).toEqual({ 'services.editing': 'trace' })
  })

  it('reads several, separated by commas and forgiving of spaces', () => {
    expect(levelsFrom(' services.editing:trace , react.fields:debug ')).toEqual({
      'services.editing': 'trace',
      'react.fields': 'debug',
    })
  })

  it('takes a bare level as everything, because that is what it means', () => {
    expect(levelsFrom('debug')).toEqual({ '*': 'debug' })
    expect(levelsFrom('*:debug')).toEqual({ '*': 'debug' })
  })

  /*
   * A typo yields nothing rather than a category set to a level that does not
   * exist — which would compare as unranked and silence the category it was
   * meant to open up.
   */
  it('drops what is not a level at all', () => {
    expect(levelsFrom('services:verbose')).toEqual({})
    expect(levelsFrom('[object Object]')).toEqual({})
  })

  it('turns a spec straight into lines being written', () => {
    const { lines, sink } = collected()
    configureLogging({ sink, levels: levelsFrom('react.fields:debug') })

    logger('react.fields').debug('written')
    logger('services.editing').debug('not written')

    expect(lines.map((one) => one.message)).toEqual(['written'])
  })
})

describe('turning a level on from code', () => {
  /*
   * What a `console.log` used to be for: a line put where the question is, and
   * deleted an hour later. Going through `configureLogging({ levels: … })` asks
   * for a nested object at the moment attention is elsewhere.
   */
  it('takes the spec a person types', () => {
    const { lines, sink } = collected()
    configureLogging({ sink })
    setLogLevel('react.fields:debug')

    logger('react.fields').debug('written')
    expect(lines.map((one) => one.message)).toEqual(['written'])
  })

  it('complains rather than doing nothing when the spec is unusable', () => {
    const said: unknown[] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => said.push(args[0])
    try {
      setLogLevel('verbose-ish')
    } finally {
      console.warn = original
    }

    expect(String(said[0])).toContain('nothing usable')
  })
})
