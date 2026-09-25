/**
 * Flow Weaver Export Targets
 *
 * The base class every export target extends, the registry that holds
 * them, and the discovery of targets from installed marketplace packs.
 *
 * @module deployment
 */

// Export Targets
export {
  type ExportTarget,
  type ExportOptions,
  type ExportArtifacts,
  type GeneratedFile,
  type DeployInstructions,
  type DeploySchema,
  type DeploySchemaField,
  type CompiledWorkflow,
  type MultiWorkflowArtifacts,
  type NodeTypeInfo,
  type NodeTypeExportOptions,
  type NodeTypeArtifacts,
  type BundleWorkflow,
  type BundleNodeType,
  type BundleArtifacts,
  BaseExportTarget,
  ExportTargetRegistry,
} from './targets/base.js';

import * as path from 'path';
import { pathToFileURL } from 'url';
import { ExportTargetRegistry } from './targets/base.js';

/**
 * Create an export target registry via marketplace discovery.
 *
 * Scans `node_modules/` for installed packs -- any package with a
 * `flowweaver.manifest.json` -- that declare `exportTargets` in it.
 * Each target class is eagerly imported (to resolve the async import) but
 * lazily instantiated. The constructor only runs when `registry.get()` is called.
 *
 * A target whose module does not export the declared class is skipped with
 * a warning naming the pack and file, so one broken pack does not take the
 * others down.
 *
 * @param projectDir project root to scan for installed packs.
 *   When omitted, returns an empty registry (useful for tests).
 */
export async function createTargetRegistry(projectDir?: string): Promise<ExportTargetRegistry> {
  const registry = new ExportTargetRegistry();

  if (projectDir) {
    const { listInstalledPackages } = await import('../marketplace/registry.js');
    const packages = await listInstalledPackages(projectDir);
    for (const pkg of packages) {
      for (const def of pkg.manifest.exportTargets ?? []) {
        const filePath = path.join(pkg.path, def.file);
        // Dynamic import is async, so we resolve the module here
        // but defer instantiation to the lazy factory
        const mod = await import(pathToFileURL(filePath).href);
        const TargetClass = def.exportName ? mod[def.exportName] : mod.default;
        if (typeof TargetClass !== 'function') {
          const what = def.exportName ? `export "${def.exportName}"` : 'a default export';
          console.warn(`Export target "${def.name}" of pack ${pkg.name} skipped: ${filePath} has no ${what} that is a class or function`);
          continue;
        }
        registry.register(def.name, () => new TargetClass());
      }
    }
  }

  return registry;
}
