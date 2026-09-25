/**
 * Running npm for the marketplace: install a pack, publish one.
 *
 * npm runs through execFile with an argument list, never through a shell, and
 * the package spec is checked against the shapes npm accepts before npm sees
 * it. The spec reaches here from the command line, from the console and from
 * an MCP client, so it is untrusted input.
 */

import { execFileSync, type StdioOptions } from 'node:child_process';

const NAME = '(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*';
/** `name`, `@scope/name`, either followed by `@version`, `@tag` or `@range`. */
const REGISTRY_SPEC = new RegExp(`^${NAME}(?:@[A-Za-z0-9._^~<>=|*+-]+)?$`);
/** A tarball or directory on disk: `./x.tgz`, `../x`, `/abs/x`, `file:x`. No shell metacharacters. */
const LOCAL_SPEC = /^(?:file:|\.{1,2}\/|\/)[^\s;&|<>`$(){}[\]'"\\]+$/;

/** Whether `spec` is something `npm install` takes as a single package argument. */
export function isPackageSpec(spec: string): boolean {
  return REGISTRY_SPEC.test(spec) || LOCAL_SPEC.test(spec);
}

export interface NpmOptions {
  cwd?: string;
  stdio?: StdioOptions;
}

/** Run npm with these arguments, without a shell. */
export function runNpm(args: string[], options: NpmOptions = {}): void {
  // On Windows npm is a .cmd shim, which only a shell can start. The
  // arguments are validated, so the shell sees nothing it could interpret.
  const win = process.platform === 'win32';
  execFileSync(win ? 'npm.cmd' : 'npm', args, { cwd: options.cwd, stdio: options.stdio ?? 'pipe', shell: win });
}

/** `npm install <spec>`, refusing a spec that is not a package name, version or local path. */
export function npmInstall(spec: string, options: NpmOptions = {}): void {
  if (!isPackageSpec(spec)) {
    throw new Error(`"${spec}" is not a package name, name@version, or local path`);
  }
  runNpm(['install', spec], options);
}
