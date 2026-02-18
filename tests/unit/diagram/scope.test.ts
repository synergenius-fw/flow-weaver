import { describe, it, expect } from 'vitest';
import { sourceToSVG } from '../../../src/diagram/index';
import { buildDiagramGraph } from '../../../src/diagram/geometry';
import { parser } from '../../../src/parser';
import * as fs from 'fs';
import * as path from 'path';

function parseWorkflow(filePath: string) {
  const code = fs.readFileSync(filePath, 'utf-8');
  const result = parser.parseFromString(code);
  return result.workflows[0];
}

describe('scoped diagram — scope ports', () => {
  const forEachFile = path.resolve(__dirname, '../../../fixtures/advanced/example-foreach.ts');

  it('creates scope ports from scope-qualified connections', () => {
    const ast = parseWorkflow(forEachFile);
    const graph = buildDiagramGraph(ast);
    const forEach = graph.nodes.find(n => n.id === 'forEach')!;
    expect(forEach.scopePorts).toBeDefined();

    // item is an implicit scope output (forEach.item:iteration → processItem.item)
    const scopeOutputNames = forEach.scopePorts!.outputs.map(p => p.name);
    expect(scopeOutputNames).toContain('item');
    expect(scopeOutputNames).toContain('start');

    // result is an implicit scope input (double.doubled → forEach.result:iteration)
    const scopeInputNames = forEach.scopePorts!.inputs.map(p => p.name);
    expect(scopeInputNames).toContain('result');
    expect(scopeInputNames).toContain('success');
    expect(scopeInputNames).toContain('failure');
  });

  it('orders mandatory scope ports before data ports', () => {
    const ast = parseWorkflow(forEachFile);
    const graph = buildDiagramGraph(ast);
    const forEach = graph.nodes.find(n => n.id === 'forEach')!;
    const scopeOutputNames = forEach.scopePorts!.outputs.map(p => p.name);
    const scopeInputNames = forEach.scopePorts!.inputs.map(p => p.name);
    // start should come before item in outputs
    expect(scopeOutputNames.indexOf('start')).toBeLessThan(scopeOutputNames.indexOf('item'));
    // success should come before result in inputs
    expect(scopeInputNames.indexOf('success')).toBeLessThan(scopeInputNames.indexOf('result'));
  });

  it('removes scoped ports from external port list', () => {
    const ast = parseWorkflow(forEachFile);
    const graph = buildDiagramGraph(ast);
    const forEach = graph.nodes.find(n => n.id === 'forEach')!;
    // item/result moved to scope, should not be on external ports
    const externalOutputNames = forEach.outputs.map(p => p.name);
    expect(externalOutputNames).not.toContain('item');
    const externalInputNames = forEach.inputs.map(p => p.name);
    expect(externalInputNames).not.toContain('result');
    // onSuccess/onFailure stay external
    expect(externalOutputNames).toContain('onSuccess');
    expect(externalOutputNames).toContain('onFailure');
  });

  it('builds scope connections including child→child without scope qualifiers', () => {
    const ast = parseWorkflow(forEachFile);
    const graph = buildDiagramGraph(ast);
    const forEach = graph.nodes.find(n => n.id === 'forEach')!;
    const scopeConns = forEach.scopeConnections!;

    // processItem.processed → double.value (child→child, no scope qualifier)
    expect(scopeConns.some(c => c.fromNode === 'processItem' && c.fromPort === 'processed' && c.toNode === 'double' && c.toPort === 'value')).toBe(true);
  });

  it('auto-connects mandatory STEP scope ports to children', () => {
    const ast = parseWorkflow(forEachFile);
    const graph = buildDiagramGraph(ast);
    const forEach = graph.nodes.find(n => n.id === 'forEach')!;
    const scopeConns = forEach.scopeConnections!;

    // scope.start → first child (processItem).execute
    expect(scopeConns.some(c => c.fromNode === 'forEach' && c.fromPort === 'start' && c.toNode === 'processItem' && c.toPort === 'execute')).toBe(true);
    // last child (double).onSuccess → scope.success
    expect(scopeConns.some(c => c.fromNode === 'double' && c.fromPort === 'onSuccess' && c.toNode === 'forEach' && c.toPort === 'success')).toBe(true);
    // last child (double).onFailure → scope.failure
    expect(scopeConns.some(c => c.fromNode === 'double' && c.fromPort === 'onFailure' && c.toNode === 'forEach' && c.toPort === 'failure')).toBe(true);
  });

  it('renders all connections as SVG paths', () => {
    const code = fs.readFileSync(forEachFile, 'utf-8');
    const svg = sourceToSVG(code);
    // Should have paths for: Start→forEach.items, forEach.results→Exit,
    // scope connections (item→processItem, processItem→double, double→result),
    // plus auto-connected start/success/failure
    const pathCount = (svg.match(/<path /g) ?? []).length;
    expect(pathCount).toBeGreaterThanOrEqual(5);
  });
});
