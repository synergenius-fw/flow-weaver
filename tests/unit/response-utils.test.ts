import { describe, it, expect } from 'vitest';
import { makeToolResult, makeErrorResult, addHintsToItems, ERROR_HINTS } from '../../src/mcp/response-utils';

describe('makeToolResult', () => {
  it('wraps data in a success response with JSON text content', () => {
    const result = makeToolResult({ nodes: ['a', 'b'] });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ nodes: ['a', 'b'] });
  });

  it('handles primitive data values', () => {
    const result = makeToolResult(42);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data).toBe(42);
  });

  it('handles null data', () => {
    const result = makeToolResult(null);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data).toBeNull();
  });

  it('does not set isError', () => {
    const result = makeToolResult('ok');
    expect(result).not.toHaveProperty('isError');
  });
});

describe('makeErrorResult', () => {
  it('wraps error code and message in an error response', () => {
    const result = makeErrorResult('UNKNOWN_NODE_TYPE', 'Node type "Foo" not found');
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('UNKNOWN_NODE_TYPE');
    expect(parsed.error.message).toBe('Node type "Foo" not found');
  });

  it('produces valid JSON in the text field', () => {
    const result = makeErrorResult('CODE', 'msg with "quotes" and\nnewline');
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
  });
});

describe('ERROR_HINTS', () => {
  it('contains entries for all standard validation error codes', () => {
    const expectedCodes = [
      'UNKNOWN_NODE_TYPE',
      'UNKNOWN_SOURCE_NODE',
      'UNKNOWN_TARGET_NODE',
      'UNKNOWN_SOURCE_PORT',
      'UNKNOWN_TARGET_PORT',
      'MISSING_REQUIRED_INPUT',
      'CYCLE_DETECTED',
      'UNUSED_NODE',
      'NO_START_CONNECTIONS',
      'NO_EXIT_CONNECTIONS',
      'UNREACHABLE_EXIT_PORT',
    ];
    for (const code of expectedCodes) {
      expect(ERROR_HINTS[code]).toBeDefined();
    }
  });

  it('contains entries for agent-specific codes', () => {
    expect(ERROR_HINTS['AGENT_LLM_MISSING_ERROR_HANDLER']).toBeDefined();
    expect(ERROR_HINTS['AGENT_UNGUARDED_TOOL_EXECUTOR']).toBeDefined();
    expect(ERROR_HINTS['AGENT_MISSING_MEMORY_IN_LOOP']).toBeDefined();
  });
});

describe('addHintsToItems', () => {
  it('should include fw_modify in UNKNOWN_SOURCE_PORT hint', () => {
    const items = [
      { message: 'bad port', severity: 'error', code: 'UNKNOWN_SOURCE_PORT', nodeId: 'n1' },
    ];
    const result = addHintsToItems(items);
    expect(result[0].hint).toContain('fw_describe');
    expect(result[0].hint).toContain('fw_modify');
  });

  it('should include fw_modify in UNKNOWN_TARGET_PORT hint', () => {
    const items = [
      { message: 'bad port', severity: 'error', code: 'UNKNOWN_TARGET_PORT', nodeId: 'Exit' },
    ];
    const result = addHintsToItems(items);
    expect(result[0].hint).toContain('fw_describe');
    expect(result[0].hint).toContain('fw_modify');
  });

  it('should have hint for UNREACHABLE_EXIT_PORT', () => {
    expect(ERROR_HINTS['UNREACHABLE_EXIT_PORT']).toBeDefined();
    expect(ERROR_HINTS['UNREACHABLE_EXIT_PORT']).toContain('fw_modify');
  });

  it('should include fw_modify in NO_START_CONNECTIONS hint', () => {
    const items = [{ message: 'no start', severity: 'error', code: 'NO_START_CONNECTIONS' }];
    const result = addHintsToItems(items);
    expect(result[0].hint).toContain('fw_modify');
  });

  it('should include fw_modify in NO_EXIT_CONNECTIONS hint', () => {
    const items = [{ message: 'no exit', severity: 'error', code: 'NO_EXIT_CONNECTIONS' }];
    const result = addHintsToItems(items);
    expect(result[0].hint).toContain('fw_modify');
  });

  it('should replace <nodeId> placeholder with actual nodeId', () => {
    const items = [
      { message: 'bad port', severity: 'error', code: 'UNKNOWN_SOURCE_PORT', nodeId: 'myNode' },
    ];
    const result = addHintsToItems(items);
    expect(result[0].hint).toContain('myNode');
    expect(result[0].hint).not.toContain('<nodeId>');
  });

  it('WU9: MISSING_REQUIRED_INPUT hint should show correct @input [optional] syntax', () => {
    const hint = ERROR_HINTS['MISSING_REQUIRED_INPUT'];
    expect(hint).toBeDefined();
    // Should contain the correct syntax: @input portName [optional]
    expect(hint).toContain('[optional]');
    // Should NOT contain the old incorrect syntax: @input [name]
    expect(hint).not.toContain('@input [name]');
  });

  it('passes through items without a code unchanged', () => {
    const items = [{ message: 'general warning', severity: 'warning' }];
    const result = addHintsToItems(items);
    expect(result[0]).toEqual(items[0]);
    expect(result[0]).not.toHaveProperty('hint');
  });

  it('does not add hint for unknown error codes', () => {
    const items = [{ message: 'custom', severity: 'error', code: 'CUSTOM_UNKNOWN_CODE' }];
    const result = addHintsToItems(items);
    expect(result[0]).not.toHaveProperty('hint');
  });

  it('replaces all <nodeId> occurrences in a single hint', () => {
    const items = [
      { message: 'missing handler', severity: 'error', code: 'AGENT_LLM_MISSING_ERROR_HANDLER', nodeId: 'llm1' },
    ];
    const result = addHintsToItems(items);
    expect(result[0].hint).toBeDefined();
    expect(result[0].hint).toContain('llm1');
    expect(result[0].hint).not.toContain('<nodeId>');
  });

  it('includes friendly error when friendlyErrorFn is provided', () => {
    const items = [{ message: 'bad', severity: 'error', code: 'CYCLE_DETECTED' }];
    const friendlyFn = () => ({
      title: 'Cycle Found',
      explanation: 'Your graph has a loop',
      fix: 'Remove the cycle',
      code: 'CYCLE_DETECTED',
    });
    const result = addHintsToItems(items, friendlyFn);
    expect(result[0].friendly).toBeDefined();
    expect(result[0].friendly!.title).toBe('Cycle Found');
    expect(result[0].friendly!.explanation).toBe('Your graph has a loop');
    expect(result[0].friendly!.fix).toBe('Remove the cycle');
  });

  it('does not add friendly when friendlyErrorFn returns null', () => {
    const items = [{ message: 'bad', severity: 'error', code: 'UNKNOWN_NODE_TYPE' }];
    const friendlyFn = () => null;
    const result = addHintsToItems(items, friendlyFn);
    expect(result[0]).not.toHaveProperty('friendly');
    // hint should still be present
    expect(result[0].hint).toBeDefined();
  });

  it('handles multiple items in a batch', () => {
    const items = [
      { message: 'a', severity: 'error', code: 'UNUSED_NODE' },
      { message: 'b', severity: 'warning' },
      { message: 'c', severity: 'error', code: 'CYCLE_DETECTED' },
    ];
    const result = addHintsToItems(items);
    expect(result).toHaveLength(3);
    expect(result[0].hint).toBeDefined();
    expect(result[1]).not.toHaveProperty('hint');
    expect(result[2].hint).toBeDefined();
  });
});
