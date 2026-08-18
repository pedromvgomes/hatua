#!/usr/bin/env node
/**
 * generate -> verify -> promote.
 *
 * Deliberately one task rather than two. Generating into the destination and
 * testing afterwards has two failure modes: the harness cannot run until the
 * files are already in place, and a failed run leaves the committed, working
 * parser replaced by an untested one. So the destination is only ever written
 * by output that has already passed.
 *
 *   node src/build.js                       both languages
 *   node src/build.js --lang go             one
 *   node src/build.js --lang ts --out DIR   somewhere else
 *   node src/build.js --check-drift         generate, verify, diff, never promote
 *
 * `--check-drift` is this same pipeline stopping before the promote and
 * diffing instead, so CI verifies the committed artefacts are both current
 * *and* passing.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  diagnosticsToGo,
  diagnosticsToTs,
  functionsToGo,
  functionsToTs,
  readDiagnostics,
  readFunctions,
} from './emit.js'
import { GRAMMAR, lintGrammar } from './lint-grammar.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOOL = path.join(HERE, '..')
const SOURCE = path.resolve(TOOL, '../..')
const SCHEMAS = path.join(SOURCE, 'schemas')
const TOOLS = JSON.parse(fs.readFileSync(path.join(TOOL, 'tools.json'), 'utf8'))

const TARGETS = {
  go: {
    out: path.join(SOURCE, 'sdk/go/expressions'),
    // Anywhere will do: `go test -overlay` maps staged content onto the
    // destination path, so package resolution follows the destination.
    staging: path.join(TOOL, '.staging/go'),
    grammar: 'grammar.peg',
    files: ['parser.gen.go', 'builtins.gen.go', 'diagnostics.gen.go'],
  },
  ts: {
    out: path.join(SOURCE, 'packages/expressions/src/generated'),
    // Must sit beside the destination: the generated parser imports
    // `../nodes.js`, and JavaScript resolution is path-based with no overlay.
    staging: path.join(SOURCE, 'packages/expressions/src/generated.staged'),
    grammar: 'grammar.peggy',
    files: ['parser.js', 'parser.d.ts', 'builtins.ts', 'diagnostics.ts'],
  },
}

// ---- the pipeline ----------------------------------------------------------

function generate(lang, target) {
  fs.rmSync(target.staging, { recursive: true, force: true })
  fs.mkdirSync(target.staging, { recursive: true })

  const grammar = [
    fs.readFileSync(path.join(TOOL, `preamble/${lang}.txt`), 'utf8'),
    fs.readFileSync(GRAMMAR, 'utf8'),
    fs.readFileSync(path.join(TOOL, `epilogue/${lang}.txt`), 'utf8'),
  ].join('\n')
  const grammarPath = path.join(target.staging, target.grammar)
  fs.writeFileSync(grammarPath, grammar, 'utf8')

  const functions = readFunctions(SCHEMAS)
  const diagnostics = readDiagnostics(SCHEMAS)

  if (lang === 'go') {
    run('go', [
      'run',
      TOOLS.pigeon,
      // Only the corpus and tooling parse a bare Expression; a field value is
      // always a whole Template.
      '-alternate-entrypoints',
      'Expr',
      '-o',
      path.join(target.staging, 'parser.gen.go'),
      grammarPath,
    ])
    write(target, 'builtins.gen.go', functionsToGo(functions))
    write(target, 'diagnostics.gen.go', diagnosticsToGo(diagnostics))
    run('gofmt', ['-w', ...target.files.map((f) => path.join(target.staging, f))])
  } else {
    run(path.join(TOOL, 'node_modules/.bin/peggy'), [
      '--format',
      'es',
      '--dts',
      '--allowed-start-rules',
      'Template,Expr',
      '-o',
      path.join(target.staging, 'parser.js'),
      grammarPath,
    ])
    write(target, 'builtins.ts', functionsToTs(functions))
    write(target, 'diagnostics.ts', diagnosticsToTs(diagnostics))
    // Generated code still gets read and reviewed, and leaving it unformatted
    // would make `biome ci` fail on files nobody is allowed to edit by hand.
    // It also makes generation idempotent, which the drift check depends on.
    run(
      'pnpm',
      [
        'biome',
        'check',
        '--write',
        '--files-ignore-unknown=true',
        // The staging directory is gitignored, and biome honours the ignore
        // file, so it would refuse to look at the very files being staged.
        '--vcs-enabled=false',
        target.staging,
      ],
      { cwd: SOURCE },
    )
  }

  // The grammar is an input, not an artefact: it is the preamble and epilogue
  // glued to the file that is already committed.
  fs.rmSync(grammarPath)
}

function verify(lang, target) {
  if (lang === 'go') {
    // `Replace` accepts destinations that do not exist yet, which is what lets
    // the very first build be verified before anything is committed.
    const overlay = {
      Replace: Object.fromEntries(
        target.files.map((f) => [path.join(target.out, f), path.join(target.staging, f)]),
      ),
    }
    const overlayPath = path.join(target.staging, 'overlay.json')
    fs.writeFileSync(overlayPath, JSON.stringify(overlay), 'utf8')
    run('go', ['test', `-overlay=${overlayPath}`, './expressions/...'], {
      cwd: path.join(SOURCE, 'sdk/go'),
    })
    fs.rmSync(overlayPath)
  } else {
    run('pnpm', ['exec', 'vitest', 'run'], {
      cwd: path.join(SOURCE, 'packages/expressions'),
      env: { ...process.env, HATUA_EXPR_GENERATED: target.staging },
    })
  }
}

/**
 * Write the staged output over the committed output — and touch nothing else.
 *
 * The Go destination is a package directory shared with hand-written source:
 * the generated parser has to sit in `package expressions` because pigeon's
 * actions call the helpers unqualified. So promotion copies its own files and
 * removes nothing. A tidy-up pass that deleted "files it did not generate"
 * would delete the runtime.
 */
