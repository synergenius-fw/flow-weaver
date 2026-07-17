/**
 * Shared JSDoc emission for pack-contributed deploy namespaces.
 *
 * The parser delegates tag PARSING to pack tag handlers (TagHandlerRegistry).
 * This is the symmetric reverse: during JSDoc regeneration, each namespace in
 * `options.deploy` is handed to its registered serializer, which emits the
 * annotation lines that reproduce it. Without this, tags a pack learned to
 * parse after core froze its hardcoded emitters were silently dropped on
 * regeneration (e.g. @matrix, @artifact, @service for CI/CD).
 */

import { tagHandlerRegistry } from './tag-registry.js';

/**
 * Serialize every pack deploy namespace back to JSDoc comment lines.
 *
 * @param deploy - `options.deploy`, mapping namespace → accumulated tag data.
 * @returns full comment lines (each already prefixed with ` * `), in a stable
 *   namespace order so regeneration is deterministic.
 */
export function serializePackDeployAnnotations(
  deploy: Record<string, Record<string, unknown>> | undefined,
): string[] {
  if (!deploy) return [];
  const out: string[] = [];
  // Stable order: sort namespaces so output is deterministic regardless of
  // parse/insertion order.
  for (const namespace of Object.keys(deploy).sort()) {
    const data = deploy[namespace];
    if (!data || typeof data !== 'object') continue;
    out.push(...tagHandlerRegistry.serialize(namespace, data));
  }
  return out;
}
