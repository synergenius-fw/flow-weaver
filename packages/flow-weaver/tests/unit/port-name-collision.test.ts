/**
 * Test for port name collision between regular ports and scoped ports
 *
 * Issue: When a node has both a regular INPUT port "execute" and a scoped OUTPUT port "start",
 * connections can get confused between the two contexts.
 */

import { describe, it, expect } from 'vitest';
import { parser } from '../../src/parser';
import { generator } from '../../src/generator';
import * as path from 'path';

describe('Port Name Collision', () => {
  const workflowPath = path.join(__dirname, '../../fixtures/advanced/example-scoped-ports.ts');

  it('should distinguish between regular execute INPUT and scoped start OUTPUT', () => {
    const parseResult = parser.parse(workflowPath);
    const workflow = parseResult.workflows[0];

    // Find connections involving execute/start ports
    const startToForEach = workflow.connections.find(
      c => c.from.node === 'Start' && c.from.port === 'execute' && c.to.node === 'forEach1'
    );

    const forEachToProcessor = workflow.connections.find(
      c => c.from.node === 'forEach1' && c.from.port === 'start' && c.to.node === 'processor1'
    );

    // Verify Start.execute connects to forEach1's regular INPUT execute (not scoped)
    expect(startToForEach).toBeDefined();
    expect(startToForEach?.to.port).toBe('execute');

    // Verify forEach1.start (scoped OUTPUT) connects to processor1.execute
    expect(forEachToProcessor).toBeDefined();
    expect(forEachToProcessor?.to.port).toBe('execute');

    // The key issue: these should be treated as DIFFERENT ports
    // Start -> forEach1.execute (INPUT, not scoped)
    // forEach1.start (OUTPUT, scoped) -> processor1.execute
  });

  it('should generate correct code without port confusion', async () => {
    const code = await generator.generate(workflowPath, 'scopedPortsWorkflow');

    // Should define forEach1_execute from Start.execute connection
    expect(code).toContain('const forEach1_execute');
    expect(code).toContain("getVariable({ id: 'Start', portName: 'execute'");

    // Should call forEach with forEach1_execute, not hardcoded true
    const lines = code.split('\n');
    const forEachCallLine = lines.find((l: string) => l.includes('forEach1Result'));

    expect(forEachCallLine).toBeDefined();
    expect(forEachCallLine).toContain('forEach(forEach1_execute');

    // Verify it's NOT using hardcoded true for execute
    expect(forEachCallLine).not.toContain('forEach(true');
  });
});