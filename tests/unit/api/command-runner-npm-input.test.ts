/**
 * The marketplace commands of runCommand take a package, a name or a
 * dist-tag from their caller. npm runs without a shell, and each value is
 * checked before npm sees it, so text that a shell would interpret is
 * refused rather than run.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runCommand } from '../../../src/api/command-runner.js';

let dir: string;
let marker: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-npm-input-'));
  marker = path.join(dir, 'pwned');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const hostile = () => [`x; touch ${marker}`, `$(touch ${marker})`, `x && touch ${marker}`, `\`touch ${marker}\``];

describe('runCommand marketplace input', () => {
  it('refuses a package spec a shell would interpret, and runs nothing', async () => {
    for (const pkg of hostile()) {
      const result = await runCommand('market-install', { package: pkg, cwd: dir });
      expect(result.data, pkg).toMatchObject({ success: false, error: expect.stringContaining('is not a package name') });
    }
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('refuses to uninstall anything but a package name', async () => {
    for (const pkg of [...hostile(), 'name@1.0.0', './local']) {
      const result = await runCommand('market-uninstall', { package: pkg, cwd: dir });
      expect(result.data, pkg).toMatchObject({ success: false, error: expect.stringContaining('is not a package name') });
    }
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('refuses a dist-tag that is not a plain word', async () => {
    // private: should the check ever regress, npm still refuses to publish it.
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'flow-weaver-pack-x', version: '1.0.0', private: true }));
    for (const tag of [...hostile(), '--registry=https://evil.example', '']) {
      if (tag === '') continue;
      const result = await runCommand('market-publish', { directory: dir, tag });
      expect(result.data, tag).toMatchObject({ success: false, error: expect.stringContaining('is not a dist-tag') });
    }
    expect(fs.existsSync(marker)).toBe(false);
  });
});
