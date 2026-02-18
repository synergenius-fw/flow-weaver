/**
 * @module chevrotain-parser/node-parser.test
 *
 * Tests for parsing @node declarations.
 * TDD: Write tests before implementing parser.
 */

import { parseNodeLine } from '../../src/chevrotain-parser/node-parser';

const w: string[] = [];

describe('Chevrotain Node Parser', () => {
  describe('Basic @node parsing', () => {
    it('should parse simple @node', () => {
      const result = parseNodeLine('@node adder1 adder', w);
      expect(result).toEqual({
        instanceId: 'adder1',
        nodeType: 'adder',
      });
    });

    it('should parse @node with npm package path (slashes in id and type)', () => {
      const result = parseNodeLine(
        '@node npm/autoprefixer/autoprefixer7e721cfa3e27 npm/autoprefixer/autoprefixer [label: "autoprefixer"]',
        w
      );
      expect(result).toEqual({
        instanceId: 'npm/autoprefixer/autoprefixer7e721cfa3e27',
        nodeType: 'npm/autoprefixer/autoprefixer',
        label: 'autoprefixer',
      });
    });

    it('should parse @node with label', () => {
      const result = parseNodeLine('@node adder1 adder [label: "My Adder"]', w);
      expect(result).toEqual({
        instanceId: 'adder1',
        nodeType: 'adder',
        label: 'My Adder',
      });
    });

    it('should parse @node with minimized', () => {
      const result = parseNodeLine('@node adder1 adder [minimized]', w);
      expect(result).toEqual({
        instanceId: 'adder1',
        nodeType: 'adder',
        minimized: true,
      });
    });

    it('should parse @node with size', () => {
      const result = parseNodeLine('@node scope1 ScopedType [size: 500 300]', w);
      expect(result).toEqual({
        instanceId: 'scope1',
        nodeType: 'ScopedType',
        size: { width: 500, height: 300 },
      });
    });

    it('should parse @node with size and minimized', () => {
      const result = parseNodeLine('@node scope1 ScopedType [minimized] [size: 600 400]', w);
      expect(result).toEqual({
        instanceId: 'scope1',
        nodeType: 'ScopedType',
        minimized: true,
        size: { width: 600, height: 400 },
      });
    });

    it('should parse @node with pullExecution triggerPort', () => {
      const result = parseNodeLine('@node adder1 adder [pullExecution: result]', w);
      expect(result).toEqual({
        instanceId: 'adder1',
        nodeType: 'adder',
        pullExecution: 'result',
      });
    });

    it('should parse @node with parentScope', () => {
      const result = parseNodeLine('@node inner1 inner outer1.loop', w);
      expect(result).toEqual({
        instanceId: 'inner1',
        nodeType: 'inner',
        parentScope: 'outer1.loop',
      });
    });

    it('should parse @node with portOrder', () => {
      const result = parseNodeLine('@node doubler Double [portOrder: execute=0,value=1]', w);
      expect(result).toEqual({
        instanceId: 'doubler',
        nodeType: 'Double',
        portOrder: { execute: 0, value: 1 },
      });
    });

    it('should parse @node with portLabel', () => {
      const result = parseNodeLine('@node myNode Type [portLabel: input="Custom Input"]', w);
      expect(result).toEqual({
        instanceId: 'myNode',
        nodeType: 'Type',
        portLabel: { input: 'Custom Input' },
      });
    });

    it('should parse @node with multiple portLabels', () => {
      const result = parseNodeLine('@node myNode Type [portLabel: a="First", b="Second"]', w);
      expect(result).toEqual({
        instanceId: 'myNode',
        nodeType: 'Type',
        portLabel: { a: 'First', b: 'Second' },
      });
    });

    it('should parse @node with portOrder and portLabel', () => {
      const result = parseNodeLine(
        '@node myNode Type [portOrder: a=0,b=1] [portLabel: a="Alpha", b="Beta"]',
        w
      );
      expect(result).toEqual({
        instanceId: 'myNode',
        nodeType: 'Type',
        portOrder: { a: 0, b: 1 },
        portLabel: { a: 'Alpha', b: 'Beta' },
      });
    });

    it('should parse @node with portLabel containing escaped quotes', () => {
      const result = parseNodeLine(
        '@node myNode Type [portLabel: name="Value \\"with quotes\\""]',
        w
      );
      expect(result).toEqual({
        instanceId: 'myNode',
        nodeType: 'Type',
        portLabel: { name: 'Value "with quotes"' },
      });
    });

    it('should parse @node with parentScope and attributes', () => {
      const result = parseNodeLine('@node inner1 inner outer1.loop [label: "Inner"]', w);
      expect(result).toEqual({
        instanceId: 'inner1',
        nodeType: 'inner',
        parentScope: 'outer1.loop',
        label: 'Inner',
      });
    });
  });

  describe('@node with expressions', () => {
    it('should parse @node with single expr', () => {
      const result = parseNodeLine('@node myNode type [expr: value="20"]', w);
      expect(result).toEqual({
        instanceId: 'myNode',
        nodeType: 'type',
        expressions: { value: '20' },
      });
    });

    it('should parse @node with multiple expressions', () => {
      const result = parseNodeLine('@node calc adder [expr: a="5", b="10"]', w);
      expect(result).toEqual({
        instanceId: 'calc',
        nodeType: 'adder',
        expressions: { a: '5', b: '10' },
      });
    });

    it('should parse @node with label and expr', () => {
      const result = parseNodeLine('@node n1 type [label: "Node", expr: x="1"]', w);
      expect(result).toEqual({
        instanceId: 'n1',
        nodeType: 'type',
        label: 'Node',
        expressions: { x: '1' },
      });
    });

    it('should parse @node with escaped quotes in expr', () => {
      const result = parseNodeLine('@node n1 type [expr: name="foo\\"bar"]', w);
      expect(result).toEqual({
        instanceId: 'n1',
        nodeType: 'type',
        expressions: { name: 'foo"bar' },
      });
    });

    it('should parse @node with escaped JSDoc comment closer (*/) in expr', () => {
      // *\/ is the escaped form of */ to avoid closing the JSDoc comment
      const result = parseNodeLine('@node n1 type [expr: msg="hello *\\/ world"]', w);
      expect(result).toEqual({
        instanceId: 'n1',
        nodeType: 'type',
        expressions: { msg: 'hello */ world' },
      });
    });

    it('should parse @node with expression containing **/ pattern', () => {
      // The escaped form **\/ should be unescaped to **/
      const result = parseNodeLine('@node n1 type [expr: val="**\\/"]', w);
      expect(result).toEqual({
        instanceId: 'n1',
        nodeType: 'type',
        expressions: { val: '**/' },
      });
    });

    it('should parse @node with nested single quotes in expr value', () => {
      const result = parseNodeLine(
        `@node wait waitForEvent [expr: eventName="'app/expense.approved'", timeout="'48h'"]`,
        w
      );
      expect(w).toHaveLength(0);
      expect(result).toEqual({
        instanceId: 'wait',
        nodeType: 'waitForEvent',
        expressions: { eventName: "'app/expense.approved'", timeout: "'48h'" },
      });
    });

    it('should parse @node with three nested-quote expr values', () => {
      const result = parseNodeLine(
        `@node wait waitForEvent [expr: eventName="'app/expense.approved'", match="'data.expenseId'", timeout="'48h'"]`,
        w
      );
      expect(w).toHaveLength(0);
      expect(result).toEqual({
        instanceId: 'wait',
        nodeType: 'waitForEvent',
        expressions: {
          eventName: "'app/expense.approved'",
          match: "'data.expenseId'",
          timeout: "'48h'",
        },
      });
    });
  });

  describe('Instance visual overrides', () => {
    it('should parse @node with color', () => {
      const result = parseNodeLine('@node n1 Type [color: "blue"]', w);
      expect(result).toEqual({
        instanceId: 'n1',
        nodeType: 'Type',
        color: 'blue',
      });
    });

    it('should parse @node with icon', () => {
      const result = parseNodeLine('@node n1 Type [icon: "settings"]', w);
      expect(result).toEqual({
        instanceId: 'n1',
        nodeType: 'Type',
        icon: 'settings',
      });
    });

    it('should parse @node with single tag', () => {
      const result = parseNodeLine('@node n1 Type [tags: "async"]', w);
      expect(result).toEqual({
        instanceId: 'n1',
        nodeType: 'Type',
        tags: [{ label: 'async' }],
      });
    });

    it('should parse @node with tag with tooltip', () => {
      const result = parseNodeLine('@node n1 Type [tags: "async" "Runs async"]', w);
      expect(result).toEqual({
        instanceId: 'n1',
        nodeType: 'Type',
        tags: [{ label: 'async', tooltip: 'Runs async' }],
      });
    });

    it('should parse @node with multiple tags', () => {
      const result = parseNodeLine('@node n1 Type [tags: "a", "b" "Tooltip"]', w);
      expect(result).toEqual({
        instanceId: 'n1',
        nodeType: 'Type',
        tags: [{ label: 'a' }, { label: 'b', tooltip: 'Tooltip' }],
      });
    });

    it('should parse @node with combined visual attributes', () => {
      const result = parseNodeLine(
        '@node n1 Type [label: "Name", color: "blue", icon: "star", tags: "v2"]',
        w
      );
      expect(result).toEqual({
        instanceId: 'n1',
        nodeType: 'Type',
        label: 'Name',
        color: 'blue',
        icon: 'star',
        tags: [{ label: 'v2' }],
      });
    });

    it('should parse @node with visual attributes in separate brackets', () => {
      const result = parseNodeLine(
        '@node n1 Type [color: "purple"] [icon: "cloud"] [tags: "beta"]',
        w
      );
      expect(result).toEqual({
        instanceId: 'n1',
        nodeType: 'Type',
        color: 'purple',
        icon: 'cloud',
        tags: [{ label: 'beta' }],
      });
    });
  });

  describe('Edge cases', () => {
    it('should return null for non-node lines', () => {
      expect(parseNodeLine('@input myPort', w)).toBeNull();
      expect(parseNodeLine('@connect A.x -> B.y', w)).toBeNull();
      expect(parseNodeLine('just some text', w)).toBeNull();
    });

    it('should handle whitespace variations', () => {
      const result = parseNodeLine('@node   adder1   adder', w);
      expect(result?.instanceId).toBe('adder1');
      expect(result?.nodeType).toBe('adder');
    });
  });
});
