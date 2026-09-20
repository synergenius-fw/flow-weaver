/**
 * Tests for annotation-generator.ts
 * Ensures proper escaping of special characters in generated JSDoc annotations.
 */

import { generateNodeInstanceTag, annotationGenerator } from '../../src/annotation-generator';
import { parseNodeLine } from '../../src/chevrotain-parser/node-parser';
import { tagHandlerRegistry } from '../../src/parser/tag-registry';
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

    it('should preserve [job:] attribute after round-trip', () => {
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'build',
        nodeType: 'npmBuild',
        job: 'build',
      };

      const generated = generateNodeInstanceTag(instance);
      expect(generated).toContain('[job: "build"]');

      const parsed = parseNodeLine(generated.replace(' * ', ''), w);
      expect(parsed?.job).toBe('build');
    });

    it('should preserve [environment:] attribute after round-trip', () => {
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'deploy',
        nodeType: 'deploySsh',
        environment: 'production',
      };

      const generated = generateNodeInstanceTag(instance);
      expect(generated).toContain('[environment: "production"]');

      const parsed = parseNodeLine(generated.replace(' * ', ''), w);
      expect(parsed?.environment).toBe('production');
    });

    it('should preserve [job:] alongside other attributes', () => {
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'test',
        nodeType: 'npmTest',
        job: 'test',
        config: { color: 'teal', icon: 'check_circle', },
      };

      const generated = generateNodeInstanceTag(instance);
      expect(generated).toContain('[job: "test"]');
      expect(generated).toContain('[color: "teal"]');
      expect(generated).toContain('[icon: "check_circle"]');
    });
  });

  describe('CI/CD workflow annotation preservation', () => {
    // Emission is now driven by a pack-registered serializer over
    // options.deploy[namespace] (symmetric with tag parsing). This block
    // registers a cicd serializer that mirrors what the real pack does.
    beforeAll(() => {
      tagHandlerRegistry.registerSerializer('cicd', (data: any) => {
        const out: string[] = [];
        if (Array.isArray(data.triggers)) {
          for (const t of data.triggers) {
            const parts = [String(t.type || '')];
            if (t.branches) parts.push(`branches="${t.branches}"`);
            out.push(` * @trigger ${parts.join(' ')}`);
          }
        }
        if (Array.isArray(data.secrets)) {
          for (const s of data.secrets) {
            let line = ` * @secret ${s.name}`;
            if (s.description) line += ` - ${s.description}`;
            out.push(line);
          }
        }
        if (data.runner) out.push(` * @runner ${data.runner}`);
        if (Array.isArray(data.caches)) {
          for (const c of data.caches) {
            let line = ` * @cache ${c.strategy || 'npm'}`;
            if (c.key) line += ` key="${c.key}"`;
            out.push(line);
          }
        }
        return out;
      });
    });
    afterAll(() => tagHandlerRegistry.registerSerializer('cicd', undefined));

    it('should preserve @secret, @runner, @cache in generated workflow annotation', () => {
      const workflow = {
        name: 'ciPipeline',
        functionName: 'ciPipeline',
        nodeTypes: [],
        instances: [],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        options: {
          deploy: {
            cicd: {
              secrets: [{ name: 'NPM_TOKEN', description: 'NPM auth token' }],
              runner: 'ubuntu-latest',
              caches: [{ strategy: 'npm', key: 'package-lock.json' }],
            },
          },
        },
      } as any;

      const generated = annotationGenerator.generate(workflow);
      expect(generated).toContain('@secret NPM_TOKEN');
      expect(generated).toContain('@runner ubuntu-latest');
      expect(generated).toContain('@cache npm');
      expect(generated).toContain('package-lock.json');
    });

    it('should preserve @trigger push CI/CD style in generated workflow annotation', () => {
      const workflow = {
        name: 'ciPipeline',
        functionName: 'ciPipeline',
        nodeTypes: [],
        instances: [],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        options: {
          deploy: {
            cicd: {
              triggers: [{ type: 'push', branches: 'main' }],
            },
          },
        },
      } as any;

      const generated = annotationGenerator.generate(workflow);
      expect(generated).toContain('@trigger push');
      expect(generated).toContain('branches="main"');
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
