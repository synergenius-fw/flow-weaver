import {
  getFlowWeaverCompletions,
  WorkflowContext,
  JSDOC_ANNOTATIONS,
} from '../../../src/editor-completions';
import { getAnnotationValueCompletions } from '../../../src/editor-completions/annotationValues';
import {
  getModifierCompletions,
  getModifierValueCompletions,
} from '../../../src/editor-completions/modifierCompletions';

describe('getFlowWeaverCompletions', () => {
  describe('annotation completions', () => {
    it('should return annotations when typing @', () => {
      const result = getFlowWeaverCompletions(' * @', 4, true);
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((c) => c.label === '@flowWeaver')).toBe(true);
      expect(result.some((c) => c.label === '@input')).toBe(true);
      expect(result.some((c) => c.label === '@output')).toBe(true);
    });

    it('should return all 23 annotations when no prefix', () => {
      const result = getFlowWeaverCompletions(' * @', 4, true);
      expect(result.length).toBe(JSDOC_ANNOTATIONS.length);
    });

    it('should filter annotations by prefix', () => {
      const result = getFlowWeaverCompletions(' * @inp', 7, true);
      expect(result.length).toBe(1);
      expect(result[0].label).toBe('@input');
    });

    it('should return empty when not in JSDoc', () => {
      const result = getFlowWeaverCompletions(' * @', 4, false);
      expect(result).toEqual([]);
    });

    it('should include new annotations', () => {
      const result = getFlowWeaverCompletions(' * @', 4, true);
      expect(result.some((c) => c.label === '@name')).toBe(true);
      expect(result.some((c) => c.label === '@description')).toBe(true);
      expect(result.some((c) => c.label === '@color')).toBe(true);
      expect(result.some((c) => c.label === '@icon')).toBe(true);
      expect(result.some((c) => c.label === '@tag')).toBe(true);
      expect(result.some((c) => c.label === '@expression')).toBe(true);
      expect(result.some((c) => c.label === '@pullExecution')).toBe(true);
      expect(result.some((c) => c.label === '@executeWhen')).toBe(true);
      expect(result.some((c) => c.label === '@fwImport')).toBe(true);
      expect(result.some((c) => c.label === '@strictTypes')).toBe(true);
      expect(result.some((c) => c.label === '@port')).toBe(true);
    });

    it('should filter annotations by block type (workflow)', () => {
      const precedingLines = ['/**', ' * @flowWeaver workflow'];
      const result = getFlowWeaverCompletions(' * @', 4, true, undefined, precedingLines);
      // Should include workflow-only annotations like @node, @connect
      expect(result.some((c) => c.label === '@node')).toBe(true);
      expect(result.some((c) => c.label === '@connect')).toBe(true);
      // Should NOT include nodeType-only annotations
      expect(result.some((c) => c.label === '@input')).toBe(false);
      expect(result.some((c) => c.label === '@output')).toBe(false);
      expect(result.some((c) => c.label === '@expression')).toBe(false);
      // Should include annotations valid in both contexts
      expect(result.some((c) => c.label === '@label')).toBe(true);
      expect(result.some((c) => c.label === '@param')).toBe(true);
    });

    it('should filter annotations by block type (nodeType)', () => {
      const precedingLines = ['/**', ' * @flowWeaver nodeType'];
      const result = getFlowWeaverCompletions(' * @', 4, true, undefined, precedingLines);
      // Should include nodeType-only annotations like @input, @output
      expect(result.some((c) => c.label === '@input')).toBe(true);
      expect(result.some((c) => c.label === '@output')).toBe(true);
      expect(result.some((c) => c.label === '@expression')).toBe(true);
      // Should NOT include workflow-only annotations
      expect(result.some((c) => c.label === '@node')).toBe(false);
      expect(result.some((c) => c.label === '@connect')).toBe(false);
      expect(result.some((c) => c.label === '@position')).toBe(false);
      // Should include annotations valid in both contexts
      expect(result.some((c) => c.label === '@label')).toBe(true);
    });
  });

  describe('dataType completions', () => {
    it('should return types when typing in braces after @input', () => {
      const result = getFlowWeaverCompletions(' * @input {', 11, true);
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((c) => c.label === 'String')).toBe(true);
      expect(result.some((c) => c.label === 'Number')).toBe(true);
      expect(result.some((c) => c.label === 'STEP')).toBe(true);
    });

    it('should filter types by prefix', () => {
      const result = getFlowWeaverCompletions(' * @input {Str', 14, true);
      expect(result.length).toBe(1);
      expect(result[0].label).toBe('String');
    });

    it('should work with @output too', () => {
      const result = getFlowWeaverCompletions(' * @output {Num', 15, true);
      expect(result.length).toBe(1);
      expect(result[0].label).toBe('Number');
    });
  });

  describe('nodeType completions', () => {
    const context: WorkflowContext = {
      nodeTypes: {
        MyAdder: {
          name: 'MyAdder',
          category: 'Math',
          description: 'Adds two numbers',
          ports: [],
        },
        MyMultiplier: {
          name: 'MyMultiplier',
          category: 'Math',
          ports: [],
        },
        Logger: {
          name: 'Logger',
          category: 'Utility',
          ports: [],
        },
      },
    };

    it('should return nodeTypes after @node nodeId', () => {
      const result = getFlowWeaverCompletions(' * @node add1 ', 14, true, context);
      expect(result.length).toBe(3);
      expect(result.some((c) => c.label === 'MyAdder')).toBe(true);
    });

    it('should filter nodeTypes by prefix', () => {
      const result = getFlowWeaverCompletions(' * @node add1 My', 16, true, context);
      expect(result.length).toBe(2);
      expect(result.every((c) => c.label.startsWith('My'))).toBe(true);
    });

    it('should return empty without context', () => {
      const result = getFlowWeaverCompletions(' * @node add1 ', 14, true);
      expect(result).toEqual([]);
    });
  });

  describe('nodeId completions', () => {
    const context: WorkflowContext = {
      nodeTypes: {},
      instances: [
        { id: 'adder1', nodeType: 'MyAdder' },
        { id: 'adder2', nodeType: 'MyAdder' },
        { id: 'logger1', nodeType: 'Logger' },
      ],
    };

    it('should return node IDs after @connect', () => {
      const result = getFlowWeaverCompletions(' * @connect ', 12, true, context);
      expect(result.length).toBe(3);
      expect(result.some((c) => c.label === 'adder1')).toBe(true);
    });

    it('should filter node IDs by prefix', () => {
      const result = getFlowWeaverCompletions(' * @connect add', 15, true, context);
      expect(result.length).toBe(2);
      expect(result.every((c) => c.label.startsWith('add'))).toBe(true);
    });

    it('should return node IDs for target after ->', () => {
      const result = getFlowWeaverCompletions(' * @connect source.out -> log', 29, true, context);
      expect(result.length).toBe(1);
      expect(result[0].label).toBe('logger1');
    });
  });

  describe('port completions', () => {
    const context: WorkflowContext = {
      nodeTypes: {
        MyAdder: {
          name: 'MyAdder',
          ports: [
            { name: 'execute', direction: 'INPUT', dataType: 'STEP' },
            { name: 'a', direction: 'INPUT', dataType: 'Number' },
            { name: 'b', direction: 'INPUT', dataType: 'Number' },
            { name: 'onSuccess', direction: 'OUTPUT', dataType: 'STEP' },
            { name: 'result', direction: 'OUTPUT', dataType: 'Number' },
          ],
        },
      },
      instances: [{ id: 'adder1', nodeType: 'MyAdder' }],
    };

    it('should return output ports for source (before ->)', () => {
      const result = getFlowWeaverCompletions(' * @connect adder1.', 19, true, context);
      expect(result.length).toBe(2);
      expect(result.some((c) => c.label === 'onSuccess')).toBe(true);
      expect(result.some((c) => c.label === 'result')).toBe(true);
    });

    it('should return input ports for target (after ->)', () => {
      const result = getFlowWeaverCompletions(
        ' * @connect source.out -> adder1.',
        33,
        true,
        context
      );
      expect(result.length).toBe(3);
      expect(result.some((c) => c.label === 'execute')).toBe(true);
      expect(result.some((c) => c.label === 'a')).toBe(true);
      expect(result.some((c) => c.label === 'b')).toBe(true);
    });

    it('should filter ports by prefix', () => {
      const result = getFlowWeaverCompletions(
        ' * @connect source.out -> adder1.ex',
        35,
        true,
        context
      );
      expect(result.length).toBe(1);
      expect(result[0].label).toBe('execute');
    });

    it('should return empty for unknown node', () => {
      const result = getFlowWeaverCompletions(' * @connect unknown.', 20, true, context);
      expect(result).toEqual([]);
    });

    it('should sort type-matching ports first when completing target', () => {
      const typeContext: WorkflowContext = {
        nodeTypes: {
          Sender: {
            name: 'Sender',
            ports: [
              { name: 'onSuccess', direction: 'OUTPUT', dataType: 'STEP' },
              { name: 'data', direction: 'OUTPUT', dataType: 'String' },
            ],
          },
          Receiver: {
            name: 'Receiver',
            ports: [
              { name: 'execute', direction: 'INPUT', dataType: 'STEP' },
              { name: 'count', direction: 'INPUT', dataType: 'Number' },
              { name: 'text', direction: 'INPUT', dataType: 'String' },
            ],
          },
        },
        instances: [
          { id: 'sender1', nodeType: 'Sender' },
          { id: 'recv1', nodeType: 'Receiver' },
        ],
      };

      const result = getFlowWeaverCompletions(
        ' * @connect sender1.data -> recv1.',
        34,
        true,
        typeContext
      );
      expect(result.length).toBe(3);
      // String-typed port should sort first
      expect(result[0].label).toBe('text');
    });

    it('should demote already-connected ports', () => {
      const connContext: WorkflowContext = {
        nodeTypes: {
          Receiver: {
            name: 'Receiver',
            ports: [
              { name: 'execute', direction: 'INPUT', dataType: 'STEP' },
              { name: 'a', direction: 'INPUT', dataType: 'Number' },
              { name: 'b', direction: 'INPUT', dataType: 'Number' },
            ],
          },
        },
        instances: [{ id: 'recv1', nodeType: 'Receiver' }],
        connections: [
          { sourceNode: 'src', sourcePort: 'out', targetNode: 'recv1', targetPort: 'a' },
        ],
      };

      const result = getFlowWeaverCompletions(
        ' * @connect src.out -> recv1.',
        29,
        true,
        connContext
      );
      expect(result.length).toBe(3);
      // 'a' is already connected, should be last
      const aCompletion = result.find((c) => c.label === 'a');
      expect(aCompletion?.detail).toContain('(connected)');
      expect(result[result.length - 1].label).toBe('a');
    });
  });

  describe('annotation value completions', () => {
    it('should return @executeWhen values', () => {
      const result = getFlowWeaverCompletions(' * @executeWhen ', 16, true);
      expect(result.length).toBe(3);
      expect(result.some((c) => c.label === 'CONJUNCTION')).toBe(true);
      expect(result.some((c) => c.label === 'DISJUNCTION')).toBe(true);
      expect(result.some((c) => c.label === 'CUSTOM')).toBe(true);
    });

    it('should filter @executeWhen values by prefix', () => {
      const result = getFlowWeaverCompletions(' * @executeWhen CON', 19, true);
      expect(result.length).toBe(1);
      expect(result[0].label).toBe('CONJUNCTION');
    });

    it('should return @flowWeaver values', () => {
      const result = getFlowWeaverCompletions(' * @flowWeaver ', 15, true);
      expect(result.length).toBe(2);
      expect(result.some((c) => c.label === 'workflow')).toBe(true);
      expect(result.some((c) => c.label === 'nodeType')).toBe(true);
    });

    it('should return @color values', () => {
      const result = getFlowWeaverCompletions(' * @color ', 10, true);
      expect(result.length).toBe(9);
      expect(result.some((c) => c.label === 'purple')).toBe(true);
      expect(result.some((c) => c.label === 'blue')).toBe(true);
      expect(result.some((c) => c.label === 'cyan')).toBe(true);
    });

    it('should filter @color values by prefix', () => {
      const result = getFlowWeaverCompletions(' * @color pur', 13, true);
      expect(result.length).toBe(1);
      expect(result[0].label).toBe('purple');
    });
  });

  describe('modifier completions', () => {
    it('should return modifier completions after [', () => {
      const result = getFlowWeaverCompletions(' * @input {String} name [', 25, true);
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((c) => c.label === 'placement')).toBe(true);
      expect(result.some((c) => c.label === 'order')).toBe(true);
      expect(result.some((c) => c.label === 'hidden')).toBe(true);
    });

    it('should filter modifier completions by prefix', () => {
      const result = getFlowWeaverCompletions(' * @input {String} name [plac', 29, true);
      expect(result.length).toBe(1);
      expect(result[0].label).toBe('placement');
    });

    it('should return modifier value completions', () => {
      const result = getFlowWeaverCompletions(' * @input {String} name [placement:', 35, true);
      expect(result.length).toBe(2);
      expect(result.some((c) => c.label === 'TOP')).toBe(true);
      expect(result.some((c) => c.label === 'BOTTOM')).toBe(true);
    });

    it('should filter modifier value by prefix', () => {
      const result = getFlowWeaverCompletions(' * @input {String} name [placement:TO', 37, true);
      expect(result.length).toBe(1);
      expect(result[0].label).toBe('TOP');
    });

    it('should return boolean values for hidden modifier', () => {
      const result = getFlowWeaverCompletions(' * @input {String} name [hidden:', 32, true);
      expect(result.length).toBe(2);
      expect(result.some((c) => c.label === 'true')).toBe(true);
      expect(result.some((c) => c.label === 'false')).toBe(true);
    });
  });
});

