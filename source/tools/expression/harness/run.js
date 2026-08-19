#!/usr/bin/env node
/**
 * The cross-language harness.
 *
 * Both suites load the *same* scenario files, so the interesting failure is not
 * "one of them is red" — that shows up anyway — but "one of them never ran a
 * scenario the other did". A glob that matches nothing, a file whose top-level
 * key is misspelled, a scenario kind one loader does not know about: each makes
 * a suite pass by doing less, and each is invisible from inside that suite.
 *
 * So both write their tally, and the tallies must agree.
 *
 *   node harness/run.js              both languages
 *   node harness/run.js --lang go    one, with no comparison to make
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = path.resolve(HERE, '../../..')

const RUNNERS = {
  go: (countFile) =>
    run('go', ['test', '-count=1', './expressions/...'], path.join(SOURCE, 'sdk/go'), countFile),
  ts: (countFile) =>
    run('pnpm', ['exec', 'vitest', 'run'], path.join(SOURCE, 'packages/expressions'), countFile),
}

function run(command, args, cwd, countFile) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, HATUA_SCENARIO_COUNT_FILE: countFile },
  })
  if (!fs.existsSync(countFile)) {
    throw new Error(`${command} finished without reporting a scenario tally`)
  }
  return JSON.parse(fs.readFileSync(countFile, 'utf8'))
}

function main() {
  const argv = process.argv.slice(2)
  const langIndex = argv.indexOf('--lang')
  const langs = langIndex === -1 ? Object.keys(RUNNERS) : [argv[langIndex + 1]]

  const tallies = []
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hatua-expression-'))
  try {
    for (const lang of langs) {
      if (!RUNNERS[lang]) throw new Error(`unknown language ${lang}; expected go or ts`)
      console.log(`\nhatua · expression scenarios · ${lang}\n`)
      tallies.push(RUNNERS[lang](path.join(scratch, `${lang}.json`)))
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }

  const counts = new Set(tallies.map((tally) => tally.scenarios))
  const summary = tallies.map((t) => `${t.language} ${t.scenarios}`).join(' · ')

  if (counts.size > 1) {
    console.error(`\n  ✗ the two harnesses ran different scenarios: ${summary}`)
    console.error('    One of them is skipping a file the other loads.\n')
    process.exit(1)
  }
  if (counts.has(0)) {
    console.error('\n  ✗ no scenarios ran at all\n')
    process.exit(1)
  }

  console.log(`\n  ✓ ${summary} — the same scenarios, in both languages\n`)
}

main()
