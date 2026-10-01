#!/usr/bin/env npx tsx

/**
 * Build the site (site/) into site/dist/, for GitHub Pages.
 *
 * The page runs the refund workflow in the visitor's browser and stops at its
 * gate. The workflow is compiled here by this checkout's built CLI, so run
 * `npm run build` first. Before the page is written, the compiled workflow is
 * run outside Flow Weaver the way the page runs it: started, paused at the
 * manager's approval, and resumed from the saved run, once approved and once
 * declined. If that no longer works, the build fails.
 */

import * as esbuild from 'esbuild';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = path.join(root, 'site');
const outDir = path.join(siteDir, 'dist');
const cli = path.join(root, 'dist/cli/flow-weaver.mjs');
const workflow = path.join(siteDir, 'refunds.ts');

/** What the compiled file exports, as the page uses it. */
interface Compiled {
  refundRequest(execute: boolean, params: { refund: unknown }, runtime: unknown): Promise<{ outcome: string; declined: string }>;
  createWorkflowRuntime(options: Record<string, unknown>): unknown;
  acceptContinuation(input: unknown, identity: Record<string, string>): { envelope: unknown };
  isDurableGateYield(error: unknown): error is { gate: { id: string; kind: string }; continuation: unknown };
}

async function check(compiled: Compiled) {
  const refund = { orderId: 'A-1042', amount: 240, reason: 'Arrived damaged' };
  const identity = { runId: 'site-check', workflowId: 'refundRequest' };
  let paused: { gateId: string; saved: string } | undefined;
  try {
    await compiled.refundRequest(true, { refund }, compiled.createWorkflowRuntime(identity));
  } catch (error) {
    if (!compiled.isDurableGateYield(error) || error.gate.kind !== 'approval') throw error;
    paused = { gateId: error.gate.id, saved: JSON.stringify(error.continuation) };
  }
  if (!paused) throw new Error('the refund workflow finished without stopping at its approval gate');
  const resume = (value: Record<string, unknown>) => {
    const accepted = compiled.acceptContinuation(JSON.parse(paused!.saved), { ...identity, gateId: paused!.gateId });
    const runtime = compiled.createWorkflowRuntime({ ...identity, continuation: accepted.envelope, resolution: { gateId: paused!.gateId, value } });
    return compiled.refundRequest(true, { refund }, runtime);
  };
  const approved = await resume({ onSuccess: true, onFailure: false, note: 'Approved' });
  if (!approved.outcome?.startsWith('Refunded')) throw new Error(`an approved run ended with ${JSON.stringify(approved)}`);
  const declined = await resume({ onSuccess: false, onFailure: true, note: 'Declined' });
  if (!declined.declined?.startsWith('Declined')) throw new Error(`a declined run ended with ${JSON.stringify(declined)}`);
  return paused.saved.length;
}

async function build() {
  if (!fs.existsSync(cli)) throw new Error(`no built CLI at ${path.relative(root, cli)}: run npm run build first`);

  // Compiling writes the workflow's body into the file, so compile a copy.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-site-'));
  try {
    const copy = path.join(work, 'refunds.ts');
    fs.copyFileSync(workflow, copy);
    execFileSync(process.execPath, [cli, 'compile', copy], { stdio: 'pipe' });
    const source = fs.readFileSync(copy, 'utf8');

    const module = path.join(work, 'refunds.mjs');
    fs.writeFileSync(module, (await esbuild.transform(source, { loader: 'ts', format: 'esm', target: 'es2020' })).code);
    const savedBytes = await check((await import(pathToFileURL(module).href)) as Compiled);

    // For the page: a plain script that leaves the exports on window.FW.
    const script = (await esbuild.transform(source, { loader: 'ts', format: 'iife', globalName: 'FW', target: 'es2020' })).code;
    const diagram = execFileSync(process.execPath, [cli, 'diagram', workflow, '--theme', 'dark'], { encoding: 'utf8' });
    const page = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8')
      .replace('<!--mark-->', () => fs.readFileSync(path.join(root, 'docs/brand/flow-weaver-cream.svg'), 'utf8').trim())
      .replace('<!--diagram-->', () => diagram.trim().replace(/<title[^>]*>.*?<\/title>/, ''))
      .replace('<!--source-->', () => fs.readFileSync(workflow, 'utf8').replaceAll('&', '&amp;').replaceAll('<', '&lt;'))
      .replace('/*compiled-size*/', () => JSON.stringify(`${Math.round(script.length / 1024)} KB`))
      .replace('/*workflow*/', () => script.replace(/<\/script/gi, '<\\/script'));

    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), page);
    fs.copyFileSync(path.join(root, 'console-ui/assets/flow-weaver.svg'), path.join(outDir, 'favicon.svg'));
    fs.copyFileSync(path.join(root, 'docs/brand/social-preview.png'), path.join(outDir, 'social-preview.png'));
    console.log(`✓ Built site: ${path.relative(root, outDir)} (the workflow ${Math.round(script.length / 1024)} KB, a paused run ${(savedBytes / 1024).toFixed(1)} KB)`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

build().catch((err) => {
  console.error('Site build failed:', err);
  process.exit(1);
});