describe('getAnnotationValueCompletions', () => {
  it('should return empty for unknown annotation', () => {
    const result = getAnnotationValueCompletions('@unknown', '');
    expect(result).toEqual([]);
  });

  it('should return @executeWhen values', () => {
    const result = getAnnotationValueCompletions('@executeWhen', '');
    expect(result.length).toBe(3);
  });

  it('should filter by prefix', () => {
    const result = getAnnotationValueCompletions('@executeWhen', 'DIS');
    expect(result.length).toBe(1);
    expect(result[0].label).toBe('DISJUNCTION');
  });
});

describe('getModifierCompletions', () => {
  it('should return all modifiers when no annotation context', () => {
    const result = getModifierCompletions(null, '');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should filter by annotation context', () => {
    const inputResult = getModifierCompletions('@input', '');
    const nodeResult = getModifierCompletions('@node', '');
    // @input modifiers should include placement, order, etc.
    expect(inputResult.some((c) => c.label === 'placement')).toBe(true);
    expect(inputResult.some((c) => c.label === 'order')).toBe(true);
    // @node modifiers should include size, portOrder, etc.
    expect(nodeResult.some((c) => c.label === 'size')).toBe(true);
    expect(nodeResult.some((c) => c.label === 'portOrder')).toBe(true);
  });

  it('should filter by prefix', () => {
    const result = getModifierCompletions('@input', 'plac');
    expect(result.length).toBe(1);
    expect(result[0].label).toBe('placement');
  });
});

describe('getModifierValueCompletions', () => {
  it('should return placement values', () => {
    const result = getModifierValueCompletions('placement', '');
    expect(result.length).toBe(2);
    expect(result.some((c) => c.label === 'TOP')).toBe(true);
    expect(result.some((c) => c.label === 'BOTTOM')).toBe(true);
  });

  it('should return boolean values for hidden', () => {
    const result = getModifierValueCompletions('hidden', '');
    expect(result.length).toBe(2);
  });

  it('should return empty for unknown modifier', () => {
    const result = getModifierValueCompletions('unknown', '');
    expect(result).toEqual([]);
  });

  it('should filter by prefix', () => {
    const result = getModifierValueCompletions('placement', 'TO');
    expect(result.length).toBe(1);
    expect(result[0].label).toBe('TOP');
  });
});
