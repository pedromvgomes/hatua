/**
 * Levelled, categorised diagnostics for the parts of Hatua that decide things
 * without drawing them.
 *
 * The store refuses a command, narrows a publish gate, halts a save, drops a
 * stale renewal — each for a reason it knows exactly and, until now, kept. What
 * reaches a screen is the outcome; what is worth having while something is
 * being worked on is the reasoning that led there, in order, with what it was
 * looking at.
 *
 * ## Silent unless asked
 *
 * Hatua renders inside somebody else's product. A library that writes `info` to
 * a Host's console by default is one every integrator has to go and turn off,
 * and one whose noise buries their own logs — so nothing below `warn` is
 * written until a caller asks for it. `warn` and `error` are always through,
 * because a Host that has wired something wrongly should hear about it without
 * having to opt in.
 *
 * ## Categories are packages
 *
 * A category names where the line came from — `services.editing`,
 * `react.fields` — so a level can be turned up for the thing being chased
 * without turning it up for everything. Dotted, and matched by prefix:
 * `services` covers `services.editing`, and `*` covers everything.
 */

export type Level = 'error' | 'warn' | 'info' | 'debug' | 'trace'

/** Ordered, so a threshold is a comparison rather than a table. */
const RANK: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 }

/**
 * What a line is handed to.
 *
 * A seam rather than a hard-wired `console`, because a Host that already has
 * somewhere for diagnostics to go should not have Hatua's arriving somewhere
 * else — and because a test that asserts what was logged should not have to
 * read the terminal to do it.
 */
export type Sink = (line: Line) => void

export interface Line {
  level: Level
  /** Where it came from, dotted: `services.editing`. */
  category: string
  message: string
  /** Whatever the call site was looking at when it decided. */
  detail?: Record<string, unknown>
}

export interface LogConfig {
  /**
   * The level a category is written at, by prefix. The longest matching prefix
   * wins, so `{ '*': 'warn', 'services.editing': 'trace' }` says what it looks
   * like it says.
   */
  levels?: Record<string, Level>
  sink?: Sink
}

/**
 * The default: nothing below a warning, written to the console.
 *
 * `warn` rather than `off` entirely, because the things Hatua warns about are
 * misconfigurations — a port that answered with the wrong shape, a manifest it
 * could not read — and those reach an integrator who has not thought to switch
 * logging on precisely because they do not yet know anything is wrong.
 */
const DEFAULT_LEVELS: Record<string, Level> = { '*': 'warn' }

const consoleSink: Sink = ({ level, category, message, detail }) => {
  const say = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  const head = `[hatua:${category}] ${message}`
  if (detail === undefined) say(head)
  else say(head, detail)
}

let levels: Record<string, Level> = { ...DEFAULT_LEVELS }
let sink: Sink = consoleSink

/**
 * Turn categories up or down, or send lines somewhere else.
 *
 * Merged into what is already set rather than replacing it, so turning one
 * category up does not silently reset the rest.
 */
export function configureLogging(config: LogConfig): void {
  if (config.levels) levels = { ...levels, ...config.levels }
  if (config.sink) sink = config.sink
}

/** Back to silent-unless-asked, and back to the console. What a test resets to. */
export function resetLogging(): void {
  levels = { ...DEFAULT_LEVELS }
  sink = consoleSink
}

/**
 * The level a category is written at: the longest configured prefix that
 * matches it.
 *
 * Longest rather than first, so `services` and `services.editing` can both be
 * set and the more specific one wins whichever order they were written in.
 */
const levelFor = (category: string): Level => {
  let best = levels['*'] ?? 'warn'
  let longest = -1
  for (const [prefix, level] of Object.entries(levels)) {
    if (prefix === '*') continue
    if (category !== prefix && !category.startsWith(`${prefix}.`)) continue
    if (prefix.length > longest) {
      longest = prefix.length
      best = level
    }
  }
  return best
}

export interface Logger {
  error(message: string, detail?: Record<string, unknown>): void
  warn(message: string, detail?: Record<string, unknown>): void
  info(message: string, detail?: Record<string, unknown>): void
  debug(message: string, detail?: Record<string, unknown>): void
  trace(message: string, detail?: Record<string, unknown>): void
  /** Whether a line at this level would be written, for a caller with work to do to build one. */
  enabled(level: Level): boolean
}

/**
 * A logger for one category.
 *
 * Held at module scope by its caller — the category is a fact about the file,
 * not about the call — and it reads the configuration at write time, so turning
 * a category up affects loggers already made.
 */
export function logger(category: string): Logger {
  const write = (level: Level, message: string, detail?: Record<string, unknown>) => {
    if (RANK[level] > RANK[levelFor(category)]) return
    sink({ level, category, message, ...(detail === undefined ? {} : { detail }) })
  }

  return {
    error: (message, detail) => write('error', message, detail),
    warn: (message, detail) => write('warn', message, detail),
    info: (message, detail) => write('info', message, detail),
    debug: (message, detail) => write('debug', message, detail),
    trace: (message, detail) => write('trace', message, detail),
    enabled: (level) => RANK[level] <= RANK[levelFor(category)],
  }
}
