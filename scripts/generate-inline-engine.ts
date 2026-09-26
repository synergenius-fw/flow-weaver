#!/usr/bin/env tsx
/**
 * Generates src/api/inline-engine.generated.ts: the durable engine's source
 * and the execution context's source, each as one string, ready to be copied
 * into every compiled workflow file.
 *
 * The engine (`src/runtime/continuation-core.ts` and
 * `src/runtime/durable-execution.ts`) and the execution context
 * (`src/runtime/ExecutionContext.ts`) are the package's own implementations;
 * the same text runs inside compiled files, so there is one copy of each and
 * it cannot drift. This script strips the module syntax (imports, `export`)
 * and leaves the declarations. `generateInlineRuntime` prepends what the
 * imports provided (the version, the host types, `CancellationError`),
 * resolves the execution context's development-only regions for a
 * production build, and appends the exports a compiled file offers.
 *
 * Run as a prebuild step, like generate-version. The output is gitignored.
 *
 *   tsx scripts/generate-inline-engine.ts
 *   tsx scripts/generate-inline-engine.ts --check
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { inlineEngineSource, renderModule } from './inline-engine-text.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCES = ['src/runtime/continuation-core.ts', 'src/runtime/durable-execution.ts'];
const CONTEXT_SOURCES = ['src/runtime/ExecutionContext.ts'];
const OUTPUT = path.join(ROOT, 'src', 'api', 'inline-engine.generated.ts');

// Always a script, never imported (like generate-version.ts), so no
// "am I main" check: comparing argv[1] with import.meta.url is a drive-letter
// case away from being wrong on Windows, and a silent no-op there would
// fail the build with a missing module.
const read = (file: string) => ({ name: file, text: fs.readFileSync(path.join(ROOT, file), 'utf8') });
const rendered = renderModule(inlineEngineSource(SOURCES.map(read)), inlineEngineSource(CONTEXT_SOURCES.map(read)));
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';
  if (current !== rendered) {
    console.error('src/api/inline-engine.generated.ts is stale. Run: npx tsx scripts/generate-inline-engine.ts');
    process.exit(1);
  }
  console.log('inline engine is up to date');
} else {
  fs.writeFileSync(OUTPUT, rendered, 'utf8');
  console.log(`Generated src/api/inline-engine.generated.ts (${rendered.length} bytes from ${SOURCES.length + CONTEXT_SOURCES.length} files)`);
}
