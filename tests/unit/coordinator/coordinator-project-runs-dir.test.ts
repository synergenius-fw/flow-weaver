import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultRunsDir, resolveProjectRoot } from '../../../src/coordinator/index.js';

/**
 * The run store must follow the workflow FILE, not the process's working
 * directory, so a console and an MCP server launched from different places
 * resolve the same <projectRoot>/.fw/runs. These tests pin that resolution.
 */

let tmp: string;
const savedRunsDir = process.env.FW_RUNS_DIR;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-proj-'));
  delete process.env.FW_RUNS_DIR;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (savedRunsDir === undefined) delete process.env.FW_RUNS_DIR;
  else process.env.FW_RUNS_DIR = savedRunsDir;
});

describe('resolveProjectRoot', () => {
  it('finds the nearest ancestor with a package.json', () => {
    const root = path.join(tmp, 'proj');
    const deep = path.join(root, 'src', 'flows');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    const file = path.join(deep, 'wf.ts');
    fs.writeFileSync(file, '// workflow');
    expect(resolveProjectRoot(file)).toBe(path.resolve(root));
  });

  it('recognises an existing .fw directory as a project marker', () => {
    const root = path.join(tmp, 'proj2');
    const deep = path.join(root, 'a', 'b');
    fs.mkdirSync(deep, { recursive: true });
    fs.mkdirSync(path.join(root, '.fw'));
    const file = path.join(deep, 'wf.ts');
    fs.writeFileSync(file, '// workflow');
    expect(resolveProjectRoot(file)).toBe(path.resolve(root));
  });

  it("falls back to the file's own directory when there is no marker", () => {
    const dir = path.join(tmp, 'loose');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'wf.ts');
    fs.writeFileSync(file, '// workflow');
    expect(resolveProjectRoot(file)).toBe(path.resolve(dir));
  });

  it('resolves the same project for two files in one project', () => {
    const root = path.join(tmp, 'shared');
    fs.mkdirSync(path.join(root, 'src', 'a'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src', 'b'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    const fileA = path.join(root, 'src', 'a', 'one.ts');
    const fileB = path.join(root, 'src', 'b', 'two.ts');
    fs.writeFileSync(fileA, '');
    fs.writeFileSync(fileB, '');
    expect(resolveProjectRoot(fileA)).toBe(resolveProjectRoot(fileB));
  });

  it('handles a file that does not exist yet', () => {
    const root = path.join(tmp, 'notyet');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    const file = path.join(root, 'src', 'new.ts'); // src/ not created
    expect(resolveProjectRoot(file)).toBe(path.resolve(root));
  });
});

describe('defaultRunsDir precedence', () => {
  it('uses <projectRoot>/.fw/runs when given a file anchor', () => {
    const root = path.join(tmp, 'proj');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    const file = path.join(root, 'src', 'wf.ts');
    fs.writeFileSync(file, '');
    expect(defaultRunsDir(file)).toBe(path.join(path.resolve(root), '.fw', 'runs'));
  });

  it('falls back to ~/.fw/runs with no anchor', () => {
    expect(defaultRunsDir()).toBe(path.join(os.homedir(), '.fw', 'runs'));
  });

  it('lets FW_RUNS_DIR override both, anchor or not', () => {
    process.env.FW_RUNS_DIR = path.join(tmp, 'override');
    const root = path.join(tmp, 'proj');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    const file = path.join(root, 'wf.ts');
    fs.writeFileSync(file, '');
    expect(defaultRunsDir(file)).toBe(path.join(tmp, 'override'));
    expect(defaultRunsDir()).toBe(path.join(tmp, 'override'));
  });
});