function promote(target) {
  fs.mkdirSync(target.out, { recursive: true })
  for (const file of target.files) {
    fs.copyFileSync(path.join(target.staging, file), path.join(target.out, file))
  }
}

function drift(target) {
  const stale = []
  for (const file of target.files) {
    const committed = path.join(target.out, file)
    if (!fs.existsSync(committed)) {
      stale.push(`${file} is missing`)
      continue
    }
    const before = fs.readFileSync(committed, 'utf8')
    const after = fs.readFileSync(path.join(target.staging, file), 'utf8')
    if (before !== after) stale.push(`${file} differs from a fresh generation`)
  }
  return stale
}

// ---- plumbing --------------------------------------------------------------

function write(target, file, contents) {
  fs.writeFileSync(path.join(target.staging, file), contents, 'utf8')
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

function parseArgs(argv) {
  const options = { langs: Object.keys(TARGETS), out: null, checkDrift: false }
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    i += 1
    if (arg === '--check-drift') {
      options.checkDrift = true
    } else if (arg === '--lang') {
      options.langs = [argv[i]]
      i += 1
    } else if (arg === '--out') {
      options.out = path.resolve(argv[i])
      i += 1
    } else {
      throw new Error(`unknown argument ${arg}`)
    }
  }
  for (const lang of options.langs) {
    if (!TARGETS[lang]) throw new Error(`unknown language ${lang}; expected go or ts`)
  }
  if (options.out && options.langs.length !== 1) {
    throw new Error('--out needs --lang: two languages cannot share one destination')
  }
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))

  const problems = lintGrammar(fs.readFileSync(GRAMMAR, 'utf8'), 'expression.peg')
  if (problems.length > 0) {
    console.error('\nhatua · grammar lint\n')
    for (const problem of problems) console.error(`  ✗ ${problem}`)
    console.error('')
    process.exit(1)
  }

  const stale = []
  for (const lang of options.langs) {
    const target = { ...TARGETS[lang], out: options.out ?? TARGETS[lang].out }
    console.log(`\nhatua · expression ${lang}\n`)

    try {
      generate(lang, target)
      console.log(`  ✓ generated  ${target.files.join(', ')}`)
      verify(lang, target)
      console.log('  ✓ verified   scenarios pass against the staged output')

      if (options.checkDrift) {
        const problems = drift(target).map((problem) => `${lang}: ${problem}`)
        stale.push(...problems)
        console.log(problems.length === 0 ? '  ✓ current    no drift' : '  ✗ stale')
      } else {
        promote(target)
        console.log(`  ✓ promoted   ${path.relative(SOURCE, target.out)}`)
      }
    } finally {
      fs.rmSync(target.staging, { recursive: true, force: true })
    }
  }

  if (stale.length > 0) {
    console.error('\n  Generated output is stale. Run `make build` and commit.\n')
    for (const problem of stale) console.error(`  ✗ ${problem}`)
    console.error('')
    process.exit(1)
  }
  console.log('')
}

main()
