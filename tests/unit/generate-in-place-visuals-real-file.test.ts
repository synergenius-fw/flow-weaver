/**
 * Reproduces bug using the actual workspace file that fails on the server.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parser } from '../../src/parser';
import { updateNodeType } from '../../src/api';
import { generateInPlace } from '../../src/api/generate-in-place';
import fs from 'fs';
import path from 'path';
import os from 'os';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'testing-visuals-real.ts.fixture');

describe('generateInPlace @color update with real workspace file', () => {
  let tmpDir: string;
  let tmpFile: string;
  let sourceCode: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-real-'));
    tmpFile = path.join(tmpDir, 'testing.ts');
    fs.copyFileSync(FIXTURE, tmpFile);
    sourceCode = fs.readFileSync(tmpFile, 'utf-8');
    parser.clearCache();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sanity: file has @color teal', () => {
    expect(sourceCode).toContain('@color teal');
    expect(sourceCode).toContain('@icon ai');
  });

  it('updates @color with fresh parse', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];
    const updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'green', icon: 'ai' },
    });
    const result = generateInPlace(sourceCode, updated);

    expect(result.code).toContain('@color green');
    expect(result.code).not.toContain('@color teal');
  });

  it('updates @color after prior parse (server scenario)', () => {
    // First parse (server startup / workflow load)
    parser.parse(tmpFile);

    // Second parse (mutateWorkflowFile re-parse)
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];
    const updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'green', icon: 'ai' },
    });
    const result = generateInPlace(sourceCode, updated);

    expect(result.code).toContain('@color green');
    expect(result.code).not.toContain('@color teal');
  });

  it('updates @color after parse with external node types', () => {
    // Server passes external node types on some parses
    parser.parse(tmpFile, []);

    const parsed = parser.parse(tmpFile, []);
    const wf = parsed.workflows[0];
    const updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'green', icon: 'ai' },
    });
    const result = generateInPlace(sourceCode, updated);

    expect(result.code).toContain('@color green');
    expect(result.code).not.toContain('@color teal');
  });

  it('updates @color after parse-generate-write-parse cycle', () => {
    // Simulate: server loads workflow, does some other mutation, writes file, then color change
    const parsed1 = parser.parse(tmpFile);
    const wf1 = parsed1.workflows[0];

    // Some other mutation (e.g. node position change) generates and writes
    const intermediate = generateInPlace(sourceCode, wf1);
    fs.writeFileSync(tmpFile, intermediate.code);

    // Force mtime change
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(tmpFile, future, future);

    // Now the color mutation
    const newSource = fs.readFileSync(tmpFile, 'utf-8');
    const parsed2 = parser.parse(tmpFile);
    const wf2 = parsed2.workflows[0];
    const updated = updateNodeType(wf2, 'shout', {
      visuals: { color: 'green', icon: 'ai' },
    });
    const result = generateInPlace(newSource, updated);

    expect(result.code).toContain('@color green');
    expect(result.code).not.toContain('@color teal');
  });

  it('updates @color with allWorkflows option', () => {
    parser.parse(tmpFile);
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];
    const updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'green', icon: 'ai' },
    });
    const result = generateInPlace(sourceCode, updated, {
      allWorkflows: parsed.workflows,
    });

    expect(result.code).toContain('@color green');
    expect(result.code).not.toContain('@color teal');
  });

  it('updates @color when sourceCode read differs from parsed file', () => {
    // Server reads file, then parser.parse re-reads independently
    // There could be a subtle whitespace or encoding difference
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];
    const updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'green', icon: 'ai' },
    });

    // Pass the raw source (not what the parser read internally)
    const rawSource = fs.readFileSync(tmpFile, 'utf-8');
    const result = generateInPlace(rawSource, updated);

    expect(result.code).toContain('@color green');
    expect(result.code).not.toContain('@color teal');
  });
});
