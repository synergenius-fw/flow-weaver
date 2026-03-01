import { describe, it, expect } from 'vitest';
import { VALID_NODE_ICONS, NODE_ICON_PATHS } from '../../src/diagram/theme';

describe('Icon Set', () => {
  it('VALID_NODE_ICONS matches NODE_ICON_PATHS keys', () => {
    expect([...VALID_NODE_ICONS].sort()).toEqual(Object.keys(NODE_ICON_PATHS).sort());
  });

  it('has at least 90 icons', () => {
    expect(VALID_NODE_ICONS.length).toBeGreaterThanOrEqual(90);
  });

  it('includes all original icons', () => {
    const original = [
      'startNode', 'exitNode', 'code', 'flow', 'psychology', 'smartToy',
      'autoAwesome', 'modelTraining', 'science', 'biotech', 'database',
      'dataObject', 'tableChart', 'token', 'storage', 'memory', 'api',
      'webhook', 'cloudSync', 'cloudUpload', 'cloudDownload', 'dns',
      'router', 'http', 'link', 'key', 'shield', 'vpnKey', 'verified',
      'security', 'policy', 'adminPanelSettings', 'altRoute', 'callSplit',
      'callMerge', 'rule', 'filterAlt', 'repeat', 'sort', 'bolt', 'build',
      'rocketLaunch', 'send', 'sync', 'refresh', 'notifications', 'email',
      'campaign', 'event', 'schedule', 'timer', 'terminal', 'settings',
      'tune', 'search', 'save', 'upload', 'download', 'edit', 'delete',
      'checkCircle', 'error', 'warning', 'info', 'help', 'visibility',
      'folder', 'description', 'attachFile',
    ];
    for (const icon of original) {
      expect(VALID_NODE_ICONS).toContain(icon);
    }
  });

  it('includes newly added icons', () => {
    const added = [
      'person', 'people', 'group', 'personAdd', 'personOff',
      'block', 'playArrow', 'pause', 'stop', 'restart', 'contentCopy', 'deleteForever',
      'spellcheck', 'assessment', 'summarize', 'textSnippet', 'inventory', 'receipt',
      'monitoring', 'healthAndSafety', 'task', 'pendingActions', 'notificationsActive',
      'backup', 'cloudDone', 'lock', 'lockOpen',
    ];
    for (const icon of added) {
      expect(VALID_NODE_ICONS, `Missing icon: ${icon}`).toContain(icon);
    }
  });

  it('all icon paths are non-empty strings', () => {
    for (const [name, path] of Object.entries(NODE_ICON_PATHS)) {
      expect(typeof path, `Icon ${name} should be a string`).toBe('string');
      expect(path.length, `Icon ${name} should have a non-empty path`).toBeGreaterThan(10);
    }
  });
});
