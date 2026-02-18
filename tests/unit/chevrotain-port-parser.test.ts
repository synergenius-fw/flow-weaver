/**
 * @module chevrotain-parser/port-parser.test
 *
 * Tests for parsing @input/@output/@step port declarations.
 */

import {
  parsePortLine,
  parsePortsFromJSDoc,
  isValidPortLine,
} from '../../src/chevrotain-parser/port-parser';

// Shared warnings array — reset per test isn't needed since we don't assert on it here
const w: string[] = [];

describe('Chevrotain Port Parser', () => {
  describe('@input parsing', () => {
    it('should parse simple @input', () => {
      const result = parsePortLine('@input myPort', w);
      expect(result).toEqual({
        type: 'input',
        name: 'myPort',
      });
    });

    it('should parse @input with scope', () => {
      const result = parsePortLine('@input myPort scope:iteration', w);
      expect(result).toEqual({
        type: 'input',
        name: 'myPort',
        scope: 'iteration',
      });
    });

    it('should parse @input with order', () => {
      const result = parsePortLine('@input myPort [order:1]', w);
      expect(result).toEqual({
        type: 'input',
        name: 'myPort',
        order: 1,
      });
    });

    it('should parse @input with placement TOP', () => {
      const result = parsePortLine('@input myPort [placement:TOP]', w);
      expect(result).toEqual({
        type: 'input',
        name: 'myPort',
        placement: 'TOP',
      });
    });

    it('should parse @input with placement BOTTOM', () => {
      const result = parsePortLine('@input myPort [placement:BOTTOM]', w);
      expect(result).toEqual({
        type: 'input',
        name: 'myPort',
        placement: 'BOTTOM',
      });
    });

    it('should parse @input with description', () => {
      const result = parsePortLine('@input myPort - This is a description', w);
      expect(result).toEqual({
        type: 'input',
        name: 'myPort',
        description: 'This is a description',
      });
    });

    it('should parse @input with special characters in description', () => {
      const result = parsePortLine('@input x - Value (in meters) & ratio', w);
      expect(result).toEqual({
        type: 'input',
        name: 'x',
        description: 'Value (in meters) & ratio',
      });
    });

    it('should parse @input with scope and order', () => {
      const result = parsePortLine('@input myPort scope:loop [order:2]', w);
      expect(result).toEqual({
        type: 'input',
        name: 'myPort',
        scope: 'loop',
        order: 2,
      });
    });

    it('should parse @input with all options', () => {
      const result = parsePortLine('@input myPort scope:iter [order:3, placement:TOP] - A port', w);
      expect(result).toEqual({
        type: 'input',
        name: 'myPort',
        scope: 'iter',
        order: 3,
        placement: 'TOP',
        description: 'A port',
      });
    });

    it('should parse optional @input with brackets', () => {
      const result = parsePortLine('@input [myPort]', w);
      expect(result).toEqual({
        type: 'input',
        name: 'myPort',
        isOptional: true,
      });
    });

    it('should parse @input with default value', () => {
      const result = parsePortLine('@input [myPort=default]', w);
      expect(result).toEqual({
        type: 'input',
        name: 'myPort',
        isOptional: true,
        defaultValue: 'default',
      });
    });

    it('should parse @input with arrow function expression in description', () => {
      const result = parsePortLine(
        '@input timeout - Expression: (ctx) => ctx.getVariable({ nodeName: "Start", portName: "maxTimeout", executionIndex: 0 }) || 5000',
        w
      );
      expect(result).not.toBeNull();
      expect(result?.type).toBe('input');
      expect(result?.name).toBe('timeout');
      expect(result?.description).toContain('Expression:');
      expect(result?.description).toContain('=>');
    });

    it('should parse @input with simple arrow function in description', () => {
      const result = parsePortLine('@input callback - Expression: (x) => x * 2', w);
      expect(result).not.toBeNull();
      expect(result?.name).toBe('callback');
      expect(result?.description).toBe('Expression: (x) => x * 2');
    });

    it('should parse @input with arrow and braces in description', () => {
      const result = parsePortLine('@input data - Expression: (a, b) => { return a + b; }', w);
      expect(result).not.toBeNull();
      expect(result?.name).toBe('data');
      expect(result?.description).toContain('{ return a + b; }');
    });

    it('should parse @input with pipe operator in description', () => {
      const result = parsePortLine('@input value - Default: a || b', w);
      expect(result).not.toBeNull();
      expect(result?.name).toBe('value');
      expect(result?.description).toBe('Default: a || b');
    });

    it('should parse @input with comparison operators in description', () => {
      const result = parsePortLine('@input cond - Check: x < 10 && y > 5', w);
      expect(result).not.toBeNull();
      expect(result?.name).toBe('cond');
      expect(result?.description).toBe('Check: x < 10 && y > 5');
    });
  });

  describe('@output parsing', () => {
    it('should parse simple @output', () => {
      const result = parsePortLine('@output result', w);
      expect(result).toEqual({
        type: 'output',
        name: 'result',
      });
    });

    it('should parse @output with scope', () => {
      const result = parsePortLine('@output result scope:callback', w);
      expect(result).toEqual({
        type: 'output',
        name: 'result',
        scope: 'callback',
      });
    });

    it('should parse @output with description', () => {
      const result = parsePortLine('@output sum - The sum of inputs', w);
      expect(result).toEqual({
        type: 'output',
        name: 'sum',
        description: 'The sum of inputs',
      });
    });
  });

  describe('@step parsing', () => {
    it('should parse simple @step', () => {
      const result = parsePortLine('@step onComplete', w);
      expect(result).toEqual({
        type: 'step',
        name: 'onComplete',
      });
    });

    it('should parse @step with description', () => {
      const result = parsePortLine('@step onComplete - Called when done', w);
      expect(result).toEqual({
        type: 'step',
        name: 'onComplete',
        description: 'Called when done',
      });
    });
  });

  describe('parsePortsFromJSDoc', () => {
    it('should parse all ports from JSDoc block', () => {
      const jsdoc = `/**
 * @flowWeaver nodeType
 * @input a
 * @input b scope:loop
 * @output result
 * @step onComplete
 */`;
      const results = parsePortsFromJSDoc(jsdoc, w);
      expect(results).toHaveLength(4);
      expect(results[0]).toEqual({ type: 'input', name: 'a' });
      expect(results[1]).toEqual({ type: 'input', name: 'b', scope: 'loop' });
      expect(results[2]).toEqual({ type: 'output', name: 'result' });
      expect(results[3]).toEqual({ type: 'step', name: 'onComplete' });
    });
  });

  describe('isValidPortLine', () => {
    it('should return true for valid port lines', () => {
      expect(isValidPortLine(' * @input foo')).toBe(true);
      expect(isValidPortLine(' * @output bar')).toBe(true);
      expect(isValidPortLine(' * @step baz')).toBe(true);
    });

    it('should return false for invalid lines', () => {
      expect(isValidPortLine(' * @node n1 type')).toBe(false);
      expect(isValidPortLine(' * just text')).toBe(false);
    });
  });

  describe('[type:X] attribute parsing', () => {
    it('should parse @output with type attribute', () => {
      const result = parsePortLine('@output a [type:NUMBER] - A', w);
      expect(result).toEqual({
        type: 'output',
        name: 'a',
        dataType: 'NUMBER',
        description: 'A',
      });
    });

    it('should parse @input with type attribute', () => {
      const result = parsePortLine('@input x [type:STRING] - X Value', w);
      expect(result).toEqual({
        type: 'input',
        name: 'x',
        dataType: 'STRING',
        description: 'X Value',
      });
    });

    it('should parse type and order together', () => {
      const result = parsePortLine('@output result [type:NUMBER, order:1] - Result', w);
      expect(result).toEqual({
        type: 'output',
        name: 'result',
        dataType: 'NUMBER',
        order: 1,
        description: 'Result',
      });
    });

    it('should parse type with all attributes', () => {
      const result = parsePortLine(
        '@input value [type:BOOLEAN, order:2, placement:TOP] - Value',
        w
      );
      expect(result).toEqual({
        type: 'input',
        name: 'value',
        dataType: 'BOOLEAN',
        order: 2,
        placement: 'TOP',
        description: 'Value',
      });
    });

    it('should parse all standard type values', () => {
      const types = ['STRING', 'NUMBER', 'BOOLEAN', 'ARRAY', 'OBJECT', 'FUNCTION', 'ANY', 'STEP'];
      for (const t of types) {
        const result = parsePortLine(`@output port [type:${t}]`, w);
        expect(result?.dataType).toBe(t);
      }
    });
  });

  describe('Edge cases', () => {
    it('should return null for non-port lines', () => {
      expect(parsePortLine('@node myNode type', w)).toBeNull();
      expect(parsePortLine('@connect A.x -> B.y', w)).toBeNull();
      expect(parsePortLine('just some text', w)).toBeNull();
    });

    it('should handle whitespace variations', () => {
      const result = parsePortLine('@input   myPort   scope:foo', w);
      expect(result?.name).toBe('myPort');
      expect(result?.scope).toBe('foo');
    });
  });

  describe('mergeStrategy parsing', () => {
    it('should parse @input with mergeStrategy:COLLECT', () => {
      const result = parsePortLine('@input data [mergeStrategy:COLLECT]', w);
      expect(result).toEqual({
        type: 'input',
        name: 'data',
        mergeStrategy: 'COLLECT',
      });
    });

    it('should parse @input with mergeStrategy:FIRST', () => {
      const result = parsePortLine('@input data [mergeStrategy:FIRST]', w);
      expect(result?.mergeStrategy).toBe('FIRST');
    });

    it('should parse @input with mergeStrategy:LAST', () => {
      const result = parsePortLine('@input data [mergeStrategy:LAST]', w);
      expect(result?.mergeStrategy).toBe('LAST');
    });

    it('should parse @input with mergeStrategy:MERGE', () => {
      const result = parsePortLine('@input data [mergeStrategy:MERGE]', w);
      expect(result?.mergeStrategy).toBe('MERGE');
    });

    it('should parse @input with mergeStrategy:CONCAT', () => {
      const result = parsePortLine('@input data [mergeStrategy:CONCAT]', w);
      expect(result?.mergeStrategy).toBe('CONCAT');
    });

    it('should parse mergeStrategy with other metadata', () => {
      const result = parsePortLine('@input data [mergeStrategy:COLLECT, order:1]', w);
      expect(result).toEqual({
        type: 'input',
        name: 'data',
        mergeStrategy: 'COLLECT',
        order: 1,
      });
    });

    it('should parse mergeStrategy with type and placement', () => {
      const result = parsePortLine(
        '@input data [mergeStrategy:MERGE, type:OBJECT, placement:TOP]',
        w
      );
      expect(result?.mergeStrategy).toBe('MERGE');
      expect(result?.dataType).toBe('OBJECT');
      expect(result?.placement).toBe('TOP');
    });

    it('should parse mergeStrategy with scope and description', () => {
      const result = parsePortLine(
        '@input data scope:loop [mergeStrategy:COLLECT] - Collected data from multiple sources',
        w
      );
      expect(result).toEqual({
        type: 'input',
        name: 'data',
        scope: 'loop',
        mergeStrategy: 'COLLECT',
        description: 'Collected data from multiple sources',
      });
    });
  });
});
