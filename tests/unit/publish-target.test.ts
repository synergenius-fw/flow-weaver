/**
 * The package is published to the public npm registry only. A machine that
 * maps the @synergenius scope to a private registry (in ~/.npmrc or a project
 * .npmrc) would otherwise send `npm publish` there: the scope mapping beats
 * both `--registry` and `publishConfig.registry`. Only a scope entry in
 * `publishConfig` beats the mapping.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PUBLIC = 'https://registry.npmjs.org/';
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as {
  name: string;
  publishConfig?: Record<string, string>;
};

describe('where the package is published', () => {
  it('pins its own scope to the public registry', () => {
    const scope = pkg.name.split('/')[0];
    expect(scope).toBe('@synergenius');
    expect(pkg.publishConfig?.[`${scope}:registry`]).toBe(PUBLIC);
  });

  it('publishes publicly to the public registry', () => {
    expect(pkg.publishConfig?.registry).toBe(PUBLIC);
    expect(pkg.publishConfig?.access).toBe('public');
  });

  it('ships no .npmrc that routes the scope elsewhere', () => {
    expect(fs.existsSync(path.resolve(__dirname, '../../.npmrc'))).toBe(false);
  });
});
