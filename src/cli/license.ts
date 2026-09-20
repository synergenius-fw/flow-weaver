/**
 * Offline license gate for an EXPORTED, LICENSABLE flow-weaver CLI build.
 *
 * IMPORTANT: this gates the `flow-weaver` / `fw` CLI ONLY, and is OFF by
 * default. Flow Weaver is also a library whose compiler, API, and runtime
 * exports are consumed by other applications. None of those imports this
 * module, and the gate never activates for the normal published package, so
 * embedding consumers are unaffected. The gate only turns on for an artifact
 * WE deliberately export as licensable (the licensed-copy builder drops a
 * `license-mode` marker).
 *
 * The license is a detached Ed25519 signature over a canonical JSON claim,
 * verified against the Synergenius platform-root PUBLIC key pinned below. The
 * private half never ships; only Synergenius can mint a license. No network
 * call: the license file plus this pinned key verify entirely offline.
 *
 * License file (`license.synergenius.json`), base64url of:
 *   { "claim": <canonical-json-string>, "sig": <base64 ed25519 sig> }
 * where the claim is { product, customer, issuedAt, expiresAt }.
 */
import { verify as ed25519Verify } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Synergenius platform-root PUBLIC key (raw Ed25519, base64). Public by design. */
const PLATFORM_ROOT_PUBKEY_B64 = 'IhmJ/zN6r9Yru+ymtWfVPt8sMJir3/QVXUq6OL795w8=';

/** The product id this build expects its license to be scoped to. */
const PRODUCT = 'flow-weaver';

export interface LicenseClaim {
  readonly product: string;
  readonly customer: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export class LicenseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LicenseError';
  }
}

/**
 * Is this a LICENSED BUILD? OFF by default: the normal package (published to
 * our registry, used internally and embedded by other applications) is never
 * gated. The gate activates only for an exported licensable artifact, which the
 * licensed-copy builder marks with a `license-mode` file next to the bundle
 * (or an operator sets FW_LICENSE_MODE=1). Producer-controlled and opt-in.
 */
export function licenseModeEnabled(): boolean {
  if (process.env.FW_LICENSE_MODE === '1') return true;
  const here = dirname(fileURLToPath(import.meta.url));
  return existsSync(join(here, 'license-mode')) || existsSync(join(here, '..', 'license-mode'));
}

function licenseSearchPaths(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const paths: string[] = [];
  if (process.env.FW_LICENSE) paths.push(process.env.FW_LICENSE);
  paths.push(join(here, 'license.synergenius.json'));
  paths.push(join(here, '..', 'license.synergenius.json'));
  paths.push(join(homedir(), '.synergenius', 'flow-weaver.license'));
  paths.push(join(process.cwd(), 'license.synergenius.json'));
  return paths;
}

function readLicenseKey(): string | null {
  for (const p of licenseSearchPaths()) {
    if (existsSync(p)) {
      try {
        return readFileSync(p, 'utf8').trim();
      } catch {
        // unreadable, try the next candidate
      }
    }
  }
  return null;
}

/**
 * Decode + cryptographically verify a license key against the pinned root key.
 * Throws LicenseError on any failure. `now` injectable for tests.
 *
 * `rootPublicKeyB64` is a test seam: the pinned key's private half never
 * ships, so the success path can only be exercised by signing with an
 * ephemeral keypair and verifying against its public half. Production callers
 * never pass it; the default is the pinned Synergenius root key.
 */
export function verifyLicenseKey(
  licenseKey: string,
  now: Date = new Date(),
  rootPublicKeyB64: string = PLATFORM_ROOT_PUBKEY_B64,
): LicenseClaim {
  if (!licenseKey) throw new LicenseError('license is empty.');

  let envelope: { claim?: unknown; sig?: unknown };
  try {
    envelope = JSON.parse(Buffer.from(licenseKey, 'base64url').toString('utf8'));
  } catch {
    throw new LicenseError('license is not a valid base64url JSON envelope.');
  }
  if (typeof envelope.claim !== 'string' || typeof envelope.sig !== 'string') {
    throw new LicenseError('license envelope must carry { claim: string, sig: string }.');
  }

  const rawPub = Buffer.from(rootPublicKeyB64, 'base64');
  if (rawPub.length !== 32) throw new LicenseError('pinned platform-root key is malformed.');
  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
  const pubKey = {
    key: Buffer.concat([spkiPrefix, rawPub]),
    format: 'der' as const,
    type: 'spki' as const,
  };

  let ok = false;
  try {
    ok = ed25519Verify(
      null,
      Buffer.from(envelope.claim, 'utf8'),
      pubKey,
      Buffer.from(envelope.sig, 'base64'),
    );
  } catch {
    throw new LicenseError('license signature verification failed.');
  }
  if (!ok) throw new LicenseError('license signature does not match the Synergenius root key.');

  let claim: LicenseClaim;
  try {
    claim = JSON.parse(envelope.claim) as LicenseClaim;
  } catch {
    throw new LicenseError('signed license claim is not valid JSON.');
  }
  if (!claim.product || !claim.customer || !claim.issuedAt || !claim.expiresAt) {
    throw new LicenseError('license claim must carry product, customer, issuedAt, expiresAt.');
  }
  if (claim.product !== PRODUCT) {
    throw new LicenseError(`license is for "${claim.product}", not "${PRODUCT}".`);
  }
  const expires = new Date(claim.expiresAt);
  if (Number.isNaN(expires.getTime())) {
    throw new LicenseError('license expiresAt is not a valid date.');
  }
  if (expires.getTime() < now.getTime()) {
    throw new LicenseError(`license expired on ${claim.expiresAt}. Contact Synergenius to renew.`);
  }
  return claim;
}

/**
 * Boot gate. NO-OP unless this is a licensed build (see licenseModeEnabled):
 * the normal package returns null and runs ungated. In a licensed build it
 * finds + verifies the license or throws (fail closed). Returns the verified
 * claim (licensed build) or null (normal build).
 */
export function enforceLicense(
  now: Date = new Date(),
  rootPublicKeyB64: string = PLATFORM_ROOT_PUBKEY_B64,
): LicenseClaim | null {
  if (!licenseModeEnabled()) return null;
  const key = readLicenseKey();
  if (!key) {
    throw new LicenseError(
      'No flow-weaver license found. This is a licensed Synergenius build. Place the ' +
        'license.synergenius.json we issued you next to the flow-weaver binary, at ' +
        '<home>/.synergenius/flow-weaver.license, or set FW_LICENSE to its path. ' +
        'Contact Synergenius if you need a license.',
    );
  }
  return verifyLicenseKey(key, now, rootPublicKeyB64);
}
