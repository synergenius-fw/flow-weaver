/**
 * Coverage for annotation-generator.ts:
 * - Line 491: required port with default value (non-optional)
 * - Line 511: port with placement metadata
 * - Line 515: port with expression
 * - Line 732: instance with size (width/height) config
 */
import { describe, it, expect } from 'vitest';
import { generateJSDocPortTag, generateNodeInstanceTag } from '../../src/annotation-generator';
import type { TPortDefinition, TNodeInstanceAST } from '../../src/ast/types';

describe('generateJSDocPortTag: uncovered branches', () => {
  it('should format a required port with a default value (non-optional)', () => {
    const port: TPortDefinition = {
      dataType: 'NUMBER',
      optional: false,
      default: 42,
    };
    const result = generateJSDocPortTag('threshold', port, 'input');
    expect(result).toBe('@input threshold=42');
  });

  it('should include placement metadata', () => {
    const port: TPortDefinition = {
      dataType: 'STRING',
      metadata: { placement: 'left' },
    };
    const result = generateJSDocPortTag('label', port, 'input');
    expect(result).toContain('[placement:left]');
  });

  it('should include expression annotation', () => {
    const port: TPortDefinition = {
      dataType: 'STRING',
      expression: '(ctx) => ctx.name',
    };
    const result = generateJSDocPortTag('computed', port, 'output');
    expect(result).toContain('- Expression: (ctx) => ctx.name');
  });

  it('should include both order and placement metadata', () => {
    const port: TPortDefinition = {
      dataType: 'NUMBER',
      metadata: { order: 2, placement: 'right' },
    };
    const result = generateJSDocPortTag('value', port, 'output');
    expect(result).toContain('[order:2]');
    expect(result).toContain('[placement:right]');
  });
});

describe('generateNodeInstanceTag: size attribute', () => {
  it('should generate [size: w h] when width and height are set', () => {
    const instance: TNodeInstanceAST = {
      type: 'NodeInstance',
      id: 'myNode',
      nodeType: 'MyType',
      config: {
        width: 200.7,
        height: 150.3,
      },
    };

    const result = generateNodeInstanceTag(instance);
    expect(result).toContain('[size: 201 150]');
  });
});
