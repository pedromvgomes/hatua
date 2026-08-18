#!/usr/bin/env node
/**
 * The grammar lint.
 *
 * One grammar feeds two generators whose dialects overlap but do not coincide.
 * Nothing in either tool stops the file drifting into the part of the overlap
 * only one of them accepts — a convenient Go-ism in an action body, a `$` text
 * capture, a `<-` — and the failure would surface as one language's `make
 * build` breaking long after the change that caused it.
 *
 * So the shared subset is checked here, on `expression.peg` alone. The
 * preamble and epilogue are deliberately not linted: they are where the
 * per-language spellings are allowed to live.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const GRAMMAR = path.join(HERE, '..', 'expression.peg')

/** `return helper(...)` and nothing else. */
const ACTION_BODY = /^return\s+[A-Za-z_][A-Za-z0-9_]*\(.*\)$/s

/**
 * Split the grammar into actions and everything else, skipping comments,
 * strings and character classes so a `{` inside `"{{"` is not read as the start
 * of an action.
 */
function scan(source) {
  const actions = []
  let i = 0
  while (i < source.length) {
    const two = source.slice(i, i + 2)
    if (two === '//') {
      i = source.indexOf('\n', i)
      if (i === -1) break
      continue
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    const ch = source[i]
    if (ch === '"' || ch === "'") {
      i = skipDelimited(source, i, ch)
      continue
    }
    if (ch === '[') {
      i = skipDelimited(source, i, ']')
      continue
    }
    if (ch === '{') {
      const end = skipAction(source, i)
      actions.push({ offset: i, body: source.slice(i + 1, end - 1).trim() })
      i = end
      continue
    }
    i += 1
  }
  return actions
}

/** Past a string or character class, honouring backslash escapes. */
function skipDelimited(source, start, closer) {
  let i = start + 1
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2
      continue
    }
    if (source[i] === closer) return i + 1
    i += 1
  }
  return source.length
}

/** Past a `{ … }` action, skipping strings inside it. */
function skipAction(source, start) {
  let depth = 0
  let i = start
  while (i < source.length) {
    const ch = source[i]
    if (ch === '"' || ch === "'") {
      i = skipDelimited(source, i, ch)
      continue
    }
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return i + 1
    }
    i += 1
  }
  return source.length
}

const lineOf = (source, offset) => source.slice(0, offset).split('\n').length

export function lintGrammar(source, file = 'expression.peg') {
  const problems = []
  const at = (offset, message) => problems.push(`${file}:${lineOf(source, offset)}  ${message}`)

  // 1. Peggy has no `<-`; pigeon accepts `=`, so `=` is the shared spelling.
  for (const match of source.matchAll(/^[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]*<-/gm)) {
    at(match.index, 'rules must assign with `=`; Peggy has no `<-`')
  }

  // 2. `$` text capture is Peggy-only. `str(...)` flattens instead.
  for (const match of source.matchAll(/\$\s*\(/g)) {
    at(match.index, 'no `$` text capture; pigeon has none — use the `str(...)` helper')
  }

  // 3. pigeon names the action receiver `c`, so a label called `c` shadows it
  //    and the generated Go does not compile.
  for (const match of source.matchAll(/(^|[^A-Za-z0-9_])c:/g)) {
    at(match.index, 'no label named `c`; it collides with pigeon\u2019s action receiver')
  }

  // 4. The action subset. This is what keeps the body simultaneously valid Go
  //    and valid JavaScript, and it is the constraint that erodes first.
  for (const action of scan(source)) {
    if (!ACTION_BODY.test(action.body)) {
      at(action.offset, `action must be exactly \`return helper(...)\`, got: ${action.body}`)
    }
  }

  return problems
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const source = fs.readFileSync(GRAMMAR, 'utf8')
  const problems = lintGrammar(source, path.relative(process.cwd(), GRAMMAR))
  if (problems.length > 0) {
    console.error(`\nhatua \u00b7 grammar lint: ${problems.length} problem(s)\n`)
    for (const problem of problems) console.error(`  \u2717 ${problem}`)
    console.error('')
    process.exit(1)
  }
  console.log('\nhatua \u00b7 grammar lint: the shared subset holds\n')
}
