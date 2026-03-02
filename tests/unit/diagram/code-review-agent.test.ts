import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { sourceToSVG } from '../../../src/diagram/index';

const examplePath = resolve(__dirname, '../../../docs/examples/code-review-agent.ts');
const source = readFileSync(examplePath, 'utf-8');

describe('Code Review Agent example diagram', () => {
  it('generates SVG without warnings', () => {
    const svg = sourceToSVG(source, { theme: 'dark', showPortLabels: true });
    expect(svg).toContain('<svg');
  });

  it('renders all expected nodes', () => {
    const svg = sourceToSVG(source, { theme: 'dark', showPortLabels: true });
    for (const node of ['Start', 'analyze', 'classify', 'route', 'approve', 'request', 'Exit']) {
      expect(svg).toContain(`data-node-id="${node}"`);
    }
  });

  it('renders data connections between nodes', () => {
    const svg = sourceToSVG(source, { theme: 'dark', showPortLabels: true });
    // PR data flows from Start to analyze
    expect(svg).toContain('data-port-id="analyze.pr:input"');
    // Context flows through the pipeline
    expect(svg).toContain('data-port-id="analyze.context:output"');
    expect(svg).toContain('data-port-id="classify.context:input"');
    expect(svg).toContain('data-port-id="classify.context:output"');
    expect(svg).toContain('data-port-id="route.context:input"');
    expect(svg).toContain('data-port-id="route.context:output"');
    // Review results
    expect(svg).toContain('data-port-id="approve.review:output"');
    expect(svg).toContain('data-port-id="request.review:output"');
  });

  it('hides onFailure on expression nodes via [hidden]', () => {
    const svg = sourceToSVG(source, { theme: 'dark', showPortLabels: true });
    // Expression nodes should NOT have onFailure ports
    expect(svg).not.toContain('data-port-id="analyze.onFailure:output"');
    expect(svg).not.toContain('data-port-id="classify.onFailure:output"');
    expect(svg).not.toContain('data-port-id="approve.onFailure:output"');
    expect(svg).not.toContain('data-port-id="request.onFailure:output"');
    // Route IS a non-expression node — onFailure should be visible
    expect(svg).toContain('data-port-id="route.onFailure:output"');
  });
});
