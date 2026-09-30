/**
 * Contrast: every piece of text the console draws can be read against what it
 * sits on, in the light theme and in the dark one.
 *
 * The page is walked in the states a person spends time in (the front page, a
 * run waiting at a gate, finished, and one that took its failure path, the
 * debugger, a workflow with issues, a step's code, the Serve pane, the guide,
 * search, Endpoints and Agents), and each text is measured
 * against the backgrounds behind it with the WCAG 2 formula: 4.5:1 for text,
 * 3:1 for large text. Disabled controls, icons and text hidden until hover
 * are left out, as WCAG leaves them out.
 */
import type { Page } from '@playwright/test';
import { test, expect, openWorkflow, type ConsoleUnderTest } from './console';

interface Finding { state: string; text: string; ratio: number; needs: number; fg: string; bg: string; where: string }

/** The texts on the page that fall short, measured in the page itself. */
function lowContrast(page: Page, state: string): Promise<Finding[]> {
  return page.evaluate((state) => {
    type RGBA = [number, number, number, number];
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    // Let the canvas resolve every colour syntax the browser knows (rgb, color(srgb …), color-mix results).
    const parse = (css: string): RGBA => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top: RGBA, bottom: RGBA): RGBA => [
      top[0] * top[3] + bottom[0] * (1 - top[3]),
      top[1] * top[3] + bottom[1] * (1 - top[3]),
      top[2] * top[3] + bottom[2] * (1 - top[3]),
      1,
    ];
    const lum = ([r, g, b]: RGBA) => {
      const ch = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    const ratio = (a: RGBA, b: RGBA) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const hex = ([r, g, b]: RGBA) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
    const where = (el: Element) => {
      const parts: string[] = [];
      for (let e: Element | null = el; e && parts.length < 3 && e !== document.body; e = e.parentElement) {
        parts.unshift(e.tagName.toLowerCase() + [...e.classList].slice(0, 2).map((c) => `.${c}`).join(''));
      }
      return parts.join(' > ');
    };

    const findings: Finding[] = [];
    const seen = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim() ?? '';
      // Separators and arrows are decoration, not text to read.
      if (!text || /^[\s·•|/→←↑↓…—–:,.()+×-]+$/.test(text)) continue;
      const el = node.parentElement;
      if (!el) continue;
      const style = getComputedStyle(el);
      if (style.visibility !== 'visible' || style.fontFamily.includes('Material Symbols')) continue;
      if (el.closest('button:disabled, input:disabled, select:disabled, textarea:disabled, fieldset:disabled, [aria-disabled="true"], [aria-hidden="true"]')) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;

      // What is behind the text: the backgrounds of its ancestors, laid over one another.
      const chain: Element[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) chain.unshift(e);
      let bg: RGBA = [255, 255, 255, 1];
      let opacity = 1;
      for (const e of chain) {
        const s = getComputedStyle(e);
        if (s.display === 'none') { opacity = 0; break; }
        opacity *= Number(s.opacity);
        bg = over(parse(s.backgroundColor), bg);
      }
      // Hidden until hover, or faded out entirely.
      if (opacity <= 0.05) continue;
      const fgRaw = parse(style.color);
      const fg = over([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * opacity], bg);

      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const needs = large ? 3 : 4.5;
      const r = ratio(fg, bg);
      if (r >= needs) continue;
      const key = `${hex(fg)} ${hex(bg)} ${where(el)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ state, text: text.slice(0, 40), ratio: Math.round(r * 100) / 100, needs, fg: hex(fg), bg: hex(bg), where: where(el) });
    }
    return findings;
  }, state);
}

/** The states to measure, in the order a person might reach them. */
const STATES: [string, (fw: ConsoleUnderTest, page: Page) => Promise<void>][] = [
  ['the front page', async (fw) => { await fw.open(); }],
  ['a run waiting at a gate', async (fw) => {
    await openWorkflow(fw, 'durableApproval');
    const form = fw.inspector.getByRole('form', { name: 'New run' });
    await form.getByLabel('value').fill('3');
    await form.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(fw.main.getByRole('form', { name: 'Decide: approval' })).toBeVisible();
  }],
  ['a finished run', async (fw) => {
    await fw.main.getByRole('form', { name: 'Decide: approval' }).getByLabel('value').fill('20');
    await fw.main.getByRole('button', { name: 'Continue' }).click();
    await expect(fw.main.getByText(/^completed in /)).toBeVisible();
  }],
  ['a run that took the failure path', async (fw) => {
    await fw.inspector.getByRole('button', { name: 'New run' }).click();
    const form = fw.inspector.getByRole('form', { name: 'New run' });
    await form.getByLabel('value').fill('3');
    await form.getByRole('button', { name: 'Run', exact: true }).click();
    const gate = fw.main.getByRole('form', { name: 'Decide: approval' });
    await gate.getByRole('button', { name: 'Reject' }).click();
    await gate.getByLabel('Reason').fill('not this one');
    await gate.getByRole('button', { name: 'Reject' }).click();
    await expect(fw.main.getByText(/^completed in /)).toBeVisible();
  }],
  ['the debugger, paused', async (fw) => {
    await openWorkflow(fw, 'sequential');
    const form = fw.inspector.getByRole('form', { name: 'New run' });
    await form.getByRole('radio', { name: 'Step through' }).click();
    await form.getByLabel('value').fill('4');
    await form.getByRole('button', { name: 'Debug', exact: true }).click();
    await expect(fw.inspector.getByRole('toolbar', { name: 'Debugger' })).toBeVisible();
    await expect(fw.main.getByText('paused before Add One')).toBeVisible();
  }],
  ['a workflow with issues', async (fw) => {
    await openWorkflow(fw, 'unknownStep');
    await fw.inspector.getByRole('button', { name: /Issues/ }).click();
    await expect(fw.inspector.getByText(/missingType/).first()).toBeVisible();
  }],
  ["a step's code", async (fw) => {
    await openWorkflow(fw, 'sequential');
    await fw.main.getByText('Add One', { exact: true }).first().click();
    await expect(fw.inspector.getByRole('heading', { name: /^Code/ })).toBeVisible();
  }],
  ['the Serve pane', async (fw) => {
    await fw.inspector.getByRole('button', { name: 'Serve' }).click();
    await expect(fw.inspector.getByText(/Expose as endpoint|POST \//).first()).toBeVisible();
  }],
  ['the guide', async (fw) => {
    await fw.open('doc/durable-gates');
    await expect(fw.main.getByRole('heading', { level: 1, name: 'Durable Gates' })).toBeVisible();
  }],
  ['search', async (fw, page) => {
    await fw.navigator.getByRole('button', { name: 'Search' }).click();
    const search = page.getByRole('dialog', { name: 'Search' });
    await expect(search).toBeVisible();
    await search.getByPlaceholder(/Search the guide/).fill('gate');
    await expect(search.getByRole('button').first()).toBeVisible();
  }],
  ['Endpoints', async (fw, page) => {
    await page.keyboard.press('Escape');
    await fw.navigator.getByRole('button', { name: 'Endpoints' }).first().click();
    await expect(fw.main.getByRole('heading', { level: 1 }).first()).toBeVisible();
  }],
  ['Agents', async (fw) => {
    await fw.navigator.getByRole('button', { name: 'Agents' }).first().click();
    await expect(fw.main.getByRole('heading', { level: 1 }).first()).toBeVisible();
  }],
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`the ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('every text meets the WCAG AA contrast minimum', async ({ fw, page }) => {
      const findings: Finding[] = [];
      for (const [state, reach] of STATES) {
        await reach(fw, page);
        // Let transitions settle before measuring.
        await page.waitForTimeout(300);
        findings.push(...await lowContrast(page, state));
      }
      expect(findings, findings.map((f) => `${f.state}: "${f.text}" ${f.ratio}:1 (needs ${f.needs}) ${f.fg} on ${f.bg} at ${f.where}`).join('\n')).toEqual([]);
    });
  });
}
