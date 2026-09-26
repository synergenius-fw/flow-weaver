/**
 * The guide: searching the documentation and opening a topic, from the
 * search palette and from the navigator's Guide list.
 */
import { test, expect } from './console';

test('searching the guide finds a section and opens its topic there', async ({ page, fw }) => {
  await fw.open();
  await fw.navigator.getByRole('button', { name: 'Search' }).click();
  const search = page.getByRole('dialog', { name: 'Search' });
  await expect(search).toBeVisible();

  await search.getByPlaceholder(/Search the guide/).fill('validate the answer');
  const hit = search.getByRole('button', { name: /Validate the answer/ }).first();
  await expect(hit).toBeVisible();
  await hit.click();

  await expect(search).toHaveCount(0);
  await expect(fw.main.getByRole('heading', { level: 1, name: 'Durable Gates' })).toBeVisible();
  await expect(fw.main.getByRole('heading', { name: 'Validate the answer' })).toBeVisible();
  await expect(page).toHaveURL(/#doc\/durable-gates\//);
});

test('the Guide list filters topics by their text and opens one', async ({ page, fw }) => {
  await fw.open();
  await fw.navigator.getByRole('button', { name: 'Guide' }).click();
  await expect(fw.navigator.getByRole('heading', { name: 'Guide' })).toBeVisible();

  await fw.navigator.getByPlaceholder('filter').fill('breakpoint');
  const topic = fw.navigator.getByRole('button', { name: /\bDebugging$/ });
  await expect(topic).toBeVisible();
  await topic.click();

  // The page's own title, then the topic's first heading, which repeats it.
  await expect(fw.main.getByRole('heading', { level: 1, name: 'Flow Weaver Debugging' }).first()).toBeVisible();
  await expect(fw.main.getByRole('heading', { name: 'Step-Through Debugging' })).toBeVisible();
  await expect(page).toHaveTitle('Flow Weaver Debugging (Flow Weaver)');
  // The topic's sections are listed beside it.
  await expect(fw.inspector.getByText('Step-Through Debugging').first()).toBeVisible();
});
