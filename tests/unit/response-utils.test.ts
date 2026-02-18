import { describe, it, expect } from 'vitest';
import { addHintsToItems, ERROR_HINTS } from '../../src/mcp/response-utils';

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
});
