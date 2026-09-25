/**
 * `fw console` binds to loopback. The console has no login, so a host anyone
 * can reach is refused unless --insecure says that is wanted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateConsoleServer = vi.fn();
vi.mock('../../../src/console/server.js', () => ({
  createConsoleServer: (...args: unknown[]) => mockCreateConsoleServer(...args),
}));
vi.mock('../../../src/service-registry.js', () => ({
  announceService: () => ({ update: vi.fn(), stop: vi.fn() }),
}));
vi.mock('../../../src/cli/utils/logger.js', () => ({
  logger: { log: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { consoleCommand } from '../../../src/cli/commands/console.js';

beforeEach(() => {
  mockCreateConsoleServer.mockReset().mockResolvedValue({ url: 'http://127.0.0.1:4311', close: vi.fn().mockResolvedValue(undefined) });
  vi.spyOn(process, 'once').mockImplementation(((event: string, handler: () => void) => {
    if (event === 'SIGINT') queueMicrotask(handler);
    return process;
  }) as never);
});

describe('consoleCommand', () => {
  it('refuses a host beyond loopback without --insecure, and allows it with', async () => {
    await expect(consoleCommand(process.cwd(), { host: '0.0.0.0' })).rejects.toThrow(/no login[\s\S]*--insecure/);
    expect(mockCreateConsoleServer).not.toHaveBeenCalled();

    await consoleCommand(process.cwd(), { host: '0.0.0.0', insecure: true });
    expect(mockCreateConsoleServer).toHaveBeenCalledWith(expect.objectContaining({ host: '0.0.0.0' }));
  });

  it('binds to 127.0.0.1 by default', async () => {
    await consoleCommand(process.cwd(), {});
    expect(mockCreateConsoleServer).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1' }));
  });

  it('refuses a directory that does not exist', async () => {
    await expect(consoleCommand('/nowhere/at/all', {})).rejects.toThrow(/Directory not found/);
  });
});
