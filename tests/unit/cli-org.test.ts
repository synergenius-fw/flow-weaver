/**
 * Tests for src/cli/commands/org.ts
 * 100% coverage including resolveOrgId and resolveUserId.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockListOrgs = vi.fn();
const mockCreateOrg = vi.fn();
const mockGetOrg = vi.fn();
const mockInviteOrgMember = vi.fn();
const mockRemoveOrgMember = vi.fn();

vi.mock('../../src/cli/utils/cli-helpers.js', () => ({
  requireLogin: () => ({
    creds: { token: 'jwt', platformUrl: 'https://fw.ai' },
    client: {
      listOrgs: mockListOrgs,
      createOrg: mockCreateOrg,
      getOrg: mockGetOrg,
      inviteOrgMember: mockInviteOrgMember,
      removeOrgMember: mockRemoveOrgMember,
    },
  }),
  isUuid: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  fmt: {
    ok: (m: string) => `✓ ${m}`,
    err: (m: string) => `✗ ${m}`,
    dim: (m: string) => m,
    bold: (m: string) => m,
  },
  exitWithError: (err: unknown, fallback: string) => {
    const msg = err instanceof Error ? err.message : fallback;
    console.error(`✗ ${msg}`);
    process.exit(1);
  },
}));

let consoleOutput: string[] = [];
let consoleErrors: string[] = [];
const origLog = console.log;
const origErr = console.error;
vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });

beforeEach(() => {
  consoleOutput = [];
  consoleErrors = [];
  console.log = (...args: unknown[]) => consoleOutput.push(args.join(' '));
  console.error = (...args: unknown[]) => consoleErrors.push(args.join(' '));
  vi.clearAllMocks();
});

afterEach(() => { console.log = origLog; console.error = origErr; });

describe('orgListCommand', () => {
  it('lists orgs with slug', async () => {
    const { orgListCommand } = await import('../../src/cli/commands/org');
    mockListOrgs.mockResolvedValue([
      { id: 'o1', name: 'Acme', slug: 'acme', role: 'owner', createdAt: '2026-01-01' },
    ]);
    await orgListCommand();
    const out = consoleOutput.join('\n');
    expect(out).toContain('1 organization:');
    expect(out).toContain('Acme');
    expect(out).toContain('acme');
    expect(out).toContain('owner');
  });

  it('shows plural', async () => {
    const { orgListCommand } = await import('../../src/cli/commands/org');
    mockListOrgs.mockResolvedValue([
      { id: 'o1', name: 'A', slug: 'a', role: 'owner', createdAt: '2026-01-01' },
      { id: 'o2', name: 'B', slug: 'b', role: 'editor', createdAt: '2026-01-02' },
    ]);
    await orgListCommand();
    expect(consoleOutput.join('\n')).toContain('2 organizations');
  });

  it('shows empty message', async () => {
    const { orgListCommand } = await import('../../src/cli/commands/org');
    mockListOrgs.mockResolvedValue([]);
    await orgListCommand();
    expect(consoleOutput.join('\n')).toContain('fw org create');
  });

  it('exits on error', async () => {
    const { orgListCommand } = await import('../../src/cli/commands/org');
    mockListOrgs.mockRejectedValue(new Error('fail'));
    await expect(orgListCommand()).rejects.toThrow('process.exit');
  });
});

describe('orgCreateCommand', () => {
  it('creates and shows invite hint', async () => {
    const { orgCreateCommand } = await import('../../src/cli/commands/org');
    mockCreateOrg.mockResolvedValue({ id: 'o1', name: 'Acme', slug: 'acme' });
    await orgCreateCommand('Acme');
    const out = consoleOutput.join('\n');
    expect(out).toContain('Organization created');
    expect(out).toContain('fw org invite acme');
  });

  it('exits on error', async () => {
    const { orgCreateCommand } = await import('../../src/cli/commands/org');
    mockCreateOrg.mockRejectedValue(new Error('Pro required'));
    await expect(orgCreateCommand('test')).rejects.toThrow('process.exit');
  });
});

describe('orgMembersCommand', () => {
  it('resolves slug to ID', async () => {
    const { orgMembersCommand } = await import('../../src/cli/commands/org');
    mockListOrgs.mockResolvedValue([{ id: 'real-uuid', name: 'Acme', slug: 'acme', role: 'owner', createdAt: '2026-01-01' }]);
    mockGetOrg.mockResolvedValue({
      id: 'real-uuid', name: 'Acme', slug: 'acme',
      members: [
        { userId: 'u1', name: 'Alice', email: 'alice@fw.ai', role: 'owner', joinedAt: '2026-01-01' },
        { userId: 'u2', name: 'Bob', email: 'bob@fw.ai', role: 'editor', joinedAt: '2026-01-02' },
      ],
    });
    await orgMembersCommand('acme');
    expect(mockGetOrg).toHaveBeenCalledWith('real-uuid');
    expect(consoleOutput.join('\n')).toContain('alice@fw.ai');
    expect(consoleOutput.join('\n')).toContain('bob@fw.ai');
  });

  it('resolves by name', async () => {
    const { orgMembersCommand } = await import('../../src/cli/commands/org');
    mockListOrgs.mockResolvedValue([{ id: 'id-1', name: 'My Team', slug: 'my-team', role: 'owner', createdAt: '2026-01-01' }]);
    mockGetOrg.mockResolvedValue({ id: 'id-1', name: 'My Team', slug: 'my-team', members: [] });
    await orgMembersCommand('My Team');
    expect(mockGetOrg).toHaveBeenCalledWith('id-1');
  });

  it('resolves by id prefix', async () => {
    const { orgMembersCommand } = await import('../../src/cli/commands/org');
    mockListOrgs.mockResolvedValue([{ id: 'unique-id-123', name: 'X', slug: 'x', role: 'owner', createdAt: '2026-01-01' }]);
    mockGetOrg.mockResolvedValue({ id: 'unique-id-123', name: 'X', slug: 'x', members: [] });
    await orgMembersCommand('unique-id');
    expect(mockGetOrg).toHaveBeenCalledWith('unique-id-123');
  });

  it('accepts full UUID', async () => {
    const { orgMembersCommand } = await import('../../src/cli/commands/org');
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    mockGetOrg.mockResolvedValue({ id: uuid, name: 'X', slug: 'x', members: [] });
    await orgMembersCommand(uuid);
    expect(mockListOrgs).not.toHaveBeenCalled();
  });

  it('errors when no match', async () => {
    const { orgMembersCommand } = await import('../../src/cli/commands/org');
    mockListOrgs.mockResolvedValue([]);
    await expect(orgMembersCommand('nope')).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('No organization matching');
  });

  it('errors when ambiguous', async () => {
    const { orgMembersCommand } = await import('../../src/cli/commands/org');
    mockListOrgs.mockResolvedValue([
      { id: 'o1', name: 'A', slug: 'acme-a', role: 'owner', createdAt: '2026-01-01' },
      { id: 'o2', name: 'B', slug: 'acme-b', role: 'editor', createdAt: '2026-01-02' },
    ]);
    await expect(orgMembersCommand('acme')).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('Ambiguous');
  });

  it('shows empty members', async () => {
    const { orgMembersCommand } = await import('../../src/cli/commands/org');
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    mockGetOrg.mockResolvedValue({ id: uuid, name: 'E', slug: 'e', members: [] });
    await orgMembersCommand(uuid);
    expect(consoleOutput.join('\n')).toContain('No members');
  });
});

describe('orgInviteCommand', () => {
  it('resolves slug and invites', async () => {
    const { orgInviteCommand } = await import('../../src/cli/commands/org');
    mockListOrgs.mockResolvedValue([{ id: 'real-uuid', name: 'Acme', slug: 'acme', role: 'owner', createdAt: '2026-01-01' }]);
    mockInviteOrgMember.mockResolvedValue(undefined);
    await orgInviteCommand('acme', 'new@fw.ai', {});
    expect(mockInviteOrgMember).toHaveBeenCalledWith('real-uuid', 'new@fw.ai', 'editor');
  });

  it('uses specified role', async () => {
    const { orgInviteCommand } = await import('../../src/cli/commands/org');
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    mockInviteOrgMember.mockResolvedValue(undefined);
    await orgInviteCommand(uuid, 'v@fw.ai', { role: 'viewer' });
    expect(mockInviteOrgMember).toHaveBeenCalledWith(uuid, 'v@fw.ai', 'viewer');
  });

  it('rejects invalid role', async () => {
    const { orgInviteCommand } = await import('../../src/cli/commands/org');
    await expect(orgInviteCommand('x', 'a@b.com', { role: 'admin' })).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('Invalid role');
  });

  it('exits on error', async () => {
    const { orgInviteCommand } = await import('../../src/cli/commands/org');
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    mockInviteOrgMember.mockRejectedValue(new Error('Not owner'));
    await expect(orgInviteCommand(uuid, 'a@b.com', {})).rejects.toThrow('process.exit');
  });
});

describe('orgRemoveCommand', () => {
  it('resolves slug and email', async () => {
    const { orgRemoveCommand } = await import('../../src/cli/commands/org');
    mockListOrgs.mockResolvedValue([{ id: 'org-uuid', name: 'Acme', slug: 'acme', role: 'owner', createdAt: '2026-01-01' }]);
    mockGetOrg.mockResolvedValue({
      id: 'org-uuid', name: 'Acme', slug: 'acme',
      members: [{ userId: 'user-uuid', name: 'Bob', email: 'bob@fw.ai', role: 'editor', joinedAt: '2026-01-02' }],
    });
    mockRemoveOrgMember.mockResolvedValue(undefined);
    await orgRemoveCommand('acme', 'bob@fw.ai');
    expect(mockRemoveOrgMember).toHaveBeenCalledWith('org-uuid', 'user-uuid');
  });

  it('resolves by email prefix', async () => {
    const { orgRemoveCommand } = await import('../../src/cli/commands/org');
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    mockGetOrg.mockResolvedValue({
      id: uuid, name: 'X', slug: 'x',
      members: [{ userId: 'u-bob', name: 'Bob', email: 'bob@fw.ai', role: 'editor', joinedAt: '2026-01-01' }],
    });
    mockRemoveOrgMember.mockResolvedValue(undefined);
    await orgRemoveCommand(uuid, 'bob');
    expect(mockRemoveOrgMember).toHaveBeenCalledWith(uuid, 'u-bob');
  });

  it('resolves by userId prefix', async () => {
    const { orgRemoveCommand } = await import('../../src/cli/commands/org');
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    mockGetOrg.mockResolvedValue({
      id: uuid, name: 'X', slug: 'x',
      members: [{ userId: 'user-unique-xyz', name: 'Z', email: 'zoe@fw.ai', role: 'editor', joinedAt: '2026-01-01' }],
    });
    mockRemoveOrgMember.mockResolvedValue(undefined);
    await orgRemoveCommand(uuid, 'user-unique');
    expect(mockRemoveOrgMember).toHaveBeenCalledWith(uuid, 'user-unique-xyz');
  });

  it('accepts UUIDs for both', async () => {
    const { orgRemoveCommand } = await import('../../src/cli/commands/org');
    const orgUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const userUuid = 'b1c2d3e4-f5a6-7890-abcd-ef1234567890';
    mockRemoveOrgMember.mockResolvedValue(undefined);
    await orgRemoveCommand(orgUuid, userUuid);
    expect(mockRemoveOrgMember).toHaveBeenCalledWith(orgUuid, userUuid);
  });

  it('errors when email not found', async () => {
    const { orgRemoveCommand } = await import('../../src/cli/commands/org');
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    mockGetOrg.mockResolvedValue({ id: uuid, name: 'X', slug: 'x', members: [] });
    await expect(orgRemoveCommand(uuid, 'nobody@fw.ai')).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('No member matching');
  });

  it('errors when ambiguous', async () => {
    const { orgRemoveCommand } = await import('../../src/cli/commands/org');
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    mockGetOrg.mockResolvedValue({
      id: uuid, name: 'X', slug: 'x',
      members: [
        { userId: 'u1', name: 'A', email: 'alice@fw.ai', role: 'editor', joinedAt: '2026-01-01' },
        { userId: 'u2', name: 'B', email: 'alice-alt@fw.ai', role: 'viewer', joinedAt: '2026-01-02' },
      ],
    });
    await expect(orgRemoveCommand(uuid, 'alice')).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('Ambiguous');
  });

  it('exits on API error', async () => {
    const { orgRemoveCommand } = await import('../../src/cli/commands/org');
    const orgUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const userUuid = 'b1c2d3e4-f5a6-7890-abcd-ef1234567890';
    mockRemoveOrgMember.mockRejectedValue(new Error('Not found'));
    await expect(orgRemoveCommand(orgUuid, userUuid)).rejects.toThrow('process.exit');
  });
});
