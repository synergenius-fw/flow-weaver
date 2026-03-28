/**
 * Cross-platform safe file writing utilities.
 *
 * - Creates parent directories automatically
 * - Provides clear error messages for permission issues
 * - Works on Windows, macOS, and Linux
 */

import * as fs from 'fs';
import * as path from 'path';

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function wrapIOError(filePath: string, error: unknown): never {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(`Permission denied: cannot write to ${filePath}. Check file/directory permissions.`);
    }
    if (code === 'EROFS') {
      throw new Error(`Read-only file system: cannot write to ${filePath}.`);
    }
    throw error;
  }
  throw error;
}

/**
 * Write content to a file, creating parent directories as needed.
 * Throws a clear error on permission issues.
 */
export function safeWriteFile(filePath: string, content: string, encoding: BufferEncoding = 'utf8'): void {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, encoding);
  } catch (error) {
    wrapIOError(filePath, error);
  }
}

/**
 * Append content to a file, creating the file and parent directories as needed.
 * Throws a clear error on permission issues.
 */
export function safeAppendFile(filePath: string, content: string, encoding: BufferEncoding = 'utf8'): void {
  try {
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, content, encoding);
  } catch (error) {
    wrapIOError(filePath, error);
  }
}
