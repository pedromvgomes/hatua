#!/usr/bin/env node
/**
 * build-png.js
 *
 * Rasterize the Hatua brand SVGs to PNG.
 *
 * The SVGs are the source of truth. PNGs are generated on demand and are not
 * committed — anything under dist/ is git-ignored.
 *
 * Two modes:
 *
 *   Manifest — render every output declared in tools/png-manifest.json:
 *     node tools/build-png.js --all
 *     node tools/build-png.js --all --manifest path/to/other.json
 *
 *   One-off — render a single SVG at an arbitrary width:
 *     node tools/build-png.js <input.svg> <width> [output.png]
 *
 *     node tools/build-png.js assets/hatua-avatar-512.svg 1024
 *     node tools/build-png.js assets/hatua-lockup.svg 800 /tmp/logo-800.png
 *
 *   With no output path the PNG lands next to the SVG with a "-<width>" suffix,
 *   e.g. assets/hatua-mark-2048.png.
 *
 * Note on the *-mono.svg files: they paint with `currentColor`, which has no
 * meaning outside a document that supplies a text color. They rasterize to
 * black. They are for inline embedding, not for export — hence their absence
 * from the manifest.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let Resvg;
try {
  ({ Resvg } = await import('@resvg/resvg-js'));
} catch {
  console.error('\n  Missing dep — run: pnpm install\n');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');

const USAGE = `
  Usage:
    node tools/build-png.js --all [--manifest <file.json>]
    node tools/build-png.js <input.svg> <width> [output.png]
`;

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/** Render one SVG to one PNG. Returns the rendered dimensions. */
function render(inputPath, width, outputPath) {
  if (!fs.existsSync(inputPath)) throw new Error(`File not found: ${inputPath}`);

  const resvg = new Resvg(fs.readFileSync(inputPath), {
    fitTo: { mode: 'width', value: width },
  });
  const rendered = resvg.render();

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rendered.asPng());

  return rendered;
}

function report(outputPath, rendered) {
  const rel = path.relative(process.cwd(), outputPath);
  console.log(`  ✓ ${rel}  (${rendered.width}×${rendered.height})`);
}

// ---------------------------------------------------------------------------
// Manifest mode
// ---------------------------------------------------------------------------

function runManifest(manifestArg) {
  const manifestPath = manifestArg
    ? path.resolve(process.cwd(), manifestArg)
    : path.join(__dirname, 'png-manifest.json');

  if (!fs.existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestPath}`);

  const { outputs } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new Error(`Manifest has no "outputs" array: ${manifestPath}`);
  }

  console.log('\nHatua · rasterizing brand SVGs\n');

  // Manifest paths are relative to the package root, so the output is identical
  // no matter which directory the script is invoked from.
  for (const [i, entry] of outputs.entries()) {
    const { src, width, out } = entry;
    if (!src || !width || !out) {
      throw new Error(`Manifest entry ${i} needs "src", "width" and "out": ${JSON.stringify(entry)}`);
    }
    report(
      path.resolve(PKG_ROOT, out),
      render(path.resolve(PKG_ROOT, src), width, path.resolve(PKG_ROOT, out)),
    );
  }

  console.log(`\nDone. ${outputs.length} file(s) written.\n`);
}

// ---------------------------------------------------------------------------
// One-off mode
// ---------------------------------------------------------------------------

function runSingle(inputArg, widthArg, outputArg) {
  const width = Number.parseInt(widthArg, 10);
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`Invalid width: "${widthArg}" — must be a positive integer`);
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  const stem = path.basename(inputPath, '.svg');
  const outputPath = outputArg
    ? path.resolve(process.cwd(), outputArg)
    : path.join(path.dirname(inputPath), `${stem}-${width}.png`);

  report(outputPath, render(inputPath, width, outputPath));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

try {
  if (args.includes('--all')) {
    const i = args.indexOf('--manifest');
    runManifest(i === -1 ? undefined : args[i + 1]);
  } else if (args.length >= 2) {
    runSingle(args[0], args[1], args[2]);
  } else {
    console.error(USAGE);
    process.exit(1);
  }
} catch (e) {
  console.error(`\n  ERROR: ${e?.message || e}\n`);
  process.exit(1);
}
