/**
 * `fw_doctor` must say which Flow Weaver it is.
 *
 * The MCP server is configured with an absolute path to one install, and it
 * keeps running that install whatever directory the tools are pointed at. In
 * a worktree that means: rebuild `dist/` here, and `fw_compile` still emits
 * code from the main checkout's `dist/`, with nothing to say so. That reads
 * as "my fix did not work" and costs real time. The report now carries the
 * running version and install path, and warns when the directory being
 * checked is a different Flow Weaver checkout from the one that is running.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VERSION } from '../../src/generated-version';
import {
  checkServerInstall,
  runDoctorChecks,
  serverInstallInfo,
} from '../../src/cli/commands/doctor';

const TEMP_DIR = path.join(os.tmpdir(), `fw-doctor-install-${process.pid}`);

beforeEach(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe('doctor reports the running install', () => {
  it('names the running version and an install path that holds this package', () => {
    const info = serverInstallInfo();
    expect(info.version).toBe(VERSION);
    const pkg = JSON.parse(fs.readFileSync(path.join(info.installPath, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('@synergenius/flow-weaver');
  });

  it('puts the same information on the report', () => {
    const report = runDoctorChecks(TEMP_DIR);
    expect(report.server.version).toBe(VERSION);
    expect(report.server.installPath).toBe(serverInstallInfo().installPath);
    expect(report.checks.some((c) => c.name === 'Running install')).toBe(true);
  });

  it('passes when the checked directory is the running checkout itself', () => {
    const result = checkServerInstall(serverInstallInfo().installPath);
    expect(result.status).toBe('pass');
    expect(result.message).toContain(VERSION);
  });

  it('passes, and says where it runs from, for an ordinary project directory', () => {
    fs.writeFileSync(path.join(TEMP_DIR, 'package.json'), JSON.stringify({ name: 'some-app' }));
    const result = checkServerInstall(TEMP_DIR);
    expect(result.status).toBe('pass');
    expect(result.message).toContain(serverInstallInfo().installPath);
  });

  it('warns when the checked directory is a different Flow Weaver checkout', () => {
    // A second checkout of this very package -- a git worktree, typically.
    fs.writeFileSync(
      path.join(TEMP_DIR, 'package.json'),
      JSON.stringify({ name: '@synergenius/flow-weaver', version: VERSION }),
    );
    const result = checkServerInstall(TEMP_DIR);
    expect(result.status).toBe('warn');
    expect(result.message).toContain(serverInstallInfo().installPath);
    expect(result.fix).toMatch(/restart|rebuild/i);
  });
});
