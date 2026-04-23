/**
 * TDD tests for safeWriteFile utility.
 *
 * Cross-platform safe file writing that:
 * - Creates parent directories if they don't exist
 * - Provides clear error messages for permission issues
 * - Works on Windows, macOS, and Linux
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { safeWriteFile, safeAppendFile } from '../../src/cli/utils/safe-write';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-safe-write-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('safeWriteFile', () => {
  it('writes to an existing directory', () => {
    const filePath = path.join(tmpDir, 'output.ts');
    safeWriteFile(filePath, 'hello world');
    expect(fs.readFileSync(filePath, 'utf8')).toBe('hello world');
  });

  it('creates parent directories if they do not exist', () => {
    const filePath = path.join(tmpDir, 'deep', 'nested', 'dir', 'output.ts');
    safeWriteFile(filePath, 'nested content');
    expect(fs.readFileSync(filePath, 'utf8')).toBe('nested content');
  });

  it('overwrites an existing file', () => {
    const filePath = path.join(tmpDir, 'existing.ts');
    fs.writeFileSync(filePath, 'old content');
    safeWriteFile(filePath, 'new content');
    expect(fs.readFileSync(filePath, 'utf8')).toBe('new content');
  });

  it('throws a clear error when file is read-only', () => {
    // Skip on Windows — chmod doesn't reliably prevent writes
    if (process.platform === 'win32') return;
    // Skip when running as root (e.g. self-hosted runner containers) —
    // root bypasses Linux file-permission checks, so 0o444 doesn't block.
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;

    const filePath = path.join(tmpDir, 'readonly.ts');
    fs.writeFileSync(filePath, 'locked');
    fs.chmodSync(filePath, 0o444);

    expect(() => safeWriteFile(filePath, 'new content')).toThrow(/permission|read-only|EACCES/i);

    // Restore permissions for cleanup
    fs.chmodSync(filePath, 0o644);
  });

  it('throws a clear error when parent directory is read-only', () => {
    if (process.platform === 'win32') return;
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;

    const readOnlyDir = path.join(tmpDir, 'locked-dir');
    fs.mkdirSync(readOnlyDir);
    fs.chmodSync(readOnlyDir, 0o555);

    const filePath = path.join(readOnlyDir, 'file.ts');

    expect(() => safeWriteFile(filePath, 'content')).toThrow(/permission|EACCES/i);

    // Restore permissions for cleanup
    fs.chmodSync(readOnlyDir, 0o755);
  });

  it('handles paths with spaces', () => {
    const filePath = path.join(tmpDir, 'path with spaces', 'my file.ts');
    safeWriteFile(filePath, 'spaced content');
    expect(fs.readFileSync(filePath, 'utf8')).toBe('spaced content');
  });

  it('handles paths with unicode characters', () => {
    const filePath = path.join(tmpDir, 'unicöde-dir', 'output.ts');
    safeWriteFile(filePath, 'unicode content');
    expect(fs.readFileSync(filePath, 'utf8')).toBe('unicode content');
  });
});

describe('safeAppendFile', () => {
  it('appends to an existing file', () => {
    const filePath = path.join(tmpDir, 'append.ts');
    fs.writeFileSync(filePath, 'first');
    safeAppendFile(filePath, ' second');
    expect(fs.readFileSync(filePath, 'utf8')).toBe('first second');
  });

  it('creates file and parent dirs if they do not exist', () => {
    const filePath = path.join(tmpDir, 'new', 'append.ts');
    safeAppendFile(filePath, 'new content');
    expect(fs.readFileSync(filePath, 'utf8')).toBe('new content');
  });

  it('throws clear error on permission issues', () => {
    if (process.platform === 'win32') return;
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;

    const filePath = path.join(tmpDir, 'readonly-append.ts');
    fs.writeFileSync(filePath, 'locked');
    fs.chmodSync(filePath, 0o444);

    expect(() => safeAppendFile(filePath, ' more')).toThrow(/permission|read-only|EACCES/i);

    fs.chmodSync(filePath, 0o644);
  });
});
