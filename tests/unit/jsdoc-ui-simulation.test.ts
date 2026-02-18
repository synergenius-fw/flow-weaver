/**
 * Test UI Flow Simulation
 * Tests simulating user interactions with ports via UI
 */

import {
  parsePortsFromFunctionText,
  updatePortsInFunctionText,
  syncSignatureToJSDoc,
  syncJSDocToSignature,
  syncCodeRenames,
  hasOrphanPortLines,
} from '../../src/jsdoc-port-sync';

describe('JSDoc UI Simulation', () => {
  describe('UI Flow Simulation', () => {
    // These tests simulate the exact flow used by the Design Node panel
    // Ports → updatePortsInFunctionText → syncJSDocToSignature → Code

    it('should add port via UI and update signature', () => {
      const startCode = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean) {}`;

      // Simulate UI adding a port
      const inputs = { input1: { dataType: 'NUMBER' as const, label: 'Input 1' } };
      const outputs = {};

      // Step 1: Update JSDoc
      let result = updatePortsInFunctionText(startCode, inputs, outputs);
      expect(result).toContain('@input input1 - Input 1');

      // Step 2: Sync to signature (pass authoritative ports for type info)
      result = syncJSDocToSignature(result, { inputs, outputs });
      expect(result).toContain('input1: number');
    });

    it('should handle multiple ports added via UI', () => {
      const startCode = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean) {}`;

      const inputs = {
        x: { dataType: 'NUMBER' as const },
        y: { dataType: 'NUMBER' as const },
        name: { dataType: 'STRING' as const },
      };
      const outputs = {};

      let result = updatePortsInFunctionText(startCode, inputs, outputs);
      result = syncJSDocToSignature(result, { inputs, outputs });

      expect(result).toContain('x: number');
      expect(result).toContain('y: number');
      expect(result).toContain('name: string');
    });

    it('should handle scoped ports added via UI for forEach pattern', () => {
      const startCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 */
function forEach(execute: boolean, items: any[], iteration: (execute: boolean, item: any) => { onSuccess: boolean; processed: any }) {}`;

      // Simulate adding scoped ports via UI
      const inputs = {
        items: { dataType: 'ARRAY' as const, label: 'Items' },
        onSuccess: { dataType: 'STEP' as const, scope: 'iteration', label: 'Success' },
        processed: { dataType: 'ANY' as const, scope: 'iteration', label: 'Processed' },
      };
      const outputs = {
        execute: { dataType: 'STEP' as const, scope: 'iteration', label: 'Execute' },
        item: { dataType: 'ANY' as const, scope: 'iteration', label: 'Current Item' },
      };

      let result = updatePortsInFunctionText(startCode, inputs, outputs);
      result = syncJSDocToSignature(result, { inputs, outputs });

      // Callback should be created with scoped ports
      expect(result).toContain('iteration:');
      // Scoped OUTPUT ports → callback parameters
      expect(result).toMatch(/\(execute:\s*boolean.*item:\s*any/);
      // Scoped INPUT ports → callback return type
      expect(result).toMatch(/=>\s*\{[^}]*onSuccess:\s*boolean/);
      expect(result).toMatch(/=>\s*\{[^}]*processed:\s*any/);
    });

    it('should be stable across multiple sync cycles (no infinite loops)', () => {
      const startCode = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean) {}`;

      const inputs = { input1: { dataType: 'NUMBER' as const, label: 'Input 1' } };

      // First cycle
      let code = updatePortsInFunctionText(startCode, inputs, {});
      code = syncJSDocToSignature(code);
      const afterFirstCycle = code;

      // Parse back and sync again (simulates Code → Ports → Code)
      const parsed = parsePortsFromFunctionText(code);
      code = updatePortsInFunctionText(code, parsed.inputs, parsed.outputs);
      code = syncJSDocToSignature(code);
      const afterSecondCycle = code;

      // Should be identical after stabilization
      expect(afterSecondCycle).toBe(afterFirstCycle);
    });

    it('should not duplicate execute param on multiple syncs', () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean) {}`;

      const result1 = syncJSDocToSignature(code);
      const result2 = syncJSDocToSignature(result1);
      const result3 = syncJSDocToSignature(result2);

      // Should always have exactly one execute
      const executeCount = (result3.match(/execute: boolean/g) || []).length;
      expect(executeCount).toBe(1);
    });

    it('should add new port to signature with existing callback (forEach pattern)', () => {
      // This tests that splitParams correctly handles arrow function syntax (=>)
      // without treating the > as closing an angle bracket
      const code = `/**
 * @flowWeaver nodeType
 * @input items
 * @input success scope:iteration
 * @input execute
 * @input options
 * @output start scope:iteration
 * @output onSuccess
 */
function forEach(execute: boolean, items: any[], iteration: (start: boolean) => { success: boolean }) {}`;

      const result = syncJSDocToSignature(code);
      expect(result).toContain('options: any');
    });
  });
});
describe('Signature Manipulation Simulation', () => {
  // Helper to simulate typing sequence
  const simulateTypingSequence = (steps: string[]) => {
    const results: string[] = [];
    let current = steps[0];
    results.push(current);

    for (let i = 1; i < steps.length; i++) {
      const previous = current;
      current = steps[i];

      // Check if previous had orphan lines (user was editing port name)
      const prevOrphan = hasOrphanPortLines(previous);
      const currOrphan = hasOrphanPortLines(current);

      // Apply sync (simulating what the UI does)
      let synced = syncCodeRenames(previous, current);

      if (prevOrphan.inputs || prevOrphan.outputs) {
        // Previous had orphan lines - user just finished typing new name
        // Run syncJSDocToSignature FIRST to add the new port to signature
        // Then syncSignatureToJSDoc to sync any other changes
        synced = syncJSDocToSignature(synced);
        synced = syncSignatureToJSDoc(synced);
      } else {
        // Normal case: syncSignatureToJSDoc first to clean orphan JSDoc tags
        // before syncJSDocToSignature tries to add them back
        synced = syncSignatureToJSDoc(synced);
        synced = syncJSDocToSignature(synced);
      }
      results.push(synced);
      current = synced;
    }
    return results;
  };

  describe('Adding a new parameter by typing', () => {
    it('handles typing: , y', () => {
      const steps = [
        `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number, ) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number, y) {}`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      expect(final).toContain('@input x');
      expect(final).toContain('@input y');
    });

    it('handles typing: , y: -> , y: s -> , y: string', () => {
      const steps = [
        `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number, y) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
function test(execute: boolean, x: number, y:) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
function test(execute: boolean, x: number, y: s) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
function test(execute: boolean, x: number, y: string) {}`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      expect(final).toContain('@input x');
      expect(final).toContain('@input y');
    });

    it('does NOT shift JSDoc lines while typing incomplete type', () => {
      const steps = [
        `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
function test(execute: boolean, x: number, y: s) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
function test(execute: boolean, x: number, y: st) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
function test(execute: boolean, x: number, y: str) {}`,
      ];

      const results = simulateTypingSequence(steps);

      // All intermediate results should keep {ANY} y unchanged
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i]).toContain('@input y');
      }
    });
  });

  describe('Removing a parameter', () => {
    it('removes @input when param deleted from signature', () => {
      const steps = [
        `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
