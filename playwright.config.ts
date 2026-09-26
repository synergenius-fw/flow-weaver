import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests of the console's client (`e2e/`), in Chromium against a
 * real console. They need a build first: each test starts the built console
 * (`dist/console`) over a project of its own, so `npm run build` (or at least
 * `tsc`, `build:lib` and `build:console`) must have run.
 *
 * No retries: a flaky test here is a bug in the test or in the console, and a
 * retry would hide it.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Each test starts a console that parses its project with the TypeScript
  // compiler. Two at a time is quicker than one; four on an 8-core laptop was
  // slower than one, every console starved of CPU.
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
});
