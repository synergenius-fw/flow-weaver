import type { PlatformClient } from '../config/platform-client.js';
import { requireLogin, isUuid, fmt, exitWithError } from '../utils/cli-helpers.js';

/**
 * Resolve an org identifier (UUID, slug, name, or prefix) to an org ID.
 * Exact slug/name matches take priority over prefix matches.
 */
async function resolveOrgId(client: PlatformClient, identifier: string): Promise<string> {
  if (isUuid(identifier)) return identifier;

  const orgs = await client.listOrgs();

  // Exact match first (slug or name)
  const exact = orgs.find((o) => o.slug === identifier || o.name === identifier);
  if (exact) return exact.id;

  // Prefix match as fallback
  const prefixMatches = orgs.filter(
    (o) => o.slug.startsWith(identifier) || o.id.startsWith(identifier),
  );

  if (prefixMatches.length === 0) {
    throw new Error(`No organization matching "${identifier}". Run: fw org list`);
  }
  if (prefixMatches.length > 1) {
    throw new Error(`Ambiguous: "${identifier}" matches ${prefixMatches.length} organizations. Use the full slug or ID.`);
  }
  return prefixMatches[0].id;
}

/**
 * Resolve a user identifier (email, email prefix, or UUID) to a userId within an org.
 * Exact email matches take priority over prefix matches.
 */
async function resolveUserId(
  client: PlatformClient,
  orgId: string,
  identifier: string,
  orgLabel?: string,
): Promise<string> {
  if (isUuid(identifier)) return identifier;

  const org = await client.getOrg(orgId);

  // Exact match first
  const exact = org.members.find((m) => m.email === identifier);
  if (exact) return exact.userId;

  // Prefix match as fallback
  const prefixMatches = org.members.filter(
    (m) => m.email.startsWith(identifier) || m.userId.startsWith(identifier),
  );

  if (prefixMatches.length === 0) {
    throw new Error(`No member matching "${identifier}" in this organization. Run: fw org members ${orgLabel ?? orgId}`);
  }
  if (prefixMatches.length > 1) {
    throw new Error(`Ambiguous: "${identifier}" matches ${prefixMatches.length} members. Use the full email or ID.`);
  }
  return prefixMatches[0].userId;
}

export async function orgListCommand(): Promise<void> {
  const { client } = requireLogin();

  try {
    const orgs = await client.listOrgs();

    console.log('');
    if (orgs.length === 0) {
      console.log('  No organizations. Create one with: fw org create <name>');
    } else {
      console.log(`  ${orgs.length} organization${orgs.length === 1 ? '' : 's'}:`);
      console.log('');
      for (const org of orgs) {
        const roleColor = org.role === 'owner' ? '\x1b[33m' : '\x1b[2m';
        console.log(`    ${fmt.bold(org.name)}  ${fmt.dim(org.slug)}  ${roleColor}${org.role}\x1b[0m`);
      }
    }
    console.log('');
  } catch (err) {
    exitWithError(err, 'Failed to list organizations');
  }
}

export async function orgCreateCommand(name: string): Promise<void> {
  const { client } = requireLogin();

  try {
    const org = await client.createOrg(name);

    console.log('');
    console.log(fmt.ok('Organization created'));
    console.log('');
    console.log(`  Name: ${org.name}`);
    console.log(`  Slug: ${org.slug}`);
    console.log(`  ID:   ${fmt.dim(org.id)}`);
    console.log('');
    console.log(`  Invite members: fw org invite ${org.slug} <email>`);
    console.log('');
  } catch (err) {
    exitWithError(err, 'Failed to create organization');
  }
}

export async function orgMembersCommand(identifier: string): Promise<void> {
  const { client } = requireLogin();

  try {
    const orgId = await resolveOrgId(client, identifier);
    const org = await client.getOrg(orgId);

    console.log('');
    console.log(`  ${fmt.bold(org.name)}`);
    console.log('');
    if (org.members.length === 0) {
      console.log('  No members.');
    } else {
      for (const m of org.members) {
        const roleColor = m.role === 'owner' ? '\x1b[33m' : '\x1b[2m';
        console.log(`    ${m.email.padEnd(30)} ${m.name.padEnd(20)} ${roleColor}${m.role}\x1b[0m`);
      }
    }
    console.log('');
  } catch (err) {
    exitWithError(err, 'Failed to get organization');
  }
}

export async function orgInviteCommand(
  identifier: string,
  email: string,
  options: { role?: string },
): Promise<void> {
  const { client } = requireLogin();
  const role = options.role ?? 'editor';

  try {
    if (!['editor', 'viewer'].includes(role)) {
      throw new Error(`Invalid role "${role}". Use: editor, viewer`);
    }

    const orgId = await resolveOrgId(client, identifier);
    await client.inviteOrgMember(orgId, email, role);

    console.log(fmt.ok(`Invited ${email} as ${role}`));
  } catch (err) {
    exitWithError(err, 'Failed to invite member');
  }
}

export async function orgRemoveCommand(identifier: string, userIdentifier: string): Promise<void> {
  const { client } = requireLogin();

  try {
    const orgId = await resolveOrgId(client, identifier);
    const userId = await resolveUserId(client, orgId, userIdentifier, identifier);
    await client.removeOrgMember(orgId, userId);

    console.log(fmt.ok('Member removed'));
  } catch (err) {
    exitWithError(err, 'Failed to remove member');
  }
}
