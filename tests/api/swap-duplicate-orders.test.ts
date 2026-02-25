/**
 * Test: Port swapping with duplicate orders
 *
 * Issue: When instance ports have the same explicit order (e.g., both order=0),
 * swapping them results in no change because we're swapping 0 with 0.
 *
 * Expected: Swap should use implicit position-based order when explicit orders are the same.
 */

import { describe, it, expect } from 'vitest';
import { swapNodeInstancePortOrder } from '../../src/api/manipulation/ports';
import { parser } from '../../src/parser';
import * as fs from 'fs';
import * as path from 'path';

describe('swapNodeInstancePortOrder - Duplicate Orders', () => {
  const tempDir = path.join(__dirname, '.output');

  beforeAll(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  it('should swap ports even when they have the same explicit order', () => {
    // This workflow has a doubler instance where both execute and value have order=0
    const source = `
/**
 * @flowWeaver nodeType
 * @input execute
 * @input value
 * @output onSuccess
 * @output result
 */
function Double(execute: boolean, value: number) {
  return { onSuccess: true, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node doubler Double [portOrder: execute=0,value=0]
 * @connect Start.execute -> doubler.execute
 * @connect Start.a -> doubler.value
 * @connect doubler.result -> Exit.result
 * @param {NUMBER} a
 * @returns {NUMBER} result
 */
export async function testWorkflow(execute: boolean, params: { a: number }) {
  return { onSuccess: true, result: 0 };
}
`;

    // Write to file and parse
    const testFile = path.join(tempDir, 'duplicate-orders-test.ts');
    fs.writeFileSync(testFile, source);

    const parseResult = parser.parse(testFile);
    const ast = parseResult.workflows[0];

    // Find the doubler instance
    const doublerBefore = ast.instances.find(i => i.id === 'doubler');
    expect(doublerBefore).toBeDefined();
    // portConfigs should not carry direction — annotations are direction-agnostic
    expect(doublerBefore!.config?.portConfigs).toEqual([
      { portName: 'execute', order: 0 },
      { portName: 'value', order: 0 }
    ]);

    // Swap execute and value ports
    const result = swapNodeInstancePortOrder(ast, 'doubler', 'execute', 'value');

    // Find the doubler instance in result
    const doublerAfter = result.instances.find(i => i.id === 'doubler');
    expect(doublerAfter).toBeDefined();

    // After swap, orders should be different
    // execute was implicitly at position 0, value at position 1
    // So after swap: execute should be 1, value should be 0
    const portConfigs = doublerAfter!.config?.portConfigs || [];

    const executeConfig = portConfigs.find(pc => pc.portName === 'execute');
    const valueConfig = portConfigs.find(pc => pc.portName === 'value');

    expect(executeConfig).toBeDefined();
    expect(valueConfig).toBeDefined();

    // The orders should be swapped based on implicit position
    // execute (implicit pos 0) should now have value's implicit order (pos 1)
    // value (implicit pos 1) should now have execute's implicit order (pos 0)
    expect(executeConfig!.order).toBe(1);
    expect(valueConfig!.order).toBe(0);
  });

  it('should handle swapping when one port has explicit order and other has implicit', () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input execute
 * @input value
 * @output onSuccess
 * @output result
 */
function Double(execute: boolean, value: number) {
  return { onSuccess: true, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node doubler Double [portOrder: execute=0]
 * @connect Start.execute -> doubler.execute
 * @connect Start.a -> doubler.value
 * @connect doubler.result -> Exit.result
 * @param {NUMBER} a
 * @returns {NUMBER} result
 */
export async function testWorkflow(execute: boolean, params: { a: number }) {
  return { onSuccess: true, result: 0 };
}
`;

    // Write to file and parse
    const testFile = path.join(tempDir, 'mixed-orders-test.ts');
    fs.writeFileSync(testFile, source);

    const parseResult = parser.parse(testFile);
    const ast = parseResult.workflows[0];

    // execute has explicit order=0, value has implicit order=1
    const result = swapNodeInstancePortOrder(ast, 'doubler', 'execute', 'value');

    const doublerAfter = result.instances.find(i => i.id === 'doubler');
    const portConfigs = doublerAfter!.config?.portConfigs || [];

    const executeConfig = portConfigs.find(pc => pc.portName === 'execute');
    const valueConfig = portConfigs.find(pc => pc.portName === 'value');

    // After swap: execute (was at 0) should be at 1, value (was at 1) should be at 0
    expect(executeConfig!.order).toBe(1);
    expect(valueConfig!.order).toBe(0);
  });
});

describe('portOrder direction handling', () => {
  const tempDir = path.join(__dirname, '.output');

  beforeAll(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  it('should parse portOrder without hardcoding direction to INPUT', () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input execute
 * @input value
 * @output onSuccess
 * @output result
 */
function MyFunc(execute: boolean, value: number) {
  return { onSuccess: true, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node myNode MyFunc [portOrder: execute=0,result=1,onSuccess=0]
 * @connect Start.execute -> myNode.execute
 * @connect Start.a -> myNode.value
 * @connect myNode.result -> Exit.result
 * @param {NUMBER} a
 * @returns {NUMBER} result
 */
export async function testWorkflow(execute: boolean, params: { a: number }) {
  return { onSuccess: true, result: 0 };
}
`;

    const testFile = path.join(tempDir, 'direction-test.ts');
    fs.writeFileSync(testFile, source);

    const parseResult = parser.parse(testFile);
    const ast = parseResult.workflows[0];

    const instance = ast.instances.find(i => i.id === 'myNode');
    expect(instance).toBeDefined();

    // portOrder annotation has no direction info, so parsed portConfigs
    // should NOT have direction hardcoded to 'INPUT'
    const resultConfig = instance!.config?.portConfigs?.find(pc => pc.portName === 'result');
    expect(resultConfig).toBeDefined();
    expect(resultConfig!.direction).toBeUndefined();

    const onSuccessConfig = instance!.config?.portConfigs?.find(pc => pc.portName === 'onSuccess');
    expect(onSuccessConfig).toBeDefined();
    expect(onSuccessConfig!.direction).toBeUndefined();

    // Input ports should also have no direction (annotation doesn't know)
    const executeConfig = instance!.config?.portConfigs?.find(pc => pc.portName === 'execute');
    expect(executeConfig).toBeDefined();
    expect(executeConfig!.direction).toBeUndefined();
  });

  it('should swap output port orders correctly', () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input execute
 * @input value
 * @output onSuccess
 * @output result
 */
function MyFunc(execute: boolean, value: number) {
  return { onSuccess: true, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node myNode MyFunc [portOrder: onSuccess=0,result=1]
 * @connect Start.execute -> myNode.execute
 * @connect Start.a -> myNode.value
 * @connect myNode.result -> Exit.result
 * @param {NUMBER} a
 * @returns {NUMBER} result
 */
export async function testWorkflow(execute: boolean, params: { a: number }) {
  return { onSuccess: true, result: 0 };
}
`;

    const testFile = path.join(tempDir, 'output-swap-test.ts');
    fs.writeFileSync(testFile, source);

    const parseResult = parser.parse(testFile);
    const ast = parseResult.workflows[0];

    // Swap result and onSuccess output ports
    const result = swapNodeInstancePortOrder(ast, 'myNode', 'result', 'onSuccess');
    const portConfigs = result.instances.find(i => i.id === 'myNode')!.config?.portConfigs || [];

    const resultConfig = portConfigs.find(pc => pc.portName === 'result');
    const successConfig = portConfigs.find(pc => pc.portName === 'onSuccess');

    expect(resultConfig).toBeDefined();
    expect(successConfig).toBeDefined();
    // onFailure (injected mandatory) occupies visual position 0,
    // so after swap: result takes onSuccess's position (1), onSuccess takes result's (2)
    expect(resultConfig!.order).toBe(1);
    expect(successConfig!.order).toBe(2);
  });
});