/**
 * Parser: JavaScript workflow files (compiled .js without type annotations).
 *
 * When a workflow is distributed as compiled JS (e.g. from a marketplace pack),
 * function parameters lose their TypeScript type annotations. The parser must
 * still recognize "execute" as a step port when JSDoc @param metadata confirms it.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parser } from '../../src/parser';

const tempDir = path.join(os.tmpdir(), `fw-parser-js-${process.pid}`);

beforeAll(() => {
  fs.mkdirSync(tempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Parsing .js workflow files', () => {
  it('should parse a workflow with untyped execute parameter when JSDoc @param is present', () => {
    // Simulates what TypeScript emits for a workflow function:
    // types are stripped, but JSDoc annotations survive.
    const jsSource = `
/**
 * A test workflow.
 *
 * @flowWeaver workflow
 *
 * @node a testNode [position: 0 0]
 *
 * @path Start -> a -> Exit
 *
 * @connect a.result -> Exit.output
 *
 * @position Start -200 0
 * @position Exit 200 0
 *
 * @param execute [order:-1] - Execute
 * @param data [order:0] - Input data
 * @returns onSuccess [order:-2] - On Success
 * @returns onFailure [order:-1] - On Failure
 * @returns output [order:0] - Output
 */
export async function testWorkflow(execute, data) {
    return { onSuccess: false, onFailure: true, output: null };
}

/**
 * @flowWeaver nodeType
 * @label Test Node
 * @input execute [order:0] - Execute
 * @input data [order:1] - Data
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 * @output result [order:2] - Result
 */
function testNode(execute, data) {
    if (!execute) return { onSuccess: false, onFailure: false, result: null };
    return { onSuccess: true, onFailure: false, result: data };
}
`;

    const filePath = path.join(tempDir, 'test-workflow.js');
    fs.writeFileSync(filePath, jsSource);

    const result = parser.parse(filePath);

    expect(result.errors).toHaveLength(0);
    expect(result.workflows).toHaveLength(1);

    const wf = result.workflows[0];
    expect(wf.functionName).toBe('testWorkflow');
    expect(wf.startPorts.execute).toBeDefined();
    expect(wf.startPorts.execute.dataType).toBe('STEP');
    expect(wf.startPorts.data).toBeDefined();
  });

  it('should parse a node type with untyped execute parameter', () => {
    const jsSource = `
/**
 * @flowWeaver nodeType
 * @label Processor
 * @input execute [order:0] - Execute
 * @input value [order:1] - Value
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 * @output processed [order:2] - Processed
 */
function processor(execute, value) {
    if (!execute) return { onSuccess: false, onFailure: false, processed: null };
    return { onSuccess: true, onFailure: false, processed: value };
}
`;

    const filePath = path.join(tempDir, 'test-node.js');
    fs.writeFileSync(filePath, jsSource);

    const result = parser.parse(filePath);

    expect(result.errors).toHaveLength(0);
    expect(result.nodeTypes).toHaveLength(1);

    const nt = result.nodeTypes[0];
    expect(nt.name).toBe('processor');
    expect(nt.inputs.execute).toBeDefined();
    expect(nt.inputs.execute.dataType).toBe('STEP');
  });

  it('should reject untyped execute in a workflow without JSDoc @param confirmation', () => {
    // Workflow with untyped execute but no @param execute annotation.
    // The parser cannot confirm it's a step port, so this should fail.
    const jsSource = `
/**
 * @flowWeaver workflow
 * @node a testNode [position: 0 0]
 * @path Start -> a -> Exit
 * @position Start -200 0
 * @position Exit 200 0
 * @returns output [order:0] - Output
 */
export function badWorkflow(execute, data) {
    return { output: null };
}

/**
 * @flowWeaver nodeType
 * @label Test Node
 * @input execute [order:0] - Execute
 * @input data [order:1] - Data
 * @output onSuccess [order:0] - On Success
 * @output result [order:1] - Result
 */
function testNode(execute, data) {
    return { onSuccess: true, result: data };
}
`;

    const filePath = path.join(tempDir, 'bad-workflow.js');
    fs.writeFileSync(filePath, jsSource);

    // Should throw (or produce errors) about the execute parameter type
    expect(() => parser.parse(filePath)).toThrow('execute');
  });
});
