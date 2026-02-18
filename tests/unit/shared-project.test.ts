import { describe, it, expect, afterEach } from 'vitest';
import { getSharedProject, resetSharedProject } from '../../src/shared-project';

describe('shared-project', () => {
  afterEach(() => {
    // Reset after tests so other test suites aren't affected
    resetSharedProject();
  });

  it('should return the same Project instance on repeated calls', () => {
    const project1 = getSharedProject();
    const project2 = getSharedProject();
    expect(project1).toBe(project2);
  });

  it('should return a fresh instance after resetSharedProject()', () => {
    const project1 = getSharedProject();
    resetSharedProject();
    const project2 = getSharedProject();
    expect(project1).not.toBe(project2);
  });

  it('should create a valid ts-morph Project', () => {
    const project = getSharedProject();
    // Verify it's a real Project by checking it can create source files
    const sf = project.createSourceFile('__test-shared-project__.ts', 'const x = 1;', {
      overwrite: true,
    });
    expect(sf).toBeDefined();
    expect(sf.getFullText()).toContain('const x = 1');
    project.removeSourceFile(sf);
  });
});
