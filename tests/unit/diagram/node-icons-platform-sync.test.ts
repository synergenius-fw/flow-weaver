/**
 * Tests that every icon in the extended catalog exists in NODE_ICON_PATHS, so
 * the diagram renderer can draw any icon a workflow names.
 */

import { describe, it, expect } from 'vitest';
import { NODE_ICON_PATHS, VALID_NODE_ICONS } from '../../../src/diagram/theme';

/**
 * The extended icon catalog. When an icon is added here it must also be added
 * to NODE_ICON_PATHS in theme.ts.
 */
const PLATFORM_CATALOG_ICONS = [
  'addAuthorization', 'adminPanel', 'ai', 'alarm', 'allInclusive', 'altRoute', 'analytics', 'api',
  'assessment', 'assignment', 'attachFile', 'autoAwesome', 'backup', 'barChart', 'biotech',
  'block', 'build', 'calendar', 'callMerge', 'callSplit', 'campaign', 'changeCircle',
  'chat', 'checklist', 'cloudDone', 'cloudDownload', 'cloudStorage', 'cloudSync',
  'cloudUpload', 'code', 'compareArrows', 'construction', 'contentCopy', 'database',
  'dataArray', 'dataObject', 'deleteForever', 'deviceHub', 'dns', 'email', 'engineering',
  'file', 'fileCopy', 'filePresent', 'filterAlt', 'folder', 'forum', 'group',
  'healthAndSafety', 'history', 'hourglassEmpty', 'hub', 'insights', 'integration',
  'inventory', 'key', 'leaderboard', 'lockClosed', 'lockOpened', 'loop', 'modelTraining',
  'monitoring', 'newFile', 'notifications', 'notificationsActive', 'outlinedSettings',
  'pause', 'pendingActions', 'people', 'person', 'personAdd', 'personOff', 'pieChart',
  'playArrow', 'policy', 'psychology', 'public', 'publish', 'receipt', 'repeat', 'restart',
  'rocketLaunch', 'router', 'rssFeed', 'rule', 'scheduled', 'schema', 'science',
  'security', 'send', 'shield', 'showChart', 'smartToy', 'sms', 'sort', 'source',
  'spellcheck', 'stop', 'summarize', 'swapHoriz', 'syncAlt', 'tableChart', 'task',
  'taskAlt', 'terminal', 'textSnippet', 'timer', 'token', 'trendingUp', 'update',
  'uploadFile', 'verified', 'vpnKey', 'watchLater', 'webhook',
];

describe('Platform icon sync', () => {
  for (const icon of PLATFORM_CATALOG_ICONS) {
    it(`platform icon "${icon}" should exist in NODE_ICON_PATHS`, () => {
      expect(NODE_ICON_PATHS).toHaveProperty(icon);
      expect(typeof NODE_ICON_PATHS[icon]).toBe('string');
      expect(NODE_ICON_PATHS[icon].length).toBeGreaterThan(10);
    });
  }

  it('VALID_NODE_ICONS should include all platform catalog icons', () => {
    const missing = PLATFORM_CATALOG_ICONS.filter(
      (icon) => !VALID_NODE_ICONS.includes(icon),
    );
    expect(missing).toEqual([]);
  });
});
