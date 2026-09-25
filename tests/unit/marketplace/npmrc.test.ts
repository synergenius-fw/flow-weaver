/**
 * Registries read the way npm reads them, so a search reaches the private
 * registry an install already uses.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseNpmrc, nerfDart, readNpmConfig, resolveRegistries } from '../../../src/marketplace/npmrc';

const USER = `
# the user's file
registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=pub-token
//npm.example.com/:_authToken=private-token
@acme:registry=https://npm.example.com/
@other:registry=https://npm.example.com
`;

describe('parseNpmrc', () => {
  it('reads key=value lines and skips comments', () => {
    const c = parseNpmrc(USER);
    expect(c.get('registry')).toBe('https://registry.npmjs.org/');
    expect(c.get('@acme:registry')).toBe('https://npm.example.com/');
    expect(c.get('//npm.example.com/:_authToken')).toBe('private-token');
    expect(c.has('# the user\'s file')).toBe(false);
  });

  it('expands ${VAR} from the environment, and skips a line whose variable is unset', () => {
    const c = parseNpmrc('//h/:_authToken=${TOKEN}\n//g/:_authToken=${MISSING}\n', { TOKEN: 'abc' });
    expect(c.get('//h/:_authToken')).toBe('abc');
    expect(c.has('//g/:_authToken')).toBe(false);
  });
});

describe('nerfDart', () => {
  it('is the host and path an auth key is written against', () => {
    expect(nerfDart('https://npm.example.com')).toBe('//npm.example.com/');
    expect(nerfDart('https://npm.pkg.github.com/acme')).toBe('//npm.pkg.github.com/acme/');
  });
});

describe('resolveRegistries', () => {
  it('lists the default and every scoped registry once, with its token', () => {
    const regs = resolveRegistries('/nowhere', parseNpmrc(USER));
    expect(regs).toEqual([
      { url: 'https://registry.npmjs.org/', scopes: [], isDefault: true, authorization: 'Bearer pub-token' },
      { url: 'https://npm.example.com/', scopes: ['@acme', '@other'], isDefault: false, authorization: 'Bearer private-token' },
    ]);
  });

  it('matches the token by the longest prefix, as npm does', () => {
    const c = parseNpmrc('@a:registry=https://npm.pkg.github.com/acme/\n//npm.pkg.github.com/:_authToken=broad\n//npm.pkg.github.com/acme/:_authToken=narrow\n');
    expect(resolveRegistries('/nowhere', c)[1].authorization).toBe('Bearer narrow');
  });

  it('finds the token of a registry on a port, as npm writes it', () => {
    const c = parseNpmrc('registry=http://localhost:4873/\n//localhost:4873/:_authToken=tok\n');
    expect(resolveRegistries('/nowhere', c)).toEqual([
      { url: 'http://localhost:4873/', scopes: [], isDefault: true, authorization: 'Bearer tok' },
    ]);
  });

  it('reads basic credentials too', () => {
    const c = parseNpmrc('@a:registry=https://r.example/\n//r.example/:username=me\n//r.example/:_password=cGFzcw==\n');
    expect(resolveRegistries('/nowhere', c)[1].authorization).toBe(`Basic ${Buffer.from('me:cGFzcw==').toString('base64')}`);
  });

  it('has no authorization where the file has none', () => {
    const regs = resolveRegistries('/nowhere', new Map());
    expect(regs).toEqual([{ url: 'https://registry.npmjs.org/', scopes: [], isDefault: true }]);
  });
});

describe('readNpmConfig', () => {
  it('lets the project file override the user file, and the environment override both', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-home-'));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-proj-'));
    fs.writeFileSync(path.join(home, '.npmrc'), 'registry=https://user.example/\n@s:registry=https://user.example/\n');
    fs.writeFileSync(path.join(project, '.npmrc'), '@s:registry=https://project.example/\n');
    const c = readNpmConfig(project, {}, home);
    expect(c.get('registry')).toBe('https://user.example/');
    expect(c.get('@s:registry')).toBe('https://project.example/');
    expect(readNpmConfig(project, { npm_config_registry: 'https://env.example/' }, home).get('registry')).toBe('https://env.example/');
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('is empty without any file', () => {
    expect(readNpmConfig('/nowhere/at/all', {}, '/nowhere/either').size).toBe(0);
  });
});
