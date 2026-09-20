/**
 * The brief: a workflow as a page for people who will not open the code.
 * The graph comes first and every step in it can be asked what it does.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { parseWorkflow } from '../../../src/api/parse';
import { renderBrief, fitGraph } from '../../../src/artifacts/brief';
import type { TWorkflowAST } from '../../../src/ast/types';

const useCases = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'use-cases');
const figma = path.join(useCases, 'figma-to-page', 'figma-to-page.ts');
const hello = path.join(useCases, 'hello-world.ts');

let figmaAst: TWorkflowAST;
let helloAst: TWorkflowAST;
beforeAll(async () => {
  figmaAst = (await parseWorkflow(figma, { workflowName: 'figmaToPage', projectDir: path.dirname(figma) })).ast;
  helloAst = (await parseWorkflow(hello, { workflowName: 'helloWorld', projectDir: path.dirname(hello) })).ast;
}, 60000);

describe('renderBrief (the page)', () => {
  it('is one self-contained page: the graph, the contract, every step, the gates', () => {
    const html = renderBrief(figmaAst, { subtitle: 'use-cases' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(html).toContain('<h1>figmaToPage</h1>');
    expect(html).toContain('use-cases · ');
    // The graph is the spine, in both themes so the toggle needs no reload.
    expect(html).toContain('<svg class="light"');
    expect(html).toContain('<svg class="dark"');
    expect(html).toContain('<code>request</code>');
    expect(html).toContain('<code>status</code>');
    expect(html).toContain('Ask For Link');
    expect(html).toContain('approval gate');
    expect(html).toContain('Where a person or an agent is needed');
    expect(html).toContain('A person decides whether to go on');
  });

  it('carries what the panel says about each step, and the hooks that select one', () => {
    const html = renderBrief(figmaAst);
    // The embedded model: one entry per step, with what it reads and hands on.
    const m = /const M = (\{.*?\});\n/s.exec(html);
    expect(m).not.toBeNull();
    const model = JSON.parse(m![1]) as { steps: Array<{ id: string; reads: unknown[]; produces: unknown[]; failureTo: string[]; gate: string | null }>; labels: Record<string, string> };
    expect(model.steps).toHaveLength(figmaAst.instances.length);
    expect(model.steps.find((s) => s.id === 'approve')?.gate).toBe('approval');
    expect(model.steps.find((s) => s.id === 'parse')?.failureTo).toEqual(['finish']);
    expect(model.labels.ask).toBe('Ask For Link');
    // Rows in the SVG and rows in the table both name the step they select.
    expect(html).toMatch(/<g class="row" data-id="approve">/);
    expect(html).toMatch(/<tr class="steprow" data-id="approve">/);
    expect(html).toMatch(/class="edge fail" data-from="parse" data-to="finish"/);
    // The page's own controls.
    expect(html).toContain('id="theme"');
    expect(html).toContain('window.print()');
  });

  it('escapes what it prints, in the page and in the model', () => {
    const ast = { ...helloAst, description: 'Greets <everyone> & "friends"' };
    const html = renderBrief(ast);
    expect(html).toContain('Greets &lt;everyone&gt; &amp; &quot;friends&quot;');
    expect(html).not.toContain('<everyone>');
    const withScript = { ...helloAst, instances: helloAst.instances.map((i) => ({ ...i, config: { ...i.config, label: '</script><b>x' } })) };
    expect(renderBrief(withScript)).not.toContain('</script><b>');
  });

  it('says which scope a body step runs inside, in the panel model and in the step table', async () => {
    const file = path.join(useCases, 'batch-invoices', 'batch-invoices.ts');
    const ast = (await parseWorkflow(file, { workflowName: 'rateInvoiceBatch', projectDir: path.dirname(file) })).ast;
    const html = renderBrief(ast);
    const m = /const M = (\{.*?\});\n/s.exec(html);
    const model = JSON.parse(m![1]) as { steps: Array<{ id: string; owner: string | null; scope: string | null }> };
    expect(model.steps.find((s) => s.id === 'rate')?.owner).toBe('loop');
    expect(model.steps.find((s) => s.id === 'loop')?.owner).toBeNull();
    expect(html).toContain("runs once per ' + esc(o.scope ?? 'item') + ', inside '");
    expect(html).toContain('once per line, inside For Each Invoice');
    expect(html).toContain('<g class="scope" data-owner="loop">');
    expect(renderBrief(ast, { mode: 'print' })).toContain('once per line, inside For Each Invoice');
  }, 60000);

  it('says so when there are no gates and no inputs to speak of', () => {
    const html = renderBrief({ ...helloAst, startPorts: {}, exitPorts: {} });
    expect(html).toContain('takes no parameters');
    expect(html).toContain('returns only whether it succeeded');
    expect(html).not.toContain('Where a person or an agent is needed');
  });

  it('opens in the theme asked for', () => {
    expect(renderBrief(helloAst, { theme: 'dark' })).toContain('<html lang="en" data-theme="dark">');
    expect(renderBrief(helloAst)).toContain('<html lang="en" data-theme="light">');
  });
});

describe('renderBrief (for paper)', () => {
  it('is a one-page overview -- graph beside the contract, pauses and arms -- then the detail, without a script', () => {
    const html = renderBrief(figmaAst, { mode: 'print', subtitle: 'use-cases' });
    expect(html).not.toMatch(/<script/);
    expect(html).toContain('<h1>figmaToPage</h1>');
    expect(html).toContain('@page');
    expect((html.match(/<svg /g) ?? []).length).toBe(1);
    // Twelve steps fit the first page at the size the console draws them.
    const [, w, h] = /<svg [^>]*width="(\d+)" height="(\d+)"/.exec(html)!;
    expect(html).toContain(`.graph svg { display: block; width: ${w}px; height: ${h}px;`);
    expect(html).toContain('<div class="one">');
    expect(html).toContain('.one { break-after: page; }');
    expect(html).toContain('When a step fails');
    expect(html).toMatch(/<b>Parse Figma Link<\/b> <span class="t">→ Report<\/span>/);
    expect(html).toContain('<h2>How it runs</h2>');
    expect(html).toContain('Where a person or an agent is needed');
    expect(html).not.toContain('class="steprow"');
    // The footer names the file, not the machine's path to it.
    expect(html).toContain('from <span class="mono">figma-to-page.ts</span> in use-cases.');
    expect(html).not.toContain(figmaAst.sourceFile);
  });

  it('scales a tall graph to the page, and gives a very tall one a page of its own', () => {
    expect(fitGraph(420, 600, 180)).toEqual({ scale: 1, ownPage: false });
    const tall = fitGraph(420, 1100, 180);
    expect(tall.ownPage).toBe(false);
    expect(tall.scale).toBeGreaterThan(0.62); expect(tall.scale).toBeLessThan(1);
    const huge = fitGraph(420, 2400, 180);
    expect(huge.ownPage).toBe(true);
    expect(huge.scale).toBe(0.62);
    // Wide graphs are limited by the column beside them, too.
    expect(fitGraph(900, 400, 180).ownPage).toBe(true);
  });

  it('can be dark', () => {
    const html = renderBrief(helloAst, { mode: 'print', theme: 'dark' });
    expect(html).toContain('--bg:#0e1014');
    expect(html).toContain('data-theme="dark"');
  });
});
