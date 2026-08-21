#!/usr/bin/env node
/** biome-ignore-all lint/correctness/noNodejsModules: Node-side tooling, never bundled for a browser — the built-ins are the point. */
/**
 * schemas/*.schema.yaml -> packages/schema/src/generated/*.ts
 *
 * Go generation is scaffolded but not wired: sdk/go currently hand-writes its
 * structs against the same schemas and is kept honest by conformance/. The
 * generator lands when the Go SDK grows past its scaffold.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { generateModule } from './json-schema-to-zod.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '../../..')
const SCHEMAS = path.join(ROOT, 'schemas')
const OUT = path.join(ROOT, 'packages/schema/src/generated')

const FILES = [
  { file: 'workflow-definition.schema.yaml', out: 'definition.ts' },
  { file: 'workflow-execution.schema.yaml', out: 'execution.ts' },
  { file: 'component-manifest.schema.yaml', out: 'component.ts' },
  { file: 'function-manifest.schema.yaml', out: 'function.ts' },
  { file: 'context-manifest.schema.yaml', out: 'context.ts' },
]

fs.mkdirSync(OUT, { recursive: true })

console.log('\nhatua · schemas -> zod\n')
for (const { file, out } of FILES) {
  const schema = parse(fs.readFileSync(path.join(SCHEMAS, file), 'utf8'))
  const code = generateModule(schema, { sourceFile: file })
  fs.writeFileSync(path.join(OUT, out), code, 'utf8')
  console.log(`  ✓ ${out}  (${code.split('\n').length} lines)`)
}

// Two schemas naming the same `$def` collide in the barrel below, and the
// resulting error names the barrel rather than either schema. Catching it here
// says which two files disagree and about what.
const exported = new Map()
for (const { file, out } of FILES) {
  const source = fs.readFileSync(path.join(OUT, out), 'utf8')
  for (const [, name] of source.matchAll(/^export const (\w+)/gm)) {
    const owner = exported.get(name)
    if (owner) throw new Error(`${file} and ${owner} both export "${name}" — rename one $def`)
    exported.set(name, file)
  }
}

const index = [
  '// GENERATED — do not edit.',
  '// Regenerate: pnpm codegen',
  ...FILES.map(({ out }) => `export * from './${out.replace(/\.ts$/, '')}'`),
  '',
].join('\n')
fs.writeFileSync(path.join(OUT, 'index.ts'), index, 'utf8')
console.log('  ✓ index.ts')

// Format the output. Generated code still gets read and reviewed, and leaving
// it unformatted would make `biome ci` fail on files nobody is allowed to edit
// by hand. Doing it here also makes generation idempotent: regenerating twice
// produces identical bytes, which is what the CI drift check depends on.
execFileSync('pnpm', ['biome', 'check', '--write', '--files-ignore-unknown=true', OUT], {
  cwd: ROOT,
  stdio: 'pipe',
})
console.log('  ✓ formatted\n')
