/**
 * Tests for annotation-generator.ts
 * Ensures proper escaping of special characters in generated JSDoc annotations.
 */

import { generateNodeInstanceTag, annotationGenerator } from '../../src/annotation-generator';
import { parseNodeLine } from '../../src/chevrotain-parser/node-parser';
import type { TNodeInstanceAST, TWorkflowAST } from '../../src/ast/types';

const w: string[] = [];

describe('Annotation Generator', () => {
  describe('generateNodeInstanceTag', () => {
    it('should generate basic @node tag', () => {
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'myNode',
        nodeType: 'MyType',
      };

      const result = generateNodeInstanceTag(instance);
      expect(result).toBe(' * @node myNode MyType');
    });

    it('should escape quotes in label', () => {
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'myNode',
        nodeType: 'MyType',
        config: {
          label: 'Say "Hello"',
        },
      };

      const result = generateNodeInstanceTag(instance);
      expect(result).toContain('[label: "Say \\"Hello\\""]');
    });

    it('should escape quotes in expression', () => {
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'myNode',
        nodeType: 'MyType',
        config: {
          portConfigs: [{ portName: 'msg', direction: 'INPUT', expression: '"hello"' }],
        },
      };

      const result = generateNodeInstanceTag(instance);
      expect(result).toContain('[expr: msg="\\"hello\\""]');
    });

    it('should escape */ in expression to avoid closing JSDoc comment', () => {
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'myNode',
        nodeType: 'MyType',
        config: {
          portConfigs: [{ portName: 'msg', direction: 'INPUT', expression: 'hello */ world' }],
        },
      };

      const result = generateNodeInstanceTag(instance);
      // */ should be escaped as *\/
      expect(result).toContain('[expr: msg="hello *\\/ world"]');
      // Should NOT contain unescaped */
      expect(result).not.toMatch(/\*\/(?!\\)/);
    });

    it('should escape **/ pattern in expression', () => {
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'myNode',
        nodeType: 'MyType',
        config: {
          portConfigs: [{ portName: 'val', direction: 'INPUT', expression: '**/' }],
        },
      };

      const result = generateNodeInstanceTag(instance);
      // **/ should become **\/
      expect(result).toContain('[expr: val="**\\/"]');
    });

    it('should escape both quotes and */ in expression', () => {
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'myNode',
        nodeType: 'MyType',
        config: {
          portConfigs: [{ portName: 'msg', direction: 'INPUT', expression: 'say "hello" */ done' }],
        },
      };

      const result = generateNodeInstanceTag(instance);
      expect(result).toContain('[expr: msg="say \\"hello\\" *\\/ done"]');
    });
  });

  describe('Round-trip: generate -> parse', () => {
    it('should preserve expression with */ after round-trip', () => {
      const originalExpression = 'hello */ world';
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'myNode',
        nodeType: 'MyType',
        config: {
          portConfigs: [{ portName: 'msg', direction: 'INPUT', expression: originalExpression }],
        },
      };

      // Generate the @node tag (with escaping)
      const generated = generateNodeInstanceTag(instance);

      // Parse it back (with unescaping)
      const parsed = parseNodeLine(generated.replace(' * ', ''), w);

      // Verify the expression is preserved exactly
      expect(parsed?.expressions?.msg).toBe(originalExpression);
    });

    it('should preserve expression with **/ after round-trip', () => {
      const originalExpression = '**/';
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'myNode',
        nodeType: 'MyType',
        config: {
          portConfigs: [{ portName: 'val', direction: 'INPUT', expression: originalExpression }],
        },
      };

      const generated = generateNodeInstanceTag(instance);
      const parsed = parseNodeLine(generated.replace(' * ', ''), w);

      expect(parsed?.expressions?.val).toBe(originalExpression);
    });

    it('should preserve complex expression with quotes and */ after round-trip', () => {
      const originalExpression = 'userMessage="**/"';
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'myNode',
        nodeType: 'MyType',
        config: {
          portConfigs: [{ portName: 'data', direction: 'INPUT', expression: originalExpression }],
        },
      };

      const generated = generateNodeInstanceTag(instance);
      const parsed = parseNodeLine(generated.replace(' * ', ''), w);

      expect(parsed?.expressions?.data).toBe(originalExpression);
    });

    it('should preserve color after round-trip', () => {
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'myNode',
        nodeType: 'MyType',
        config: { color: 'blue' },
      };

      const generated = generateNodeInstanceTag(instance);
      const parsed = parseNodeLine(generated.replace(' * ', ''), w);

      expect(parsed?.color).toBe('blue');
    });

    it('should preserve icon after round-trip', () => {
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'myNode',
        nodeType: 'MyType',
        config: { icon: 'star' },
      };

      const generated = generateNodeInstanceTag(instance);
      const parsed = parseNodeLine(generated.replace(' * ', ''), w);

      expect(parsed?.icon).toBe('star');
    });

    it('should preserve tags after round-trip', () => {
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'myNode',
        nodeType: 'MyType',
        config: {
          tags: [
            { label: 'async', tooltip: 'Runs asynchronously' },
            { label: 'v2' },
          ],
        },
      };

      const generated = generateNodeInstanceTag(instance);
      const parsed = parseNodeLine(generated.replace(' * ', ''), w);

      expect(parsed?.tags).toEqual([
        { label: 'async', tooltip: 'Runs asynchronously' },
        { label: 'v2' },
      ]);
    });

    it('should preserve combined color, icon, and tags after round-trip', () => {
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'myNode',
        nodeType: 'MyType',
        config: {
          color: 'purple',
          icon: 'cloud',
          tags: [{ label: 'beta' }],
        },
      };

      const generated = generateNodeInstanceTag(instance);
      const parsed = parseNodeLine(generated.replace(' * ', ''), w);

      expect(parsed?.color).toBe('purple');
      expect(parsed?.icon).toBe('cloud');
      expect(parsed?.tags).toEqual([{ label: 'beta' }]);
    });

    it('should emit [position: x y] on @node when position is set', () => {
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'myNode',
        nodeType: 'MyType',
        config: { x: 270, y: 0 },
      };

      const generated = generateNodeInstanceTag(instance);
      expect(generated).toContain('[position: 270 0]');
      expect(generated).not.toContain('@position');
    });

    it('should round-trip [position:] on @node', () => {
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'validator',
        nodeType: 'Validator',
        config: { x: 100, y: -50 },
      };

      const generated = generateNodeInstanceTag(instance);
      expect(generated).toContain('[position: 100 -50]');

      const parsed = parseNodeLine(generated.replace(' * ', ''), w);
      expect(parsed?.position).toEqual({ x: 100, y: -50 });
    });

    it('should not emit [position:] when position is not set', () => {
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'myNode',
        nodeType: 'MyType',
        config: {},
      };

      const generated = generateNodeInstanceTag(instance);
      expect(generated).not.toContain('position');
    });

    it('should preserve pullExecution on instance after round-trip', () => {
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'myNode',
        nodeType: 'MyType',
        config: {
          pullExecution: { triggerPort: 'execute' },
        },
      };

      const generated = generateNodeInstanceTag(instance);
      expect(generated).toContain('[pullExecution: execute]');

      const parsed = parseNodeLine(generated.replace(' * ', ''), w);
      expect(parsed?.pullExecution).toBe('execute');
    });
  });

  describe('Node type @pullExecution preservation', () => {
    it('should include @pullExecution in generated node type JSDoc', () => {
      const workflow: TWorkflowAST = {
        type: 'Workflow',
        name: 'testWorkflow',
        functionName: 'testWorkflow',
        sourceFile: 'test.ts',
        imports: [],
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'triple',
            functionName: 'triple',
            expression: true,
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
            defaultConfig: {
              pullExecution: { triggerPort: 'execute' },
            },
            inputs: {
              execute: { dataType: 'STEP' },
              value: { dataType: 'NUMBER' },
            },
            outputs: {
              onSuccess: { dataType: 'STEP' },
              onFailure: { dataType: 'STEP' },
              tripled: { dataType: 'NUMBER' },
            },
          },
        ],
        instances: [
          { type: 'NodeInstance', id: 'triple', nodeType: 'triple' },
        ],
        connections: [],
        startPorts: { execute: { dataType: 'STEP' }, value: { dataType: 'NUMBER' } },
        exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, tripled: { dataType: 'NUMBER' } },
      };

      const generated = annotationGenerator.generate(workflow);
      expect(generated).toContain('@pullExecution execute');
    });
  });
});
