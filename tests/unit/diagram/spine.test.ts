/**
 * The SVG is the console's spine made still: the same lane layout, the same
 * tiles, self-contained. What a stakeholder gets on a slide must be what the
 * operator sees on screen.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { parser } from '../../../src/parser';
import { parseWorkflow } from '../../../src/api/parse';
import { renderSpineSVG, mix } from '../../../src/diagram/spine';
import { workflowToSVG } from '../../../src/diagram/index';
import type { TWorkflowAST } from '../../../src/ast/types';

const useCases = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'use-cases');
const figma = path.join(useCases, 'figma-to-page', 'figma-to-page.ts');

const GATED = `
/** @flowWeaver nodeType @expression */
function prepare(value: number): { value: number } { return { value: value * 2 }; }
/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @input value - Value
 * @output value - Approved value
 */
async function approve(execute: boolean, value: number): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> { throw new Error('gate'); }
/**
 * @flowWeaver nodeType
 * @durablePure
 * @icon science
 * @color purple
 * @input value - Value
 * @output result - Result
 * @output reason - Why it was refused
 */
function check(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number; reason: string } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0, reason: '' };
  return value > 0 ? { onSuccess: true, onFailure: false, result: value, reason: '' } : { onSuccess: false, onFailure: true, result: 0, reason: 'neg' };
}
/**
 * @flowWeaver nodeType @expression @durablePure
 * @input result - Result
 * @input reason - Reason
 * @output outcome - Outcome
 */
function report(result: number, reason: string): { outcome: string } { return { outcome: reason || String(result) }; }
/**
 * @flowWeaver workflow
 * @param value - Input
 * @returns outcome - Outcome
 * @node prep prepare
 * @node check check
 * @node approve approve
 * @node report report
 * @path Start -> prep -> check -> approve -> report -> Exit
 * @path check:fail -> report
 * @connect check.result -> report.result
 * @connect check.reason -> report.reason
 */
export async function gated(execute: boolean, params: { value: number }): Promise<{ onSuccess: boolean; onFailure: boolean; outcome: string }> {
  throw new Error('not compiled');
}
`;

let gated: TWorkflowAST;
let figmaAst: TWorkflowAST;
beforeAll(async () => {
  const parsed = parser.parseFromString(GATED);
  expect(parsed.errors).toEqual([]);
  gated = parsed.workflows[0];
  figmaAst = (await parseWorkflow(figma, { workflowName: 'figmaToPage', projectDir: path.dirname(figma) })).ast;
}, 60000);

const paths = (svg: string) => [...svg.matchAll(/<path d="M [^"]*" stroke="([^"]+)"([^/]*)\/>/g)];

describe('renderSpineSVG', () => {
  it('is one self-contained SVG with a row per step and the ends', () => {
    const svg = renderSpineSVG(gated);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(svg).not.toMatch(/<script|<style|@import|url\(/);
    for (const label of ['Start', 'Prepare', 'Check', 'Approve', 'Report', 'Exit']) expect(svg).toContain(`>${label}</text>`);
    // What goes in and what comes out, beside the ends.
    expect(svg).toContain('>value</text>');
    expect(svg).toContain('>outcome</text>');
  });

  it('draws the failure arm as its own lane in the failure colour, and says so in the legend', () => {
    const svg = renderSpineSVG(gated, { theme: 'dark' });
    const fail = mix('#f0636a', '#313847', 0.45);
    const arms = paths(svg).filter((m) => m[1] === fail);
    expect(arms).toHaveLength(1);
    // A branch leaves the trunk and comes back: two curves in the path.
    expect((arms[0][0].match(/ C /g) ?? []).length).toBe(2);
    expect(svg).toContain('>on failure</text>');
  });

  it('draws a band behind a scope body, named after its owner and scope, under everything else', async () => {
    const file = path.join(useCases, 'batch-invoices', 'batch-invoices.ts');
    const ast = (await parseWorkflow(file, { workflowName: 'rateInvoiceBatch', projectDir: path.dirname(file) })).ast;
    const svg = renderSpineSVG(ast, { theme: 'dark', title: false });
    const band = /<g class="scope" data-owner="loop"><rect x="([\d.]+)" y="([\d.]+)" width="[\d.]+" height="([\d.]+)" rx="8"/.exec(svg);
    expect(band).not.toBeNull();
    expect(svg).toContain('>each line</text>');
    // Two body rows, so the band is two rows tall less its inset...
    expect(Number(band![3])).toBe(2 * 40 - 6);
    // ...and it is drawn before the edges and the rows, so it is behind them.
    expect(svg.indexOf('class="scope"')).toBeLessThan(svg.indexOf('class="edges"'));
    // The body rows themselves are still there, indented off the trunk.
    expect(svg).toContain('>Rate Invoice</text>');
    expect(svg).toContain('>Flag Large</text>');
    expect(renderSpineSVG(gated)).not.toContain('class="scope"');
  }, 60000);

  it('marks the pause: a square tile, the gate kind at the right, a legend line', () => {
    const svg = renderSpineSVG(gated);
    expect(svg).toContain('rx="2"');
    expect(svg).toContain('text-anchor="end" fill="#c79bff">approval</text>');
    expect(svg).toContain('waits for a person or an agent');
  });

  it("uses a step's own icon and colour, and a dashed tile for an expression node", () => {
    const svg = renderSpineSVG(gated, { theme: 'light' });
    // `check` is purple with the science icon: its tile is tinted purple and carries the path.
    expect(svg).toContain(`fill="${mix('#7c4dff', '#ffffff', 0.14)}"`);
    expect(svg).toMatch(/<path d="M197\.37-117\.37[^"]*" fill="#7c4dff"/);
    // `prepare` and `report` are expressions: dashed.
    expect((svg.match(/stroke-dasharray="3 2"/g) ?? []).length).toBe(2);
  });

  it('can leave the title to the page around it', () => {
    const withTitle = renderSpineSVG(gated, { subtitle: 'my-project' });
    expect(withTitle).toContain('>gated</text>');
    expect(withTitle).toContain('my-project, 4 steps, 1 pause');
    const bare = renderSpineSVG(gated, { title: false });
    expect(bare).not.toContain('>gated</text>');
    expect(bare).not.toContain('font-weight="600"');
  });

  it('escapes what it prints', () => {
    const ast = { ...gated, functionName: 'a<b>&"c"' };
    const svg = renderSpineSVG(ast);
    expect(svg).toContain('a&lt;b&gt;&amp;&quot;c&quot;');
    expect(svg).not.toContain('a<b>');
  });

  it('draws a real workflow: every step once, in the console’s order, with the lanes it needs', () => {
    const svg = workflowToSVG(figmaAst, { theme: 'dark' });
    const labels = [...svg.matchAll(/font-size="13" font-weight="500" fill="#e7e9ee">([^<]+)<\/text>/g)].map((m) => m[1]);
    expect(labels).toHaveLength(figmaAst.instances.length);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels[0]).toBe('Ask For Link');
    // Four gates in figma-to-page: each gets its kind at the right.
    expect((svg.match(/text-anchor="end" fill="#c79bff"/g) ?? []).length).toBe(4);
    // Failure arms exist, so more than one lane is drawn.
    expect(paths(svg).some((m) => m[1] === mix('#f0636a', '#313847', 0.45))).toBe(true);
  });
});

describe('mix', () => {
  it('blends like color-mix in srgb', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#ff0000', '#0000ff', 1)).toBe('#ff0000');
    expect(mix('#ff0000', '#0000ff', 0)).toBe('#0000ff');
  });
});
