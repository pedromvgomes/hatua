import { afterEach, describe, expect, it } from 'vitest'
import { configureLogging, type Line, logger, resetLogging } from './index'

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