function test(execute: boolean, x: number, y: string) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
function test(execute: boolean, x: number) {}`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      expect(final).toContain('@input x');
      expect(final).not.toContain('@input y');
    });
  });

  describe('Renaming a parameter', () => {
    it('renames @input when param renamed in signature', () => {
      const steps = [
        `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, count: number) {}`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      expect(final).toContain('@input count');
      expect(final).not.toContain('@input x');
    });

    it('handles progressive rename: x -> co -> cou -> count', () => {
      const steps = [
        `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, co: number) {}`,
        `/**
 * @flowWeaver nodeType
 * @input co
 */
function test(execute: boolean, cou: number) {}`,
        `/**
 * @flowWeaver nodeType
 * @input cou
 */
function test(execute: boolean, count: number) {}`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      expect(final).toContain('@input count');
    });
  });

  describe('Changing parameter type', () => {
    it('updates @input type when signature type changes', () => {
      // In new format, types are NOT stored in JSDoc - they're derived from signature
      // So changing signature type doesn't change JSDoc annotation
      const steps = [
        `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: string) {}`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      // JSDoc annotation should still have @input x (no type info in JSDoc)
      expect(final).toContain('@input x');
      // Signature type changed to string
      expect(final).toContain('x: string');
    });
  });

  describe('Multiple parameters', () => {
    it('handles adding multiple params sequentially', () => {
      const steps = [
        `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean) {}`,
        `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean, a: number) {}`,
        `/**
 * @flowWeaver nodeType
 * @input a
 */
function test(execute: boolean, a: number, b: string) {}`,
        `/**
 * @flowWeaver nodeType
 * @input a
 * @input b
 */
function test(execute: boolean, a: number, b: string, c: boolean) {}`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      expect(final).toContain('@input a');
      expect(final).toContain('@input b');
      expect(final).toContain('@input c');
    });
  });

  describe('Preserving labels and metadata', () => {
    it('preserves label when type changes', () => {
      const steps = [
        `/**
 * @flowWeaver nodeType
 * @input x - My Label
 */
function test(execute: boolean, x: number) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x - My Label
 */
function test(execute: boolean, x: string) {}`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      expect(final).toContain('@input x - My Label');
    });

    it('preserves order metadata when type changes', () => {
      const steps = [
        `/**
 * @flowWeaver nodeType
 * @input x [order:5]
 */
function test(execute: boolean, x: number) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x [order:5]
 */
function test(execute: boolean, x: string) {}`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      expect(final).toContain('@input x');
      expect(final).toContain('[order:5]');
    });
  });

  describe('Output ports (return type)', () => {
    it('adds @output when return field added', () => {
      const steps = [
        `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number) { return { result: x * 2 }; }`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      expect(final).toContain('@output result');
    });

    it('removes @output when return field removed', () => {
      const steps = [
        `/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function test(execute: boolean, x: number) { return { result: x * 2 }; }`,
        `/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function test(execute: boolean, x: number) { return {}; }`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      expect(final).not.toContain('@output result');
    });
  });

  describe('Whitespace preservation in signature', () => {
    it('preserves extra spaces in signature when typing', () => {
      // User types extra space after comma - should NOT be removed
      const steps = [
        `/**
 * @flowWeaver nodeType
 * @input items
 * @output item scope:iteration
 */
function forEach(execute: boolean, items: any[], iteration: (execute: boolean, item: any) => void) {}`,
        `/**
 * @flowWeaver nodeType
 * @input items
 * @output item scope:iteration
 */
function forEach(execute: boolean,  items: any[], processItem: (execute: boolean, item: any) => void) {}`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      // The extra space should be preserved
      expect(final).toContain('execute: boolean,  items');
    });

    it('preserves spaces when typing after colon', () => {
      const steps = [
        `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x:  number) {}`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      expect(final).toContain('x:  number');
    });

    it('preserves trailing spaces in signature while typing', () => {
      const steps = [
        `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number,  ) {}`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      // Trailing space before ) should be preserved
      expect(final).toContain('number,  )');
    });
  });

  describe('Orphan incomplete port lines', () => {
    it('removes signature param when user deletes port name from JSDoc', () => {
      // User deletes last char of port name 'a' -> line becomes "@input "
      // Should preserve the orphan line AND remove the corresponding param from signature
      const steps = [
        `/**
 * @flowWeaver nodeType
 * @input a
 * @input b
 */
function test(execute: boolean, a: string, b: string) {}`,
        `/**
 * @flowWeaver nodeType
 * @input
 * @input b
 */
function test(execute: boolean, a: string, b: string) {}`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      // Should have exactly 2 @input lines (orphan preserved)
      const inputCount = (final.match(/@input/g) || []).length;
      expect(inputCount).toBe(2);

      // Orphan line preserved (just @input with no name, no type in new format)
      expect(final).toMatch(/@input\s*\n/);
      expect(final).toContain('@input b');
      // Signature should have 'a' param REMOVED (orphan means port deleted from JSDoc)
      expect(final).not.toContain('a: string');
      expect(final).toContain('b: string');
    });

    it('adds new param when user types new name after deleting old one', () => {
      // User deleted port name, then types new name
      // Step 1: a, b in sync
      // Step 2: user deletes 'a' from JSDoc (orphan) -> 'a' removed from signature
      // Step 3: user types 'newName' -> 'newName' added to signature
      const steps = [
        `/**
 * @flowWeaver nodeType
 * @input a
 * @input b
 */
function test(execute: boolean, a: string, b: string) {}`,
        `/**
 * @flowWeaver nodeType
 * @input
 * @input b
 */
function test(execute: boolean, a: string, b: string) {}`,
        `/**
 * @flowWeaver nodeType
 * @input newName
 * @input b
 */
function test(execute: boolean, b: string) {}`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      // Should have exactly 2 @input lines
      const inputCount = (final.match(/@input/g) || []).length;
      expect(inputCount).toBe(2);

      // New name synced to both places
      expect(final).toContain('@input newName');
      expect(final).toContain('@input b');
      // Signature has newName added (syncJSDocToSignature adds it)
      // Type defaults to any since not specified in JSDoc or existing signature
      expect(final).toContain('newName: any');
      expect(final).toContain('b: string');
    });
  });

  describe('Edge cases', () => {
    it('handles empty function becoming populated', () => {
      const steps = [
        `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean) {}`,
        `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean, x: number, y: string) {}`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      expect(final).toContain('@input x');
      expect(final).toContain('@input y');
    });

    it('handles all params being removed', () => {
      const steps = [
        `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
function test(execute: boolean, x: number, y: string) {}`,
        `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
