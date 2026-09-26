/**
 * Running workflows from the console: straight through, through an approval
 * gate answered either way, and a step at a time under the debugger.
 */
import type { Locator } from '@playwright/test';
import { test, expect, openWorkflow, type ConsoleUnderTest } from './console';

const runForm = (fw: ConsoleUnderTest): Locator => fw.inspector.getByRole('form', { name: 'New run' });

/** Fill the run form's `value` and press its Run (or Debug) button. */
async function start(fw: ConsoleUnderTest, value: number, button: 'Run' | 'Debug' = 'Run'): Promise<void> {
  const form = runForm(fw);
  await form.getByLabel('value').fill(String(value));
  await form.getByRole('button', { name: button, exact: true }).click();
  // The form gives way to the run.
  await expect(form).toHaveCount(0);
}

test('running the plain workflow shows it complete, with its result', async ({ fw }) => {
  await fw.open();
  await openWorkflow(fw, 'sequential');
  await start(fw, 4);

  await expect(fw.main.getByText(/^completed in /)).toBeVisible();
  // (4 + 1) * 2
  const result = fw.inspector.getByRole('region', { name: 'Result' });
  await expect(result).toContainText('"result"');
  await expect(result).toContainText('10');
  // Each step that ran is on the run's timeline.
  await expect(fw.inspector.getByText('2 of 2')).toBeVisible();

  // The run is in the workflow's history, and a new run can be started.
  await expect(fw.inspector.getByRole('heading', { name: /^Runs/ })).toBeVisible();
  await expect(fw.inspector.getByRole('button', { name: /completed/ })).toBeVisible();
  await fw.inspector.getByRole('button', { name: 'New run' }).click();
  await expect(runForm(fw)).toBeVisible();
});

test('the approval workflow waits at its gate, and answering it completes the run', async ({ fw }) => {
  await fw.open();
  await openWorkflow(fw, 'durableApproval');
  await start(fw, 3);

  // Said twice: in the header, and on the step that waits.
  await expect(fw.main.getByText('waiting at approval')).toHaveCount(2);
  const gate = fw.main.getByRole('form', { name: 'Decide: approval' });
  await expect(gate).toBeVisible();
  // What the gate was handed: the prepared value, 3 * 2.
  await expect(gate.getByText('6', { exact: true })).toBeVisible();
  // The answer is asked for under the words the author gave it.
  await expect(gate.getByText('Approved value')).toBeVisible();

  await gate.getByLabel('value').fill('20');
  await gate.getByRole('button', { name: 'Continue' }).click();

  await expect(gate).toHaveCount(0);
  await expect(fw.main.getByText(/^completed in /)).toBeVisible();
  // finish adds one to the approved value.
  const result = fw.inspector.getByRole('region', { name: 'Result' });
  await expect(result).toContainText('"result"');
  await expect(result).toContainText('21');
});

test('rejecting at the gate completes the run without the steps after it', async ({ fw }) => {
  await fw.open();
  await openWorkflow(fw, 'durableApproval');
  await start(fw, 3);

  const gate = fw.main.getByRole('form', { name: 'Decide: approval' });
  await expect(gate).toBeVisible();
  await gate.getByRole('button', { name: 'Reject' }).click();
  await gate.getByLabel('Reason').fill('not this one');
  await gate.getByRole('button', { name: 'Reject' }).click();

  await expect(gate).toHaveCount(0);
  await expect(fw.main.getByText(/^completed in /)).toBeVisible();
  // The failure arm of the gate is not wired, so the run ends with no result value.
  const result = fw.inspector.getByRole('region', { name: 'Result' });
  await expect(result).toBeVisible();
  await expect(result).not.toContainText('"result"');
});

test('a debug session pauses before the first step, steps, and continues to the end', async ({ fw }) => {
  await fw.open();
  await openWorkflow(fw, 'sequential');
  await runForm(fw).getByRole('radio', { name: 'Step through' }).click();
  await expect(runForm(fw).getByRole('radio', { name: 'Step through' })).toBeChecked();
  await expect(runForm(fw).getByRole('radio', { name: 'Pause before the first step' })).toBeChecked();
  await start(fw, 4, 'Debug');

  const debugger_ = fw.inspector.getByRole('toolbar', { name: 'Debugger' });
  await expect(fw.main.getByText('paused before Add One')).toBeVisible();

  await debugger_.getByRole('button', { name: /^Step/ }).click();
  await expect(fw.main.getByText('paused after Add One')).toBeVisible();
  await debugger_.getByRole('button', { name: /^Step/ }).click();
  await expect(fw.main.getByText('paused before Double')).toBeVisible();

  await debugger_.getByRole('button', { name: /^Continue/ }).click();
  await expect(debugger_).toHaveCount(0);
  await expect(fw.main.getByText(/^completed in /)).toBeVisible();
  const result = fw.inspector.getByRole('region', { name: 'Result' });
  await expect(result).toContainText('10');
});
