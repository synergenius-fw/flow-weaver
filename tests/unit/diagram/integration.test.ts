import { describe, it, expect } from 'vitest';
import { workflowToSVG, sourceToSVG } from '../../../src/diagram/index';
import { createParallelWorkflow, createSimpleWorkflow } from '../../helpers/test-fixtures';

describe('workflowToSVG', () => {
  it('renders a parallel workflow with all expected nodes', () => {
    const ast = createParallelWorkflow();
    const svg = workflowToSVG(ast);

    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('Start');
    expect(svg).toContain('Exit');
    expect(svg).toContain('node1');
    expect(svg).toContain('node2');
    expect(svg).toContain('node3');
  });

  it('renders a simple workflow', () => {
    const ast = createSimpleWorkflow();
    const svg = workflowToSVG(ast, { theme: 'light' });

    expect(svg).toContain('<svg');
    expect(svg).toContain('node1');
  });

  it('respects showPortLabels option', () => {
    const ast = createSimpleWorkflow();
    const withLabels = workflowToSVG(ast, { showPortLabels: true });
    const withoutLabels = workflowToSVG(ast, { showPortLabels: false });

    expect(withLabels).toContain('class="port-label"');
    expect(withoutLabels).not.toContain('class="port-label"');
  });
});

describe('sourceToSVG', () => {
  it('parses inline source and produces valid SVG', () => {
    const code = `
/**
 * @flowWeaver nodeType
 */
function greeter(execute: boolean, name: string): { onSuccess: boolean; onFailure: boolean; greeting: string } {
  if (!execute) return { onSuccess: false, onFailure: false, greeting: '' };
  return { onSuccess: true, onFailure: false, greeting: 'Hello ' + name };
}

/**
 * @flowWeaver workflow
 * @node greet greeter
 * @connect Start.execute -> greet.execute
 * @connect Start.name -> greet.name
 * @connect greet.onSuccess -> Exit.onSuccess
 * @connect greet.greeting -> Exit.greeting
 */
export function greetingPipeline(
  execute: boolean,
  name: string,
): { onSuccess: boolean; onFailure: boolean; greeting: string } {
  throw new Error('Not implemented');
}
`;
    const svg = sourceToSVG(code, { theme: 'dark' });

    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('Start');
    expect(svg).toContain('Exit');
    expect(svg).toContain('greet');
  });

  it('throws when no workflows found', () => {
    const code = `const x = 42;`;
    expect(() => sourceToSVG(code)).toThrow('No workflows found');
  });

  it('selects workflow by name with workflowName option', () => {
    const code = `
/**
 * @flowWeaver nodeType
 */
function processor(execute: boolean, input: number): { onSuccess: boolean; onFailure: boolean; output: number } {
  if (!execute) return { onSuccess: false, onFailure: false, output: 0 };
  return { onSuccess: true, onFailure: false, output: input };
}

/**
 * @flowWeaver workflow
 * @node n1 processor
 * @connect Start.execute -> n1.execute
 * @connect Start.x -> n1.input
 * @connect n1.onSuccess -> Exit.onSuccess
 * @connect n1.output -> Exit.result
 */
export function alpha(
  execute: boolean,
  x: number,
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('Not implemented');
}

/**
 * @flowWeaver workflow
 * @node n2 processor
 * @connect Start.execute -> n2.execute
 * @connect Start.y -> n2.input
 * @connect n2.onSuccess -> Exit.onSuccess
 * @connect n2.output -> Exit.value
 */
export function beta(
  execute: boolean,
  y: number,
): { onSuccess: boolean; onFailure: boolean; value: number } {
  throw new Error('Not implemented');
}
`;
    const svgAlpha = sourceToSVG(code, { workflowName: 'alpha' });
    expect(svgAlpha).toContain('n1'); // alpha uses node n1
    expect(svgAlpha).not.toContain('>n2<'); // should not contain beta's node

    const svgBeta = sourceToSVG(code, { workflowName: 'beta' });
    expect(svgBeta).toContain('n2'); // beta uses node n2
    expect(svgBeta).not.toContain('>n1<'); // should not contain alpha's node
  });

  it('throws for non-existent workflow name', () => {
    const code = `
/**
 * @flowWeaver nodeType
 */
function processor(execute: boolean, input: number): { onSuccess: boolean; onFailure: boolean; output: number } {
  if (!execute) return { onSuccess: false, onFailure: false, output: 0 };
  return { onSuccess: true, onFailure: false, output: input };
}

/**
 * @flowWeaver workflow
 * @node n1 processor
 * @connect Start.execute -> n1.execute
 * @connect Start.x -> n1.input
 * @connect n1.onSuccess -> Exit.onSuccess
 * @connect n1.output -> Exit.result
 */
export function myWorkflow(
  execute: boolean,
  x: number,
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('Not implemented');
}
`;
    expect(() => sourceToSVG(code, { workflowName: 'nonexistent' })).toThrow('not found');
  });

  it('renders expression nodes correctly', () => {
    const code = `
/**
 * @flowWeaver nodeType
 * @expression
 */
function doubler(x: number): { result: number } {
  return { result: x * 2 };
}

/**
 * @flowWeaver workflow
 * @node calc doubler
 * @connect Start.execute -> Exit.onSuccess
 * @connect Start.value -> calc.x
 * @connect calc.result -> Exit.output
 */
export function mathPipeline(
  execute: boolean,
  value: number,
): { onSuccess: boolean; onFailure: boolean; output: number } {
  throw new Error('Not implemented');
}
`;
    const svg = sourceToSVG(code, { theme: 'dark' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('calc');
  });
});