function test(execute: boolean) {}`,
      ];

      const results = simulateTypingSequence(steps);
      const final = results[results.length - 1];

      expect(final).not.toContain('@input x');
      expect(final).not.toContain('@input y');
    });
  });
});
describe('UI Sync Flow Simulation', () => {
  it('should preserve metadata when inserting param before existing one (full UI flow)', () => {
    // This test simulates EXACTLY what the UI does when user types

    // BEFORE: User has this code
    const previousCode = `/**
 * @flowWeaver nodeType
 * @input items [order:1] - Array to iterate
 * @input processed scope:iteration [order:2] - Processed value from scope
 * @output item scope:iteration [order:1] - The item for each iteration
 * @output results [order:2] - Collected results from all iterations
 */
export const forEach: TFlowWeaverNodeType<{
  items: any[];
  processed: any;
}, {
  onSuccess: boolean;
  onFailure: boolean;
  item: any;
  results: any[];
}> = (input, output) => {};`;

    // AFTER: User adds "test: string," before items in the signature
    const currentCode = `/**
 * @flowWeaver nodeType
 * @input items [order:1] - Array to iterate
 * @input processed scope:iteration [order:2] - Processed value from scope
 * @output item scope:iteration [order:1] - The item for each iteration
 * @output results [order:2] - Collected results from all iterations
 */
export const forEach: TFlowWeaverNodeType<{
  test: string;
  items: any[];
  processed: any;
}, {
  onSuccess: boolean;
  onFailure: boolean;
  item: any;
  results: any[];
}> = (input, output) => {};`;

    // UI Flow: syncCodeRenames → syncSignatureToJSDoc → syncJSDocToSignature
    const step1 = syncCodeRenames(previousCode, currentCode);
    const step2 = syncSignatureToJSDoc(step1);
    const step3 = syncJSDocToSignature(step2);

    // Verify items still has its metadata
    expect(step3).toContain('@input items [order:1] - Array to iterate');
    // Verify test is added WITHOUT items' metadata (no type in new format)
    expect(step3).toMatch(/@input\s+test(?!\s*\[order:1\])/);
  });

  it('should not transfer metadata when inserting param (simpler case)', () => {
    const previousCode = `/**
 * @flowWeaver nodeType
 * @input items [order:1] - Array to iterate
 */
function forEach(execute: boolean, items: any[], iteration: (execute: boolean, item: any) => { onSuccess: boolean; processed: any }) {}`;

    const currentCode = `/**
 * @flowWeaver nodeType
 * @input items [order:1] - Array to iterate
 */
function forEach(execute: boolean, test: string, items: any[]) {}`;

    const step1 = syncCodeRenames(previousCode, currentCode);
    const step2 = syncSignatureToJSDoc(step1);
    const step3 = syncJSDocToSignature(step2);

    // Verify items keeps its metadata
    expect(step3).toContain('@input items [order:1] - Array to iterate');
    // Verify test is added as simple @input without order metadata
    expect(step3).toContain('@input test');
    expect(step3).not.toMatch(/@input\s+\{STRING\}\s+test\s+\[order:1\]/);
  });

  it('should preserve JSDoc order when inserting new param (items stays in place)', () => {
    // User added "test: string" BEFORE existing "items" param
    // items should stay in its original position in JSDoc, not be moved to the end
    const previousCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:iteration [order:2] - Processed value from scope
 * @output item scope:iteration [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(execute: boolean, items: any[], iteration: (execute: boolean, item: any) => { onSuccess: boolean; onFailure: boolean; processed: any }): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;

    const currentCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:iteration [order:2] - Processed value from scope
 * @output item scope:iteration [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(execute: boolean, test: string, items: any[], iteration: (execute: boolean, item: any) => { onSuccess: boolean; onFailure: boolean; processed: any }): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;

    // UI Flow: syncCodeRenames → syncSignatureToJSDoc → syncJSDocToSignature
    const step1 = syncCodeRenames(previousCode, currentCode);
    const step2 = syncSignatureToJSDoc(step1);
    const step3 = syncJSDocToSignature(step2);

    // Get input lines in order (new format without {TYPE})
    const inputLines = step3.match(/@input\s+\w+/g) || [];

    // items should come BEFORE processed (scoped port), not after
    const itemsIndex = inputLines.findIndex((l) => l.includes('items'));
    const processedIndex = inputLines.findIndex((l) => l.includes('processed'));

    expect(itemsIndex).toBeLessThan(processedIndex);
    // items should keep its metadata
    expect(step3).toContain('@input items [order:1] - Array to iterate');
    // test should NOT have items' metadata (no type in new format)
    expect(step3).not.toMatch(/@input\s+test\s+\[order:1\]/);
  });

  it('should NOT rename when user types partial param name before existing param (t before items)', () => {
    // User is typing "test" but has only typed "t" so far
    // Signature: t, items (where t is incomplete)
    // JSDoc still has: items
    // BUG: System thinks items→t is a rename because t is at position 0
    const previousCode = `/**
 * @flowWeaver nodeType
 * @input items [order:1] - Array to iterate
 */
function forEach(execute: boolean, items: any[], iteration: (execute: boolean, item: any) => { onSuccess: boolean; processed: any }) {}`;

    // User typed "t" before items (incomplete - will become "test: string")
    const currentCode = `/**
 * @flowWeaver nodeType
 * @input items [order:1] - Array to iterate
 */
function forEach(execute: boolean, t, items: any[]) {}`;

    const result = syncCodeRenames(previousCode, currentCode);

    // items should KEEP its metadata - no rename happened
    expect(result).toContain('@input items [order:1] - Array to iterate');
    // t should NOT get items' metadata
    expect(result).not.toContain('@input t');
  });

  it('should NOT rename when user types partial param - FULL UI FLOW (t before items)', () => {
    // Same scenario but with full UI flow: syncCodeRenames → syncSignatureToJSDoc → syncJSDocToSignature
    const previousCode = `/**
 * @flowWeaver nodeType
 * @input items [order:1] - Array to iterate
 */
function forEach(execute: boolean, items: any[], iteration: (execute: boolean, item: any) => { onSuccess: boolean; processed: any }) {}`;

    const currentCode = `/**
 * @flowWeaver nodeType
 * @input items [order:1] - Array to iterate
 */
