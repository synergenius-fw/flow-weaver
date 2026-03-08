/**
 * Load workflow templates from installed marketplace packs.
 *
 * Separated from the main templates barrel so that Node.js-only imports
 * (marketplace/registry, init-personas, fs, path) are not pulled into
 * browser builds that only need the template definitions.
 */
import { registerWorkflowTemplates, type WorkflowTemplate } from './index.js';

/**
 * Load workflow templates from installed pack manifests.
 * Templates declared in `initContributions.templates` are dynamically imported
 * and appended to the available template list.
 *
 * @param projectDir - Project root to scan for installed packs
 */
export async function loadPackTemplates(projectDir: string): Promise<void> {
  try {
    const { listInstalledPackages } = await import('../../marketplace/registry.js');
    const { registerPackUseCase } = await import('../commands/init-personas.js');
    const packages = await listInstalledPackages(projectDir);

    const loaded: WorkflowTemplate[] = [];

    for (const pkg of packages) {
      const contributions = pkg.manifest.initContributions;
      if (!contributions?.templates) continue;

      // Register use case if declared
      if (contributions.useCase) {
        registerPackUseCase(contributions.useCase, contributions.templates);
      }

      // Pack templates must be exported from the pack's main entry point
      // or from a templates.js file alongside the manifest
      try {
        const templatesPath = await import('path').then((p) =>
          p.join(pkg.path, 'templates.js'),
        );
        const { existsSync } = await import('fs');
        if (!existsSync(templatesPath)) continue;

        const mod = await import(templatesPath);
        if (mod.workflowTemplates && Array.isArray(mod.workflowTemplates)) {
          for (const tmpl of mod.workflowTemplates) {
            if (contributions.templates.includes(tmpl.id)) {
              loaded.push(tmpl);
            }
          }
        }
      } catch {
        // Skip packs that fail to load templates
      }
    }

    if (loaded.length > 0) {
      registerWorkflowTemplates(loaded);
    }
  } catch {
    // Marketplace scanning not available (e.g., no node_modules)
  }
}
