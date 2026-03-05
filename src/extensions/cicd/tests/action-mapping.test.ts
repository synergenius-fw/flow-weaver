/**
 * Tests that NODE_ACTION_MAP resolves correctly for both kebab-case
 * and camelCase node type names.
 *
 * CI/CD templates use camelCase function names (npmInstall, setupNode),
 * but NODE_ACTION_MAP keys are kebab-case (npm-install, setup-node).
 * The resolveActionMapping method normalizes camelCase to kebab-case
 * before lookup.
 */

import { describe, it, expect } from 'vitest';
import { NODE_ACTION_MAP } from '../base-target';

/** Simulate the normalization done by resolveActionMapping */
function lookupAction(nodeType: string) {
  return NODE_ACTION_MAP[nodeType]
    || NODE_ACTION_MAP[nodeType.replace(/([A-Z])/g, '-$1').toLowerCase()];
}

describe('NODE_ACTION_MAP resolution', () => {
  const mappings: [string, string][] = [
    ['checkout', 'checkout'],
    ['setupNode', 'setup-node'],
    ['npmInstall', 'npm-install'],
    ['npmTest', 'npm-test'],
    ['npmBuild', 'npm-build'],
    ['dockerBuild', 'docker-build'],
    ['dockerPush', 'docker-push'],
    ['dockerLogin', 'docker-login'],
    ['shellCommand', 'shell-command'],
    ['deploySsh', 'deploy-ssh'],
    ['deployS3', 'deploy-s3'],
  ];

  for (const [camelCase, kebabCase] of mappings) {
    it(`should resolve ${camelCase} (camelCase) to the same mapping as ${kebabCase} (kebab-case)`, () => {
      const fromCamel = lookupAction(camelCase);
      const fromKebab = lookupAction(kebabCase);
      expect(fromCamel).toBeDefined();
      expect(fromKebab).toBeDefined();
      expect(fromCamel).toBe(fromKebab);
    });
  }

  it('should resolve checkout directly (no normalization needed)', () => {
    expect(NODE_ACTION_MAP['checkout']).toBeDefined();
    expect(NODE_ACTION_MAP['checkout'].label).toBe('Checkout code');
  });

  it('should have GitHub Actions for checkout and setup-node', () => {
    expect(lookupAction('checkout')?.githubAction).toBe('actions/checkout@v4');
    expect(lookupAction('setupNode')?.githubAction).toBe('actions/setup-node@v4');
  });

  it('should have GitLab CI scripts for npm nodes', () => {
    expect(lookupAction('npmInstall')?.gitlabScript).toEqual(['npm ci']);
    expect(lookupAction('npmTest')?.gitlabScript).toEqual(['npm test']);
    expect(lookupAction('npmBuild')?.gitlabScript).toEqual(['npm run build']);
  });

  it('should return undefined for unknown node types', () => {
    expect(lookupAction('customProcessor')).toBeUndefined();
    expect(lookupAction('unknownNode')).toBeUndefined();
  });
});
