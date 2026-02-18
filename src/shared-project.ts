import { Project } from 'ts-morph';

// Consolidated singleton ts-morph Project.
// Creating a Project is expensive (~2-3s), so we reuse one across all consumers.
let sharedProject: Project | null = null;

export function getSharedProject(): Project {
  if (!sharedProject) {
    sharedProject = new Project({
      skipFileDependencyResolution: true, // Parser handles imports manually — no need for ts-morph to resolve
      compilerOptions: {
        target: 99,
        experimentalDecorators: true,
        allowJs: true,
        types: [],          // Don't auto-load @types/* packages — saves Program creation time
        skipLibCheck: true,  // Skip diagnostic checking of .d.ts files
      },
    });
  }
  return sharedProject;
}

/**
 * Reset the shared project. Intended for test teardown or
 * extreme memory-pressure scenarios. After calling this,
 * the next getSharedProject() call will create a fresh instance.
 */
export function resetSharedProject(): void {
  sharedProject = null;
}
