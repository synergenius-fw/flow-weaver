/**
 * Loading the parser extensions an installed marketplace pack ships.
 *
 * Decides what a pack contributes to parsing and validation: its tag handlers
 * and their serializers go into the given tag registry, its validation rule
 * sets into the global validation rule registry. A module that fails to load
 * is skipped, since the pack may not be built.
 */
import type { TagHandlerRegistry } from './tag-registry';

/** Discover the packs installed under `projectDir` and register their tag handlers and validation rule sets. */
export async function registerPackHandlers(
  tagRegistry: TagHandlerRegistry,
  projectDir: string,
): Promise<void> {
  const { discoverTagHandlers, discoverValidationRuleSets } = await import('../marketplace/registry.js');
  const { pathToFileURL } = await import('node:url');

  // Load tag handlers
  const handlers = await discoverTagHandlers(projectDir);
  for (const discovered of handlers) {
    // Handler may already be registered (e.g. by side-effect imports), but we
    // still need to load the module to pick up the serializer, so don't skip
    // the whole entry. Guard the handler registration itself instead.
    const handlerAlreadyRegistered = discovered.tags.every((t) => tagRegistry.has(t));

    try {
      const mod = await import(pathToFileURL(discovered.absoluteFile).href);
      if (!handlerAlreadyRegistered) {
        const handlerFn = discovered.exportName ? mod[discovered.exportName] : mod.default;
        if (typeof handlerFn === 'function') {
          tagRegistry.register(
            discovered.tags,
            discovered.namespace,
            discovered.scope,
            handlerFn,
          );
        }
      }
      // Symmetric emission: register the namespace's serializer (inverse of
      // the handler) so JSDoc regeneration re-emits every tag the pack parses.
      if (discovered.serializerExport) {
        const serializerFn = mod[discovered.serializerExport];
        if (typeof serializerFn === 'function') {
          tagRegistry.registerSerializer(discovered.namespace, serializerFn);
        }
      }
    } catch {
      // Skip handlers that fail to load (pack may not be built)
    }
  }

  // Load validation rule sets
  const { validationRuleRegistry } = await import('../api/validation-registry.js');
  const ruleSets = await discoverValidationRuleSets(projectDir);
  for (const ruleSet of ruleSets) {
    try {
      const mod = await import(pathToFileURL(ruleSet.absoluteFile).href);
      const detectFn = mod[ruleSet.detectExport ?? 'detect'];
      const getRulesFn = mod[ruleSet.rulesExport ?? 'getRules'];
      if (typeof detectFn === 'function' && typeof getRulesFn === 'function') {
        validationRuleRegistry.register({
          name: ruleSet.name,
          namespace: ruleSet.namespace,
          detect: detectFn,
          getRules: getRulesFn,
        });
      }
    } catch {
      // Skip rule sets that fail to load
    }
  }
}
