import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildSafeEnv, buildSafeSpawnOpts, ENV_ALLOWLIST, MINIMAL_PATH } from '../../src/agent/env-allowlist.js';

describe('env-allowlist', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('should only forward allowlisted variables', () => {
    process.env.PATH = '/usr/bin';
    process.env.SECRET_KEY = 'should-not-appear';
    process.env.LANG = 'en_US.UTF-8';

    const env = buildSafeEnv();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env.SECRET_KEY).toBeUndefined();
  });

  it('should apply overrides', () => {
    process.env.PATH = '/usr/bin';

    const env = buildSafeEnv({ PATH: '/custom/path', CUSTOM: 'value' });
    expect(env.PATH).toBe('/custom/path');
    expect(env.CUSTOM).toBe('value');
  });

  it('should not include unset allowlisted vars', () => {
    delete process.env.SSL_CERT_FILE;
    const env = buildSafeEnv();
    expect(env.SSL_CERT_FILE).toBeUndefined();
  });

  it('MINIMAL_PATH should contain standard system dirs', () => {
    expect(MINIMAL_PATH).toContain('/usr/bin');
    expect(MINIMAL_PATH).toContain('/bin');
  });

  it('ENV_ALLOWLIST should include proxy vars', () => {
    expect(ENV_ALLOWLIST).toContain('HTTP_PROXY');
    expect(ENV_ALLOWLIST).toContain('HTTPS_PROXY');
    expect(ENV_ALLOWLIST).toContain('NO_PROXY');
  });

  it('buildSafeSpawnOpts should return cwd and env', () => {
    process.env.PATH = '/usr/bin';
    const opts = buildSafeSpawnOpts('/workspace', { HOME: '/custom' });
    expect(opts.cwd).toBe('/workspace');
    expect(opts.env.PATH).toBe('/usr/bin');
    expect(opts.env.HOME).toBe('/custom');
  });
});