function forEach(execute: boolean, t, items: any[]) {}`;

    const step1 = syncCodeRenames(previousCode, currentCode);
    const step2 = syncSignatureToJSDoc(step1);
    const step3 = syncJSDocToSignature(step2);

    // items should KEEP its metadata - not renamed to t
    expect(step3).toContain('@input items [order:1] - Array to iterate');
    // t is added as new port but should NOT have items' metadata
    expect(step3).not.toContain('@input t [order:1]');
    // t should appear (without metadata)
    expect(step3).toContain('@input t');
  });

  it("should handle user typing 't' on NEW LINE before items (multiline signature)", () => {
    // User's EXACT scenario - multiline function signature
    const previousCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:iteration [order:2] - Processed value from scope
 * @output item scope:iteration [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (
    execute: boolean,
    item: any,
  ) => {
    onSuccess: boolean;
    onFailure: boolean;
    processed: any;
  },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;

    // User typed "t" on a new line before items
    const currentCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:iteration [order:2] - Processed value from scope
 * @output item scope:iteration [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(
  execute: boolean,
  t
  items: any[],
  processItem: (
    execute: boolean,
    item: any,
  ) => {
    onSuccess: boolean;
    onFailure: boolean;
    processed: any;
  },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;

    const step1 = syncCodeRenames(previousCode, currentCode);
    const step2 = syncSignatureToJSDoc(step1);
    const step3 = syncJSDocToSignature(step2);

    // items should KEEP its metadata
    expect(step3).toContain('@input items [order:1] - Array to iterate');
    // t should NOT get items' metadata
    expect(step3).not.toContain('@input t [order:1]');
    expect(step3).not.toContain('@input t [order:1]');
  });

  it("should preserve items metadata with full function body - USER'S ACTUAL BUG", () => {
    // User's EXACT final result showing the bug:
    // items lost [order:1] - Array to iterate
    const previousCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:iteration [order:2] - Processed value from scope
 * @output item scope:iteration [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (
    execute: boolean,
    item: any,
  ) => {
    onSuccess: boolean;
    onFailure: boolean;
    processed: any;
  },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });
  return { onSuccess: true, onFailure: false, results };
}`;

    const currentCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:iteration [order:2] - Processed value from scope
 * @output item scope:iteration [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(
  execute: boolean,
  test: string,
  items: any[],
  processItem: (
    execute: boolean,
    item: any,
  ) => {
    onSuccess: boolean;
    onFailure: boolean;
    processed: any;
  },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });
  return { onSuccess: true, onFailure: false, results };
}`;

    const step1 = syncCodeRenames(previousCode, currentCode);
    const step2 = syncSignatureToJSDoc(step1);
    const step3 = syncJSDocToSignature(step2);

    // items MUST keep its metadata
    expect(step3).toContain('@input items [order:1] - Array to iterate');
    // test should be added without items' metadata
    expect(step3).toContain('@input test');
    expect(step3).not.toContain('@input test [order:1]');
  });

  it("should NOT transfer metadata when user's exact scenario (test before items)", () => {
    // User's exact scenario - items had [order:1], user added test: string before it
    // BUG: test gets items' metadata, items loses it
    const previousCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:iteration [order:2] - Processed value from scope
 * @output item scope:iteration [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(execute: boolean, items: any[], iteration: (execute: boolean, item: any) => { onSuccess: boolean; onFailure: boolean; processed: any }): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;

    // User typed "test: string, " before items
    const currentCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:iteration [order:2] - Processed value from scope
 * @output item scope:iteration [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(execute: boolean, test: string, items: any[], iteration: (execute: boolean, item: any) => { onSuccess: boolean; onFailure: boolean; processed: any }): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;

    // Step-by-step verification
    const step1 = syncCodeRenames(previousCode, currentCode);

    // After syncCodeRenames: items should STILL have its metadata
    expect(step1).toContain('@input items [order:1] - Array to iterate');
    // test should NOT exist yet in JSDoc (only added later by syncSignatureToJSDoc)
    expect(step1).not.toContain('@input test [order:1]');

    const step2 = syncSignatureToJSDoc(step1);

    // After syncSignatureToJSDoc: items still has metadata, test is added fresh
    expect(step2).toContain('@input items [order:1] - Array to iterate');
    expect(step2).toContain('@input test'); // test added
    expect(step2).not.toContain('@input test [order:1]'); // but NOT with items' metadata

    const step3 = syncJSDocToSignature(step2);

    // Final result: same expectations
    expect(step3).toContain('@input items [order:1] - Array to iterate');
    expect(step3).toContain('@input test');
    expect(step3).not.toContain('@input test [order:1]');
  });

  it('INCREMENTAL TYPING - simulates UI sync after each keystroke', () => {
    // This simulates what happens in the UI when user types "test" character by character
    // Each keystroke triggers: syncCodeRenames -> syncSignatureToJSDoc -> syncJSDocToSignature

    // Initial state - before typing
    const code = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:processItem [order:2] - Processed value from scope
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (execute: boolean, item: any) => { onSuccess: boolean; onFailure: boolean; processed: any },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;

    let prevCode = code;

    // STEP 1: User types "t" (malformed signature)
    let currentCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:processItem [order:2] - Processed value from scope
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(
  execute: boolean,
  t
  items: any[],
  processItem: (execute: boolean, item: any) => { onSuccess: boolean; onFailure: boolean; processed: any },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;

    let step1 = syncCodeRenames(prevCode, currentCode);
    let step2 = syncSignatureToJSDoc(step1);
    let step3 = syncJSDocToSignature(step2);

    // After typing "t" - items should STILL have its metadata
    expect(step3).toContain('@input items [order:1] - Array to iterate');

    // Update prevCode for next iteration
    prevCode = step3;

    // STEP 2: User types "te" (still malformed)
    currentCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:processItem [order:2] - Processed value from scope
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(
  execute: boolean,
  te
  items: any[],
  processItem: (execute: boolean, item: any) => { onSuccess: boolean; onFailure: boolean; processed: any },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;

    step1 = syncCodeRenames(prevCode, currentCode);
    step2 = syncSignatureToJSDoc(step1);
    step3 = syncJSDocToSignature(step2);

    expect(step3).toContain('@input items [order:1] - Array to iterate');
    prevCode = step3;

    // STEP 3: User types "tes"
    currentCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:processItem [order:2] - Processed value from scope
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(
  execute: boolean,
  tes
  items: any[],
  processItem: (execute: boolean, item: any) => { onSuccess: boolean; onFailure: boolean; processed: any },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;

    step1 = syncCodeRenames(prevCode, currentCode);
    step2 = syncSignatureToJSDoc(step1);
    step3 = syncJSDocToSignature(step2);

    expect(step3).toContain('@input items [order:1] - Array to iterate');
    prevCode = step3;

    // STEP 4: User types "test"
    currentCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:processItem [order:2] - Processed value from scope
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(
  execute: boolean,
  test
  items: any[],
  processItem: (execute: boolean, item: any) => { onSuccess: boolean; onFailure: boolean; processed: any },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;

    step1 = syncCodeRenames(prevCode, currentCode);
    step2 = syncSignatureToJSDoc(step1);
    step3 = syncJSDocToSignature(step2);

    expect(step3).toContain('@input items [order:1] - Array to iterate');
    prevCode = step3;

    // STEP 5: User types "test:"
    currentCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:processItem [order:2] - Processed value from scope
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(
  execute: boolean,
  test:
  items: any[],
  processItem: (execute: boolean, item: any) => { onSuccess: boolean; onFailure: boolean; processed: any },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;

    step1 = syncCodeRenames(prevCode, currentCode);
    step2 = syncSignatureToJSDoc(step1);
    step3 = syncJSDocToSignature(step2);

    expect(step3).toContain('@input items [order:1] - Array to iterate');
    prevCode = step3;

    // STEP 6: User types "test: s"
    currentCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:processItem [order:2] - Processed value from scope
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(
  execute: boolean,
  test: s
  items: any[],
  processItem: (execute: boolean, item: any) => { onSuccess: boolean; onFailure: boolean; processed: any },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;

    step1 = syncCodeRenames(prevCode, currentCode);
    step2 = syncSignatureToJSDoc(step1);
    step3 = syncJSDocToSignature(step2);

    expect(step3).toContain('@input items [order:1] - Array to iterate');
    prevCode = step3;

    // STEP 7: User finishes "test: string,"
    currentCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:processItem [order:2] - Processed value from scope
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(
  execute: boolean,
  test: string,
  items: any[],
  processItem: (execute: boolean, item: any) => { onSuccess: boolean; onFailure: boolean; processed: any },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;

    step1 = syncCodeRenames(prevCode, currentCode);
    step2 = syncSignatureToJSDoc(step1);
    step3 = syncJSDocToSignature(step2);

    // FINAL: items MUST still have its metadata
    expect(step3).toContain('@input items [order:1] - Array to iterate');
    // test should be added but WITHOUT items' metadata
    expect(step3).toContain('@input test');
    expect(step3).not.toContain('@input test [order:1]');
  });

  it('USER EXACT BUG - items loses metadata when typing test: string before it', () => {
    // User's EXACT before code
    const beforeCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input success scope:processItem [order:0] - Success from scope
 * @input failure scope:processItem [order:1] - Failure from scope
 * @input processed scope:processItem [order:2] - Processed value from scope
 * @input execute [order:0] - Execute
 * @output start scope:processItem [order:0] - Execute control for scope
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - All processed results
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };

  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });

  return { onSuccess: true, onFailure: false, results };
}`;

    // User's EXACT expected after code - test should be BEFORE items in JSDoc
    const expectedAfterCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input test
 * @input items [order:1] - Array to iterate
 * @input success scope:processItem [order:0] - Success from scope
 * @input failure scope:processItem [order:1] - Failure from scope
 * @input processed scope:processItem [order:2] - Processed value from scope
 * @input execute [order:0] - Execute
 * @output start scope:processItem [order:0] - Execute control for scope
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - All processed results
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function forEach(
  execute: boolean,
  test: string,
  items: any[],
  processItem: (start: boolean, item: any) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }
): { onSuccess: boolean; onFailure: boolean; results: any[] } {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };

  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });

  return { onSuccess: true, onFailure: false, results };
}`;

    // Simulate typing "test: string," character by character
    const typingSteps = [
      't',
      'te',
      'tes',
      'test',
      'test:',
      'test: ',
      'test: s',
      'test: st',
      'test: str',
      'test: stri',
      'test: strin',
      'test: string',
      'test: string,',
    ];

    let prevCode = beforeCode;

    for (const typed of typingSteps) {
      // Build current code with typed characters before items
      const currentCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input success scope:processItem [order:0] - Success from scope
 * @input failure scope:processItem [order:1] - Failure from scope
 * @input processed scope:processItem [order:2] - Processed value from scope
 * @input execute [order:0] - Execute
 * @output start scope:processItem [order:0] - Execute control for scope
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - All processed results
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function forEach(
  execute: boolean,
  ${typed}
  items: any[],
  processItem: (start: boolean, item: any) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };

  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });

  return { onSuccess: true, onFailure: false, results };
}`;

      const step1 = syncCodeRenames(prevCode, currentCode);
      const step2 = syncSignatureToJSDoc(step1);
      const step3 = syncJSDocToSignature(step2);

      prevCode = step3;
    }

    // EXACT MATCH - final result must match exactly
    expect(prevCode).toBe(expectedAfterCode);
  });

  it('should NOT duplicate params when signature is malformed during typing', () => {
    const beforeCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:processItem [order:2] - Processed value from scope
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (
    execute: boolean,
    item: any,
  ) => {
    onSuccess: boolean;
    onFailure: boolean;
    processed: any;
  },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };

  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });

  return { onSuccess: true, onFailure: false, results };
}`;

    // User typed "t" on a new line before items - malformed signature
    const afterTypingT = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input processed scope:processItem [order:2] - Processed value from scope
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(
  execute: boolean,
  t
  items: any[],
  processItem: (
    execute: boolean,
    item: any,
  ) => {
    onSuccess: boolean;
    onFailure: boolean;
    processed: any;
  },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };

  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });

  return { onSuccess: true, onFailure: false, results };
}`;

    const step1 = syncCodeRenames(beforeCode, afterTypingT);
    const step2 = syncSignatureToJSDoc(step1);
    const step3 = syncJSDocToSignature(step2);

    // items should NOT be duplicated in signature
    const itemsMatches = step3.match(/items: any\[\]/g) || [];
    expect(itemsMatches.length).toBe(1);

    // items should keep its metadata in JSDoc
    expect(step3).toContain('@input items [order:1] - Array to iterate');
  });

  it('should remove port from JSDoc when user deletes entire line from signature (even with metadata)', () => {
    // User has str with [order:2] metadata, then deletes entire "str: string," line
    const beforeCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input str [order:2] - Banana
 * @input processed scope:processItem [order:2] - Processed value from scope
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(
  execute: boolean,
  items: any[],
  str: string,
  processItem: (
    execute: boolean,
    item: any,
  ) => {
    onSuccess: boolean;
    onFailure: boolean;
    processed: any;
  },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {
  return { onSuccess: true, onFailure: false, results: [] };
}`;

    // User deleted the "str: string," line entirely
    const afterCode = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items [order:1] - Array to iterate
 * @input str [order:2] - Banana
 * @input processed scope:processItem [order:2] - Processed value from scope
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (
    execute: boolean,
    item: any,
  ) => {
    onSuccess: boolean;
    onFailure: boolean;
    processed: any;
  },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {
  return { onSuccess: true, onFailure: false, results: [] };
}`;

    const step1 = syncCodeRenames(beforeCode, afterCode);
    const step2 = syncSignatureToJSDoc(step1);
    const step3 = syncJSDocToSignature(step2);

    // str should be REMOVED from JSDoc (user intentionally deleted it)
    expect(step3).not.toContain('@input str');

    // str should NOT be re-added to signature
    expect(step3).not.toContain('str: string');
  });

  it('should insert new param correctly when signature has trailing comma', () => {
    // New format: @input newPort has no type, defaults to any
    const code = `/**
 * @flowWeaver nodeType
 * @input items
 * @input newPort
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (x: number) => { y: number },
): { result: number } {}`;

    const result = syncJSDocToSignature(code);

    // newPort should be inserted BEFORE the closing paren, properly formatted
    // Type is 'any' since JSDoc no longer has {TYPE} annotation
    expect(result).toContain('processItem: (x: number) => { y: number },\n  newPort: any\n):');
    expect(result).not.toContain(', newPort'); // Should not have double comma
    expect(result).not.toContain(',\n, '); // Should not have comma-newline-comma
  });

  it('USER BUG: should insert new param correctly with multiline callback', () => {
    const code = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input test - Banana
 * @input items [order:1] - Array to iterate
 * @input processed scope:processItem [order:2] - Processed value from scope
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - All processed results
 * @input bfae2c
 */
function forEach(
  execute: boolean,
  test: string,
  items: any[],
  processItem: (
    execute: boolean,
    item: any,
  ) => {
    onSuccess: boolean;
    onFailure: boolean;
    processed: any;
  },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;

    const result = syncJSDocToSignature(code);

    // Should NOT have double comma before bfae2c
    expect(result).not.toContain(',\n, bfae2c');
    expect(result).not.toContain(', , bfae2c');
    // Should have proper formatting (type is 'any' since JSDoc no longer has {TYPE})
    expect(result).toContain('  },\n  bfae2c: any\n):');
    // JSDoc should have @input on its own line, not merged with @output
    expect(result).toContain('* @input bfae2c\n */');
    expect(result).not.toContain('* @output results [order:2] - All processed results * @input');
  });

  it('USER BUG: should insert new param correctly with multiline callback WITHOUT trailing comma', () => {
    // This is the exact scenario from user - callback type without trailing comma
    const code = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input test - Banana
 * @input items [order:1] - Array to iterate
 * @input processed scope:processItem [order:2] - Processed value from scope
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - All processed results
 * @input bfae2c
 */
function forEach(
  execute: boolean,
  test: string,
  items: any[],
  processItem: (
    execute: boolean,
    item: any,
  ) => {
    onSuccess: boolean;
    onFailure: boolean;
    processed: any;
  }
): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;

    const result = syncJSDocToSignature(code);

    // Should NOT have newline before comma
    expect(result).not.toContain('}\n,');
    expect(result).not.toContain('}\n, ');
    // Should have proper formatting: },\n  bfae2c (type is 'any' since JSDoc no longer has {TYPE})
    expect(result).toContain('  },\n  bfae2c: any\n):');
  });

  describe('Removing port from JSDoc', () => {
    it('should PRESERVE param in signature when user deletes @input line from JSDoc (signature is source of truth)', () => {
      // User has code with multiple ports
      // User manually deletes @input Mule from JSDoc, but signature still has Mule param
      const currentCode = `/**
 * @flowWeaver nodeType
 * @input Fadoma
 * @input Muruku
 * @input Nura
 */
function test(execute: boolean, Fadoma: boolean, Mule: boolean, Muruku: boolean, Nura: boolean) {}`;

      // syncJSDocToSignature should NOT remove Mule from signature
      // Signature is the source of truth for port existence - user must delete from signature manually
      const result = syncJSDocToSignature(currentCode);

      // Mule param should be PRESERVED in signature (source of truth)
      expect(result).toContain('Mule: boolean');
      // Other params should also be preserved
      expect(result).toContain('Fadoma: boolean');
      expect(result).toContain('Muruku: boolean');
      expect(result).toContain('Nura: boolean');
    });

    it('should add @input back to JSDoc when syncSignatureToJSDoc runs after user deleted it (signature is source of truth)', () => {
      // After user deletes @input Mule from JSDoc, but signature still has Mule
      const afterUserDelete = `/**
 * @flowWeaver nodeType
 * @input Fadoma
 * @input Muruku
 * @input Nura
 */
function test(execute: boolean, Fadoma: boolean, Mule: boolean, Muruku: boolean, Nura: boolean) {}`;

      // syncSignatureToJSDoc will ADD Mule back to JSDoc (correct! signature is source of truth)
      const afterSyncSigToJSDoc = syncSignatureToJSDoc(afterUserDelete);
      expect(afterSyncSigToJSDoc).toContain('@input Mule');

      // syncJSDocToSignature should PRESERVE Mule in signature
      const afterSyncJSDocToSig = syncJSDocToSignature(afterUserDelete);
      expect(afterSyncJSDocToSig).toContain('Mule: boolean');
    });

    it('should PRESERVE ALL user params when ALL @input lines are deleted from JSDoc (signature is source of truth)', () => {
      // User has code with multiple ports and deletes ALL @input lines from JSDoc
      // But signature still has all params
      const code = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean, Fadoma: boolean, Mule: boolean, Muruku: boolean, Nura: boolean) {}`;

      // syncJSDocToSignature should PRESERVE all params (signature is source of truth)
      const result = syncJSDocToSignature(code);

      // All params should be preserved
      expect(result).toContain('Fadoma: boolean');
      expect(result).toContain('Mule: boolean');
      expect(result).toContain('Muruku: boolean');
      expect(result).toContain('Nura: boolean');
    });

    it('should still parse mandatory ports after removing all user ports', () => {
      // After all user ports are removed, parsePortsFromFunctionText returns empty
      // But the UI's parsePortsFromCode should ALWAYS add mandatory ports
      // This test documents the library behavior - the UI layer handles mandatory ports
      const code = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean): { onSuccess: boolean; onFailure: boolean } {}`;

      const result = parsePortsFromFunctionText(code);

      // Library doesn't add mandatory ports - that's the UI layer's job
      expect(Object.keys(result.inputs)).toHaveLength(0);
      expect(Object.keys(result.outputs)).toHaveLength(0);
    });

    it('should PRESERVE output in return type even when @output is deleted from JSDoc (signature is source of truth)', () => {
      // User deletes the @output line - JSDoc no longer has results
      // BUT signature is source of truth, so field should stay
      const codeAfter = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean): { onSuccess: boolean; onFailure: boolean; results: any } {}`;

      // First verify parsing: JSDoc should NOT have results (no metadata)
      const parsed = parsePortsFromFunctionText(codeAfter);
      expect(Object.keys(parsed.outputs)).not.toContain('results');

      // syncJSDocToSignature should PRESERVE results in return type
      // Signature is source of truth - user typed it there
      const result = syncJSDocToSignature(codeAfter);

      // results MUST stay - signature is source of truth
      expect(result).toContain('results: any');
      expect(result).toContain('onSuccess: boolean');
      expect(result).toContain('onFailure: boolean');
    });

    it('should PRESERVE output field when user removes @output line (signature is source of truth)', () => {
      // Initial state: code with results output
      const initialCode = `/**
 * @flowWeaver nodeType
 * @output results
 */
function test(execute: boolean): { onSuccess: boolean; onFailure: boolean; results: any } {}`;

      // User deletes the @output results line from JSDoc
      const afterUserEdit = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean): { onSuccess: boolean; onFailure: boolean; results: any } {}`;

      // Run syncJSDocToSignature - signature is source of truth, so results stays
      const result = syncJSDocToSignature(afterUserEdit);

      // results MUST stay - signature is source of truth
      // Removing @output only removes metadata (label, etc), not the port itself
      expect(result).toContain('results: any');
      expect(result).toContain('onSuccess: boolean');
      expect(result).toContain('onFailure: boolean');
    });

    it('should PRESERVE output from scoped nodeType when @output line is deleted (signature is source of truth)', () => {
      // User has scoped nodeType with @output results
      // User removes the @output line entirely
      const codeAfter = `/**
 * @flowWeaver nodeType
 * @scope processItem
 */
function test(execute: boolean, processItem: (item: any) => { success: boolean }): { onSuccess: boolean; onFailure: boolean; results: any } {}`;

      // syncJSDocToSignature should PRESERVE results - signature is source of truth
      const result = syncJSDocToSignature(codeAfter);

      // results MUST stay - signature is source of truth
      expect(result).toContain('results: any');
      expect(result).toContain('onSuccess: boolean');
      expect(result).toContain('onFailure: boolean');
    });

    it('syncSignatureToJSDoc WILL add @output from return type - UI layer must prevent calling it after JSDoc removal', () => {
      // NOTE: syncSignatureToJSDoc by design adds @output for return fields
      // The UI layer must detect JSDoc removal and NOT call syncSignatureToJSDoc
      const code = `/**
 * @flowWeaver nodeType
 * @scope processItem
 */
function test(execute: boolean, processItem: (item: any) => { success: boolean }): { onSuccess: boolean; onFailure: boolean; results: any } {}`;

      const result = syncSignatureToJSDoc(code);

      // This is EXPECTED behavior - library adds @output for return fields
      // UI layer must handle the removal case by not calling this function
      expect(result).toContain('@output results');
    });

    it('USER BUG: simulate removing @output line step by step', () => {
      // Step 0: Initial code with @output results
      const step0 = `/**
 * @flowWeaver nodeType
 * @scope processItem
 * @output results
 */
function forEach(
  execute: boolean,
  processItem: (
    start: boolean,
    item: any) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }): { onSuccess: boolean; onFailure: boolean; results: any } {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });
  return { onSuccess: true, onFailure: false, results };
}`;

      // Step 1: User deletes " results" -> @output (orphan line)
      const step1 = `/**
 * @flowWeaver nodeType
 * @scope processItem
 * @output
 */
function forEach(
  execute: boolean,
  processItem: (
    start: boolean,
    item: any) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }): { onSuccess: boolean; onFailure: boolean; results: any } {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });
  return { onSuccess: true, onFailure: false, results };
}`;

      // Step 2: User deletes "{ANY}" -> @output
      const step2 = `/**
 * @flowWeaver nodeType
 * @scope processItem
 * @output
 */
function forEach(
  execute: boolean,
  processItem: (
    start: boolean,
    item: any) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }): { onSuccess: boolean; onFailure: boolean; results: any } {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });
  return { onSuccess: true, onFailure: false, results };
}`;

      // Step 3: User deletes the entire line " * @output"
      const step3 = `/**
 * @flowWeaver nodeType
 * @scope processItem
 */
function forEach(
  execute: boolean,
  processItem: (
    start: boolean,
    item: any) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }): { onSuccess: boolean; onFailure: boolean; results: any } {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });
  return { onSuccess: true, onFailure: false, results };
}`;

      // Helper to simulate UI sync behavior
      const simulateUISync = (prevCode: string, currCode: string) => {
        const countJSDocPorts = (code: string) => {
          const jsdocMatch = code.match(/\/\*\*[\s\S]*?\*\//);
          if (!jsdocMatch) return { inputs: 0, outputs: 0, outputNames: new Set<string>() };
          const jsdoc = jsdocMatch[0];
          const inputMatches = jsdoc.match(/@input\s+\{[^}]+\}\s+(\w+)/g) || [];
          const outputMatches = jsdoc.match(/@output\s+\{[^}]+\}\s+(\w+)/g) || [];
          const outputNames = new Set<string>();
          for (const match of outputMatches) {
            const nameMatch = match.match(/@output\s+\{[^}]+\}\s+(\w+)/);
            if (nameMatch) outputNames.add(nameMatch[1]);
          }
          return { inputs: inputMatches.length, outputs: outputMatches.length, outputNames };
        };
        const getReturnTypeFields = (code: string) => {
          const returnTypeMatch = code.match(/\)\s*:\s*\{([^}]+)\}/);
          if (!returnTypeMatch) return new Set<string>();
          const fields = new Set<string>();
          const fieldMatches = returnTypeMatch[1].matchAll(/(\w+)\s*:/g);
          for (const match of fieldMatches) {
            fields.add(match[1]);
          }
          return fields;
        };

        const prevJSDocPorts = countJSDocPorts(prevCode);
        const currJSDocPorts = countJSDocPorts(currCode);
        const returnTypeFields = getReturnTypeFields(currCode);
        const MANDATORY_RETURN_FIELDS = new Set(['onSuccess', 'onFailure']);
        const returnHasFieldsNotInJSDoc = [...returnTypeFields].some(
          (field) => !MANDATORY_RETURN_FIELDS.has(field) && !currJSDocPorts.outputNames.has(field)
        );
        const userRemovedFromJSDoc =
          currJSDocPorts.inputs < prevJSDocPorts.inputs ||
          currJSDocPorts.outputs < prevJSDocPorts.outputs ||
          returnHasFieldsNotInJSDoc;

        // Check for orphan lines in previous code
        const hasOrphan = hasOrphanPortLines(prevCode);

        let finalCode = currCode;
        if (userRemovedFromJSDoc) {
          // User removed a port from JSDoc - only sync JSDoc to signature
          // This takes priority over orphan detection
          finalCode = syncJSDocToSignature(finalCode);
        } else if (hasOrphan.inputs || hasOrphan.outputs) {
          // Previous had orphan lines - user just finished typing new name
          finalCode = syncJSDocToSignature(finalCode);
          finalCode = syncSignatureToJSDoc(finalCode);
        } else {
          // Normal case
          finalCode = syncSignatureToJSDoc(finalCode);
          finalCode = syncJSDocToSignature(finalCode);
        }
        return finalCode;
      };

      // Step 0 -> Step 1: User deletes " results"
      const after1 = simulateUISync(step0, step1);
      // @output should NOT come back (orphan line, no name)
      expect(after1).not.toContain('@output results');

      // Step 1 -> Step 2: User deletes "{ANY}"
      const after2 = simulateUISync(step1, step2);
      expect(after2).not.toContain('@output results');

      // Step 2 -> Step 3: User deletes entire line
      const after3 = simulateUISync(step2, step3);
      // @output should NOT come back in JSDoc
      expect(after3).not.toContain('@output');
      // BUT results MUST stay in return type - signature is source of truth
      // Removing @output only removes metadata, not the port itself
      expect(after3).toContain('results: any');
    });

    it('USER BUG: should NOT add @output from return body when return TYPE is already clean', () => {
      // User has already removed @output AND results from return type
      // But return body still has { results } in return statements
      // syncSignatureToJSDoc should NOT add @output back from body
      const cleanCode = `/**
 * @flowWeaver nodeType
 * @scope processItem
 */
function forEach(
  execute: boolean,
  processItem: (
    start: boolean,
    item: any) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }): { onSuccess: boolean; onFailure: boolean } {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });
  return { onSuccess: true, onFailure: false, results };
}`;

      // Return type annotation is clean (no results), but body has results
      const result = syncSignatureToJSDoc(cleanCode);

      // Should NOT add @output results from body - only mandatory scoped ports are added
      expect(result).not.toContain('@output results');
      // Mandatory scoped ports ARE added when @scope is declared
      expect(result).toContain('@output start scope:processItem');
      expect(result).toContain('@input success scope:processItem');
      expect(result).toContain('@input failure scope:processItem');
      // Return type should remain clean
      expect(result).toContain('{ onSuccess: boolean; onFailure: boolean }');
    });

    it('USER BUG: should preserve new field being typed in return type (results:)', () => {
      // User is typing a new field in return type: { onSuccess: boolean; onFailure: boolean; results: }
      // The sync should NOT remove "results:" while user is typing
      const codeWhileTyping = `/**
 * @flowWeaver nodeType
 * @scope processItem
 */
function forEach(
  execute: boolean,
  processItem: (
    start: boolean,
    item: any) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }): { onSuccess: boolean; onFailure: boolean; results: } {
  return { onSuccess: true, onFailure: false, results: [] };
}`;

      // syncSignatureToJSDoc should preserve the incomplete field
      const result1 = syncSignatureToJSDoc(codeWhileTyping);
      expect(result1).toContain('results:');

      // syncJSDocToSignature should also preserve incomplete fields in return type
      const result2 = syncJSDocToSignature(codeWhileTyping);
      // Check return TYPE annotation specifically (not return body)
      // Extract return type annotation: ): { ... } {
      const returnTypeMatch = result2.match(/\)\s*:\s*(\{[^}]+\})\s*\{/);
      expect(returnTypeMatch).not.toBeNull();
      const returnTypeAnnotation = returnTypeMatch![1];
      // This is the BUG - it's removing "results:" from return type annotation
      expect(returnTypeAnnotation).toContain('results:');
    });

    it('should preserve ALL signature fields - signature is source of truth', () => {
      // Signature is the source of truth for port names and types
      // syncJSDocToSignature should NEVER remove fields from signature
      // It should only ADD fields from JSDoc that don't exist in signature
      const code = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean): { onSuccess: boolean; onFailure: boolean; results: a } {
  return { onSuccess: true, onFailure: false };
}`;

      const result = syncJSDocToSignature(code);
      // Extract return type annotation
      const returnTypeMatch = result.match(/\)\s*:\s*(\{[^}]+\})\s*\{/);
      expect(returnTypeMatch).not.toBeNull();
      const returnTypeAnnotation = returnTypeMatch![1];
      // "results: a" MUST be preserved - user typed it in signature
      expect(returnTypeAnnotation).toContain('results: a');
    });

    it('should preserve custom types in signature (results: MyClass)', () => {
      const code = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean): { onSuccess: boolean; onFailure: boolean; results: MyClass } {
  return { onSuccess: true, onFailure: false };
}`;

      const result = syncJSDocToSignature(code);
      const returnTypeMatch = result.match(/\)\s*:\s*(\{[^}]+\})\s*\{/);
      expect(returnTypeMatch).not.toBeNull();
      // Custom type MUST be preserved
      expect(returnTypeMatch![1]).toContain('results: MyClass');
    });

    it("should ADD fields from JSDoc that don't exist in signature", () => {
      // JSDoc has @output that signature doesn't have - should be added
      // Type is inferred from return body (count: 42 → number)
      const code = `/**
 * @flowWeaver nodeType
 * @output count
 */
function test(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false, count: 42 };
}`;

      const result = syncJSDocToSignature(code);
      const returnTypeMatch = result.match(/\)\s*:\s*(\{[^}]+\})\s*\{/);
      expect(returnTypeMatch).not.toBeNull();
      // count should be added from JSDoc with type inferred from return body
      expect(returnTypeMatch![1]).toContain('count: number');
    });

    it('USER BUG: should allow typing new field in return type (results: a)', () => {
      // User is typing a new field "results: a" in return type
      // No @output exists yet - user is adding it via signature
      const code = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean): { onSuccess: boolean; onFailure: boolean; results: a } {
  return { onSuccess: true, onFailure: false };
}`;

      const result = syncJSDocToSignature(code);

      // "results: a" MUST be preserved - user is typing it
      expect(result).toContain('results: a');
    });

    it('USER BUG: should allow typing incomplete field in return type (results:)', () => {
      // User just typed "results:" - incomplete, no type yet
      const code = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean): { onSuccess: boolean; onFailure: boolean; results: } {
  return { onSuccess: true, onFailure: false };
}`;

      const result = syncJSDocToSignature(code);

      // "results:" MUST be preserved - user is typing it
      expect(result).toContain('results:');
    });

    describe('Full UI sync simulation - signature is source of truth', () => {
      // Helper to simulate the NEW simplified UI sync behavior
      // Only syncJSDocToSignature runs on keystrokes
      // syncSignatureToJSDoc only runs on Ctrl+P (format)
      const simulateKeystrokeSync = (prevCode: string, currCode: string) => {
        let finalCode = syncCodeRenames(prevCode, currCode);
        finalCode = syncJSDocToSignature(finalCode);
        return finalCode;
      };

      const simulateFormatAction = (code: string) => {
        // Ctrl+P runs both syncs
        let finalCode = syncSignatureToJSDoc(code);
        finalCode = syncJSDocToSignature(finalCode);
        return finalCode;
      };

      it('should preserve new field typed in return type (keystroke sync)', () => {
        const prevCode = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;

        const currCode = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean): { onSuccess: boolean; onFailure: boolean; results: any } {
  return { onSuccess: true, onFailure: false };
}`;

        const result = simulateKeystrokeSync(prevCode, currCode);

        // Field should stay in return type
        expect(result).toContain('results: any');
        // @output NOT added yet - that happens on Ctrl+P
        expect(result).not.toContain('@output results');
      });

      it('should add @output when user formats with Ctrl+P', () => {
        const code = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean): { onSuccess: boolean; onFailure: boolean; results: any } {
  return { onSuccess: true, onFailure: false };
}`;

        const result = simulateFormatAction(code);

        // @output should be added for the field
        expect(result).toContain('@output results');
        // Field should stay in return type
        expect(result).toContain('results: any');
      });

      it('should allow deleting @output from JSDoc (keystroke sync)', () => {
        const prevCode = `/**
 * @flowWeaver nodeType
 * @output results
 */
function test(execute: boolean): { onSuccess: boolean; onFailure: boolean; results: any } {
  return { onSuccess: true, onFailure: false };
}`;

        const currCode = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean): { onSuccess: boolean; onFailure: boolean; results: any } {
  return { onSuccess: true, onFailure: false };
}`;

        const result = simulateKeystrokeSync(prevCode, currCode);

        // @output should NOT come back on keystroke
        expect(result).not.toContain('@output');
        // Field should stay in return type - signature is source of truth
        expect(result).toContain('results: any');
      });

      it('should restore @output when user formats with Ctrl+P after deleting it', () => {
        // User deleted @output but field still in signature
        const code = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean): { onSuccess: boolean; onFailure: boolean; results: any } {
  return { onSuccess: true, onFailure: false };
}`;

        const result = simulateFormatAction(code);

        // @output should come back on Ctrl+P - signature is source of truth
        expect(result).toContain('@output results');
        expect(result).toContain('results: any');
      });

      it('should remove @output when field is deleted from signature and formatted', () => {
        // User deleted "results: any" from return type, @output still in JSDoc
        const code = `/**
 * @flowWeaver nodeType
 * @output results
 */
function test(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;

        const result = simulateFormatAction(code);

        // @output should be removed since field is gone from signature
        expect(result).not.toContain('@output results');
        // Field should stay removed
        expect(result).not.toContain('results: any');
      });
    });
  });
});
