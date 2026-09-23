import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AnnotationParser } from '../../src/parser/annotation-parser';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Tests that the parser's importCache invalidates when imported files change.
 *
 * The importCache stores parsed node types from imported files. Without mtime
 * validation, edits to imported files (e.g., adding a new @input port) would
 * be invisible to workflows that import them until the process restarts.
 */

const FIXTURES_DIR = path.join(os.tmpdir(), 'fw-test-import-cache-mtime');

describe('importCache mtime invalidation', () => {
  let parser: AnnotationParser;

  beforeAll(() => {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    parser = new AnnotationParser();
  });

  function writeFile(name: string, content: string): string {
    const filePath = path.join(FIXTURES_DIR, name);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  function createNodeType(ports: string[]): string {
    const inputs = ports.map((p, i) => ` * @input ${p} [order:${i}] - ${p}`).join('\n');
    return `/**
 * @flowWeaver nodeType
 * @label TestNode
${inputs}
 * @output result [order:0] - Result
 */
export function testNode(execute: boolean${ports.map(p => `, ${p}?: string`).join('')}): { result: string } {
  return { result: 'ok' };
}
`;
  }

  function createWorkflow(nodeTypePath: string): string {
    const relPath = './' + path.relative(FIXTURES_DIR, nodeTypePath).replace(/\.ts$/, '.js');
    return `import { testNode } from '${relPath}';

/**
 * @flowWeaver workflow
 * @name test
 * @connect Start.execute -> testNode.execute
 * @connect Start.input -> testNode.input
 * @connect testNode.result -> Exit.result
 * @param input [order:0] - Input
 * @returns result [order:0] - Result
 */
export function test() {}
`;
  }

  it('detects new port added to an imported node type', () => {
    // Step 1: Create node type with just 'input' port
    const nodeFile = writeFile('node-v1.ts', createNodeType(['input']));
    const workflowFile = writeFile('wf-v1.ts', createWorkflow(nodeFile));

    // Parse workflow — should succeed (input port exists)
    const result1 = parser.parse(workflowFile);
    expect(result1.errors).toHaveLength(0);

    // Step 2: Add 'extraPort' to the node type
    // Need a small delay to ensure mtime changes (filesystem granularity)
    const newContent = createNodeType(['input', 'extraPort']);
    // Touch with a future mtime to guarantee change
    fs.writeFileSync(nodeFile, newContent, 'utf-8');
    const now = new Date();
    fs.utimesSync(nodeFile, now, new Date(now.getTime() + 1000));

    // Step 3: Update workflow to connect to the new port
    const workflowWithNewPort = `import { testNode } from './${path.relative(FIXTURES_DIR, nodeFile).replace(/\.ts$/, '.js')}';

/**
 * @flowWeaver workflow
 * @name test
 * @connect Start.execute -> testNode.execute
 * @connect Start.input -> testNode.input
 * @connect Start.extraPort -> testNode.extraPort
 * @connect testNode.result -> Exit.result
 * @param input [order:0] - Input
 * @param extraPort [order:1] - Extra port
 * @returns result [order:0] - Result
 */
export function test() {}
`;
    fs.writeFileSync(workflowFile, workflowWithNewPort, 'utf-8');
    fs.utimesSync(workflowFile, now, new Date(now.getTime() + 1000));

    // Parse again — same parser instance, should see the new port
    const result2 = parser.parse(workflowFile);
    const portErrors = result2.errors.filter(e =>
      typeof e === 'string' ? e.includes('extraPort') : (e as any).message?.includes('extraPort')
    );
    expect(portErrors).toHaveLength(0);
  });

  it('serves cached result when imported file has not changed', () => {
    const nodeFile = writeFile('node-cached.ts', createNodeType(['input']));
    const workflowFile = writeFile('wf-cached.ts', createWorkflow(nodeFile));

    // Parse twice with same parser — second should use cache
    const result1 = parser.parse(workflowFile);
    const result2 = parser.parse(workflowFile);

    expect(result1.errors).toHaveLength(0);
    expect(result2.errors).toHaveLength(0);

    // Both should produce the same node types
    const nt1 = result1.nodeTypes?.find(n => n.name === 'testNode' || n.functionName === 'testNode');
    const nt2 = result2.nodeTypes?.find(n => n.name === 'testNode' || n.functionName === 'testNode');
    expect(nt1).toBeDefined();
    expect(nt2).toBeDefined();
  });

  it('invalidates cache when imported file is deleted and recreated', () => {
    const nodeFile = writeFile('node-delete.ts', createNodeType(['portA']));
    const workflowFile = writeFile('wf-delete.ts', `import { testNode } from './${path.relative(FIXTURES_DIR, nodeFile).replace(/\.ts$/, '.js')}';

/**
 * @flowWeaver workflow
 * @name test
 * @connect Start.execute -> testNode.execute
 * @connect Start.portA -> testNode.portA
 * @connect testNode.result -> Exit.result
 * @param portA [order:0] - Port A
 * @returns result [order:0] - Result
 */
export function test() {}
`);

    // Parse successfully
    const result1 = parser.parse(workflowFile);
    expect(result1.errors).toHaveLength(0);

    // Delete and recreate with different ports
    fs.unlinkSync(nodeFile);
    fs.writeFileSync(nodeFile, createNodeType(['portB']), 'utf-8');
    const now = new Date();
    fs.utimesSync(nodeFile, now, new Date(now.getTime() + 2000));

    // Update workflow to use portB
    fs.writeFileSync(workflowFile, `import { testNode } from './${path.relative(FIXTURES_DIR, nodeFile).replace(/\.ts$/, '.js')}';

/**
 * @flowWeaver workflow
 * @name test
 * @connect Start.execute -> testNode.execute
 * @connect Start.portB -> testNode.portB
 * @connect testNode.result -> Exit.result
 * @param portB [order:0] - Port B
 * @returns result [order:0] - Result
 */
export function test() {}
`, 'utf-8');
    fs.utimesSync(workflowFile, now, new Date(now.getTime() + 2000));

    // Parse again — should see portB, not stale portA
    const result2 = parser.parse(workflowFile);
    const portErrors = result2.errors.filter(e =>
      typeof e === 'string' ? e.includes('portB') : (e as any).message?.includes('portB')
    );
    expect(portErrors).toHaveLength(0);
  });

  it('different parser instances do not share import cache', () => {
    const nodeFile = writeFile('node-isolated.ts', createNodeType(['input']));
    const workflowFile = writeFile('wf-isolated.ts', createWorkflow(nodeFile));

    // Parse with parser 1
    const parser1 = new AnnotationParser();
    const result1 = parser1.parse(workflowFile);
    expect(result1.errors).toHaveLength(0);

    // Parse with parser 2 — should work independently
    const parser2 = new AnnotationParser();
    const result2 = parser2.parse(workflowFile);
    expect(result2.errors).toHaveLength(0);
  });
});
