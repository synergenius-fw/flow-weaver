/**
 * Opening a project and a workflow: what the navigator lists, the verdict
 * each entry gets once it is checked, and what a workflow shows when opened,
 * including one with issues and one that does not parse.
 */
import { test, expect, workflowEntry, openWorkflow } from './console';

test('the project opens and the navigator lists its workflows, each with a verdict', async ({ fw }) => {
  await fw.open();
  // With nothing asked for, the console opens on the project's front page.
  await expect(fw.navigator.getByRole('button', { name: /^Project$/ })).toBeVisible();
  for (const name of ['sequential', 'durableApproval', 'unknownStep', 'halfWritten']) {
    await expect(workflowEntry(fw, name)).toBeVisible();
  }
  // The verdicts arrive after the listing, from the full parse.
  await expect(workflowEntry(fw, 'sequential').getByRole('img', { name: 'valid' })).toBeVisible();
  await expect(workflowEntry(fw, 'durableApproval').getByRole('img', { name: 'valid' })).toBeVisible();
  await expect(workflowEntry(fw, 'unknownStep').getByRole('img', { name: /^\d+ errors?/ })).toBeVisible();
  await expect(workflowEntry(fw, 'halfWritten').getByRole('img', { name: '1 error' })).toBeVisible();

  // The filter narrows the list to what matches.
  await fw.navigator.getByPlaceholder('filter').fill('approv');
  await expect(workflowEntry(fw, 'durableApproval')).toBeVisible();
  await expect(workflowEntry(fw, 'sequential')).toHaveCount(0);
});

test('opening a workflow shows its steps, its parameters and that it is valid', async ({ fw }) => {
  await fw.open();
  await openWorkflow(fw, 'durableApproval');

  await expect(fw.main.getByText('flows/approval.ts')).toBeVisible();
  await expect(fw.main.getByText('3 steps, 1 gate')).toBeVisible();
  await expect(fw.main.getByText('valid', { exact: true })).toBeVisible();
  // The process, one row per step, between Start and Exit.
  for (const step of ['Start', 'prepared', 'approval', 'finished', 'Exit']) {
    await expect(fw.main.getByText(step, { exact: true }).first()).toBeVisible();
  }

  // The run form asks for the workflow's one parameter.
  const form = fw.inspector.getByRole('form', { name: 'New run' });
  await expect(form.getByLabel('value')).toBeVisible();

  // Start is where the parameters are described: their type and where each goes.
  await fw.main.getByText('Start', { exact: true }).click();
  await expect(fw.inspector.getByRole('heading', { name: 'Parameters' })).toBeVisible();
  await expect(fw.inspector.getByText('number', { exact: true })).toBeVisible();
});

test('a workflow with an issue lists it, with its code', async ({ fw }) => {
  await fw.open();
  await openWorkflow(fw, 'unknownStep');

  await expect(fw.main.getByText(/^\d+ errors?$/)).toBeVisible();
  // A workflow with errors cannot be run from the form.
  await expect(fw.inspector.getByRole('form', { name: 'New run' }).getByRole('button', { name: 'Run', exact: true })).toBeDisabled();

  await fw.inspector.getByRole('button', { name: /Issues/ }).click();
  await expect(fw.inspector.getByText(/missingType/).first()).toBeVisible();
  await expect(fw.inspector.getByRole('code').first()).toBeVisible();
});

test('a workflow file that does not parse shows the parser\'s message, not a blank page', async ({ fw }) => {
  await fw.open();
  await workflowEntry(fw, 'halfWritten').click();

  await expect(fw.main.getByRole('heading', { level: 1, name: 'halfWritten' })).toBeVisible();
  await expect(fw.main.getByText('does not parse', { exact: true })).toBeVisible();
  await expect(fw.main.getByRole('heading', { name: /Does not parse/ })).toBeVisible();
  await expect(fw.main.getByText('@path: node "nowhere" not found. Declare it with @node before using @path.')).toBeVisible();
  // Nothing to run: the inspector has no run form for it.
  await expect(fw.inspector.getByRole('form', { name: 'New run' })).toHaveCount(0);

  // And the console is still usable: another workflow opens from there.
  await openWorkflow(fw, 'sequential');
  await expect(fw.inspector.getByRole('form', { name: 'New run' })).toBeVisible();
});

test('a workflow opened while the console is still loading stays open', async ({ fw, page }) => {
  // Hold the guide back, so the console is still loading when the navigator
  // already lists the workflows, and hold the workflow a person then opens,
  // so the console finishes loading while that workflow is on its way.
  let releaseGuide!: () => void;
  const guideHeld = new Promise<void>((resolve) => { releaseGuide = resolve; });
  await page.route('**/api/docs/guide', async (route) => { await guideHeld; await route.continue(); });
  let releaseWorkflow!: () => void;
  const workflowHeld = new Promise<void>((resolve) => { releaseWorkflow = resolve; });
  await page.route(/\/api\/workflow\?/, async (route) => { await workflowHeld; await route.continue(); });

  await page.goto(fw.url);
  await workflowEntry(fw, 'durableApproval').click();

  // Loading finishes first; the front page it would open must not replace
  // the workflow the person chose.
  const guide = page.waitForResponse('**/api/docs/guide');
  releaseGuide();
  await guide;
  releaseWorkflow();

  await expect(fw.main.getByRole('heading', { level: 1, name: 'durableApproval' })).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toContain('durableApproval');
});
