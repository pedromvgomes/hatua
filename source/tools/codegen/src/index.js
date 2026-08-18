#!/usr/bin/env node
/**
 * schemas/*.schema.yaml -> packages/schema/src/generated/*.ts
 *
 * Go generation is scaffolded but not wired: sdk/go currently hand-writes its
 * structs against the same schemas and is kept honest by conformance/. The
 * generator lands when the Go SDK grows past its scaffold.
 */
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
]

fs.mkdirSync(OUT, { recursive: true })

console.log('\nhatua · schemas -> zod\n')
for (const { file, out } of FILES) {
  const schema = parse(fs.readFileSync(path.join(SCHEMAS, file), 'utf8'))
  const code = generateModule(schema, { sourceFile: file })
  fs.writeFileSync(path.join(OUT, out), code, 'utf8')
  console.log(`  ✓ ${out}  (${code.split('\n').length} lines)`)
}

const index = [
  '// GENERATED — do not edit.',
  '// Regenerate: pnpm --filter @hatua/codegen build',
  ...FILES.map(({ out }) => `export * from './${out.replace(/\.ts$/, '')}'`),
  '',
].join('\n')
fs.writeFileSync(path.join(OUT, 'index.ts'), index, 'utf8')
console.log('  ✓ index.ts')
console.log(`\nDone. ${FILES.length + 1} files written to packages/schema/src/generated/\n`)
