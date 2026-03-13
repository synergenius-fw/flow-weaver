/**
 * Coverage for src/cli/templates/pack-loader.ts uncovered lines 44-47, 57:
 * - Lines 44-47: loading templates from pack module and filtering by manifest
 * - Line 57: calling registerWorkflowTemplates when templates are found
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dynamic imports the module uses
vi.mock('../../src/marketplace/registry.js', () => ({
  listInstalledPackages: vi.fn(),
}));

vi.mock('../../src/cli/commands/init-personas.js', () => ({
  registerPackUseCase: vi.fn(),
}));

vi.mock('../../src/cli/templates/index.js', () => ({
  registerWorkflowTemplates: vi.fn(),
}));

import { loadPackTemplates } from '../../src/cli/templates/pack-loader.js';
import { listInstalledPackages } from '../../src/marketplace/registry.js';
import { registerPackUseCase } from '../../src/cli/commands/init-personas.js';
import { registerWorkflowTemplates } from '../../src/cli/templates/index.js';

const mockedList = vi.mocked(listInstalledPackages);
const mockedRegisterTemplates = vi.mocked(registerWorkflowTemplates);
const mockedRegisterUseCase = vi.mocked(registerPackUseCase);

beforeEach(() => {
  mockedList.mockReset();
  mockedRegisterTemplates.mockReset();
  mockedRegisterUseCase.mockReset();
});

describe('loadPackTemplates', () => {
  it('does nothing when no packs have initContributions', async () => {
    mockedList.mockResolvedValueOnce([
      {
        name: 'flow-weaver-pack-empty',
        version: '1.0.0',
        path: '/fake/pack',
        manifest: {
          name: 'flow-weaver-pack-empty',
          version: '1.0.0',
        },
      },
    ] as any);

    await loadPackTemplates('/fake/project');
    expect(mockedRegisterTemplates).not.toHaveBeenCalled();
  });

  it('skips packs whose templates.js does not exist', async () => {
    mockedList.mockResolvedValueOnce([
      {
        name: 'flow-weaver-pack-no-file',
        version: '1.0.0',
        path: '/nonexistent/path/that/wont/exist',
        manifest: {
          name: 'flow-weaver-pack-no-file',
          version: '1.0.0',
          initContributions: {
            templates: ['tmpl-1'],
          },
        },
      },
    ] as any);

    await loadPackTemplates('/fake/project');
    expect(mockedRegisterTemplates).not.toHaveBeenCalled();
  });

  it('registers use case when declared in contributions', async () => {
    mockedList.mockResolvedValueOnce([
      {
        name: 'flow-weaver-pack-usecase',
        version: '1.0.0',
        path: '/nonexistent/path',
        manifest: {
          name: 'flow-weaver-pack-usecase',
          version: '1.0.0',
          initContributions: {
            useCase: { id: 'test-case', label: 'Test', description: 'A test use case' },
            templates: ['tmpl-x'],
          },
        },
      },
    ] as any);

    await loadPackTemplates('/fake/project');
    expect(mockedRegisterUseCase).toHaveBeenCalledWith(
      { id: 'test-case', label: 'Test', description: 'A test use case' },
      ['tmpl-x'],
    );
  });

  it('loads and registers matching templates from templates.js', async () => {
    // Create a real temp module to exercise lines 44-47 and 57
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-pack-loader-'));

    // Write a templates.js file that exports workflowTemplates array
    fs.writeFileSync(
      path.join(tmpDir, 'templates.js'),
      `export const workflowTemplates = [
        { id: 'tmpl-a', name: 'Template A', description: 'Test A', source: '// a' },
        { id: 'tmpl-b', name: 'Template B', description: 'Test B', source: '// b' },
        { id: 'tmpl-c', name: 'Template C', description: 'Test C', source: '// c' },
      ];`,
      'utf8',
    );

    mockedList.mockResolvedValueOnce([
      {
        name: 'flow-weaver-pack-with-templates',
        version: '1.0.0',
        path: tmpDir,
        manifest: {
          name: 'flow-weaver-pack-with-templates',
          version: '1.0.0',
          initContributions: {
            templates: ['tmpl-a', 'tmpl-c'], // Only these two should be registered
          },
        },
      },
    ] as any);

    await loadPackTemplates('/fake/project');

    expect(mockedRegisterTemplates).toHaveBeenCalledTimes(1);
    const registered = mockedRegisterTemplates.mock.calls[0][0];
    expect(registered).toHaveLength(2);
    expect(registered[0].id).toBe('tmpl-a');
    expect(registered[1].id).toBe('tmpl-c');

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('silently catches when marketplace scanning fails', async () => {
    mockedList.mockRejectedValueOnce(new Error('No node_modules'));
    // Should not throw
    await expect(loadPackTemplates('/fake/project')).resolves.toBeUndefined();
  });
});
