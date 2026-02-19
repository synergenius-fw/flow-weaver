import {
  parseCompletionContext,
  getWordAtPosition,
  detectSymbolType,
  detectBlockType,
} from '../../../src/editor-completions/contextParser';

describe('parseCompletionContext', () => {
  describe('annotation context', () => {
    it('should detect @ at start of line', () => {
      const result = parseCompletionContext(' * @', 4, true);
      expect(result).toEqual({
        type: 'annotation',
        lineText: ' * @',
        cursorOffset: 4,
        prefix: '',
        blockType: null,
      });
    });

    it('should detect partial annotation', () => {
      const result = parseCompletionContext(' * @inp', 7, true);
      expect(result).toEqual({
        type: 'annotation',
        lineText: ' * @inp',
        cursorOffset: 7,
        prefix: 'inp',
        blockType: null,
      });
    });

    it('should not detect outside JSDoc', () => {
      const result = parseCompletionContext(' * @inp', 7, false);
      expect(result).toBeNull();
    });
  });

  describe('dataType context', () => {
    it('should detect opening brace after @input', () => {
      const result = parseCompletionContext(' * @input {', 11, true);
      expect(result).toEqual({
        type: 'dataType',
        lineText: ' * @input {',
        cursorOffset: 11,
        prefix: '',
        blockType: null,
      });
    });

    it('should detect partial type after @input', () => {
      const result = parseCompletionContext(' * @input {Str', 14, true);
      expect(result).toEqual({
        type: 'dataType',
        lineText: ' * @input {Str',
        cursorOffset: 14,
        prefix: 'Str',
        blockType: null,
      });
    });

    it('should detect opening brace after @output', () => {
      const result = parseCompletionContext(' * @output {', 12, true);
      expect(result).toEqual({
        type: 'dataType',
        lineText: ' * @output {',
        cursorOffset: 12,
        prefix: '',
        blockType: null,
      });
    });
  });

  describe('nodeType context', () => {
    it('should detect after @node nodeId', () => {
      const result = parseCompletionContext(' * @node myNode ', 16, true);
      expect(result).toEqual({
        type: 'nodeType',
        lineText: ' * @node myNode ',
        cursorOffset: 16,
        prefix: '',
        blockType: null,
      });
    });

    it('should detect partial nodeType', () => {
      const result = parseCompletionContext(' * @node myNode MyN', 19, true);
      expect(result).toEqual({
        type: 'nodeType',
        lineText: ' * @node myNode MyN',
        cursorOffset: 19,
        prefix: 'MyN',
        blockType: null,
      });
    });
  });

  describe('@connect context', () => {
    it('should detect nodeId after @connect', () => {
      const result = parseCompletionContext(' * @connect my', 14, true);
      expect(result).toEqual({
        type: 'nodeId',
        lineText: ' * @connect my',
        cursorOffset: 14,
        prefix: 'my',
        blockType: null,
      });
    });

    it('should detect source port after nodeId.', () => {
      const result = parseCompletionContext(' * @connect source.', 19, true);
      expect(result).toEqual({
        type: 'port',
        lineText: ' * @connect source.',
        cursorOffset: 19,
        prefix: '',
        nodeId: 'source',
        portDirection: 'output',
        blockType: null,
      });
    });

    it('should detect partial source port', () => {
      const result = parseCompletionContext(' * @connect source.out', 22, true);
      expect(result).toEqual({
        type: 'port',
        lineText: ' * @connect source.out',
        cursorOffset: 22,
        prefix: 'out',
        nodeId: 'source',
        portDirection: 'output',
        blockType: null,
      });
    });

    it('should detect target nodeId after ->', () => {
      const result = parseCompletionContext(' * @connect source.out -> tar', 29, true);
      expect(result).toEqual({
        type: 'nodeId',
        lineText: ' * @connect source.out -> tar',
        cursorOffset: 29,
        prefix: 'tar',
        blockType: null,
      });
    });

    it('should detect target port after -> nodeId.', () => {
      const result = parseCompletionContext(' * @connect source.out -> target.', 33, true);
      expect(result).toEqual({
        type: 'port',
        lineText: ' * @connect source.out -> target.',
        cursorOffset: 33,
        prefix: '',
        nodeId: 'target',
        portDirection: 'input',
        blockType: null,
      });
    });

    it('should detect partial target port', () => {
      const result = parseCompletionContext(' * @connect source.out -> target.in', 35, true);
      expect(result).toEqual({
        type: 'port',
        lineText: ' * @connect source.out -> target.in',
        cursorOffset: 35,
        prefix: 'in',
        nodeId: 'target',
        portDirection: 'input',
        blockType: null,
      });
    });
  });

  describe('@path context', () => {
    it('should detect nodeId after @path Start ->', () => {
      const result = parseCompletionContext(' * @path Start -> ', 18, true);
      expect(result).toEqual({
        type: 'nodeId',
        lineText: ' * @path Start -> ',
        cursorOffset: 18,
        prefix: '',
        blockType: null,
      });
    });

    it('should detect partial nodeId in path chain', () => {
      const result = parseCompletionContext(' * @path Start -> nod', 21, true);
      expect(result).toEqual({
        type: 'nodeId',
        lineText: ' * @path Start -> nod',
        cursorOffset: 21,
        prefix: 'nod',
        blockType: null,
      });
    });

    it('should detect nodeId mid-chain', () => {
      const result = parseCompletionContext(' * @path Start -> a -> b -> ', 28, true);
      expect(result).toEqual({
        type: 'nodeId',
        lineText: ' * @path Start -> a -> b -> ',
        cursorOffset: 28,
        prefix: '',
        blockType: null,
      });
    });

    it('should detect nodeId after step with suffix', () => {
      const result = parseCompletionContext(' * @path Start -> validator:ok -> ', 34, true);
      expect(result).toEqual({
        type: 'nodeId',
        lineText: ' * @path Start -> validator:ok -> ',
        cursorOffset: 34,
        prefix: '',
        blockType: null,
      });
    });
  });

  describe('@position context', () => {
    it('should detect nodeId after @position', () => {
      const result = parseCompletionContext(' * @position ', 13, true);
      expect(result).toEqual({
        type: 'nodeId',
        lineText: ' * @position ',
        cursorOffset: 13,
        prefix: '',
        blockType: null,
      });
    });

    it('should detect partial nodeId after @position', () => {
      const result = parseCompletionContext(' * @position my', 15, true);
      expect(result).toEqual({
        type: 'nodeId',
        lineText: ' * @position my',
        cursorOffset: 15,
        prefix: 'my',
        blockType: null,
      });
    });
  });

  describe('@scope context', () => {
    it('should detect nodeId inside @scope brackets', () => {
      const result = parseCompletionContext(' * @scope loop [', 16, true);
      expect(result).toEqual({
        type: 'nodeId',
        lineText: ' * @scope loop [',
        cursorOffset: 16,
        prefix: '',
        blockType: null,
      });
    });

    it('should detect nodeId after comma in @scope brackets', () => {
      const result = parseCompletionContext(' * @scope loop [a, b', 20, true);
      expect(result).toEqual({
        type: 'nodeId',
        lineText: ' * @scope loop [a, b',
        cursorOffset: 20,
        prefix: 'b',
        blockType: null,
      });
    });
  });

  describe('@map context', () => {
    it('should detect nodeId (instance id) after @map', () => {
      const result = parseCompletionContext(' * @map ', 8, true);
      expect(result).toEqual({
        type: 'nodeId',
        lineText: ' * @map ',
        cursorOffset: 8,
        prefix: '',
        blockType: null,
      });
    });

    it('should detect nodeType after @map id', () => {
      const result = parseCompletionContext(' * @map loop Proc', 17, true);
      expect(result).toEqual({
        type: 'nodeType',
        lineText: ' * @map loop Proc',
        cursorOffset: 17,
        prefix: 'Proc',
        blockType: null,
      });
    });

    it('should detect source nodeId after @map id type over', () => {
      const result = parseCompletionContext(' * @map loop Proc over scan', 27, true);
      expect(result).toEqual({
        type: 'nodeId',
        lineText: ' * @map loop Proc over scan',
        cursorOffset: 27,
        prefix: 'scan',
        blockType: null,
      });
    });

    it('should detect output port after @map id type over node.', () => {
      const result = parseCompletionContext(' * @map loop Proc over scan.', 28, true);
      expect(result).toEqual({
        type: 'port',
        lineText: ' * @map loop Proc over scan.',
        cursorOffset: 28,
        prefix: '',
        nodeId: 'scan',
        portDirection: 'output',
        blockType: null,
      });
    });
  });

  describe('annotation value context', () => {
    it('should detect @executeWhen value', () => {
      const result = parseCompletionContext(' * @executeWhen ', 16, true);
      expect(result).toEqual({
        type: 'annotationValue',
        lineText: ' * @executeWhen ',
        cursorOffset: 16,
        prefix: '',
        annotation: '@executeWhen',
        blockType: null,
      });
    });

    it('should detect partial @executeWhen value', () => {
      const result = parseCompletionContext(' * @executeWhen CON', 19, true);
      expect(result).toEqual({
        type: 'annotationValue',
        lineText: ' * @executeWhen CON',
        cursorOffset: 19,
        prefix: 'CON',
        annotation: '@executeWhen',
        blockType: null,
      });
    });

    it('should detect @flowWeaver value', () => {
      const result = parseCompletionContext(' * @flowWeaver work', 19, true);
      expect(result).toEqual({
        type: 'annotationValue',
        lineText: ' * @flowWeaver work',
        cursorOffset: 19,
        prefix: 'work',
        annotation: '@flowWeaver',
        blockType: null,
      });
    });

    it('should detect @color value', () => {
      const result = parseCompletionContext(' * @color pur', 13, true);
      expect(result).toEqual({
        type: 'annotationValue',
        lineText: ' * @color pur',
        cursorOffset: 13,
        prefix: 'pur',
        annotation: '@color',
        blockType: null,
      });
    });
  });

  describe('modifier context', () => {
    it('should detect bracket modifier name', () => {
      const result = parseCompletionContext(' * @input {String} name [', 25, true);
      expect(result).toEqual({
        type: 'modifier',
        lineText: ' * @input {String} name [',
        cursorOffset: 25,
        prefix: '',
        annotation: '@input',
        blockType: null,
      });
    });

    it('should detect partial modifier name', () => {
      const result = parseCompletionContext(' * @input {String} name [plac', 29, true);
      expect(result).toEqual({
        type: 'modifier',
        lineText: ' * @input {String} name [plac',
        cursorOffset: 29,
        prefix: 'plac',
        annotation: '@input',
        blockType: null,
      });
    });

    it('should detect modifier value after colon', () => {
      const result = parseCompletionContext(' * @input {String} name [placement:', 35, true);
      expect(result).toEqual({
        type: 'modifierValue',
        lineText: ' * @input {String} name [placement:',
        cursorOffset: 35,
        prefix: '',
        modifier: 'placement',
        blockType: null,
      });
    });

    it('should detect partial modifier value', () => {
      const result = parseCompletionContext(' * @input {String} name [placement:TO', 37, true);
      expect(result).toEqual({
        type: 'modifierValue',
        lineText: ' * @input {String} name [placement:TO',
        cursorOffset: 37,
        prefix: 'TO',
        modifier: 'placement',
        blockType: null,
      });
    });
  });

  describe('block type detection with preceding lines', () => {
    it('should detect workflow block type', () => {
      const precedingLines = ['/**', ' * @flowWeaver workflow', ' * @node myNode '];
      const result = parseCompletionContext(' * @node myNode ', 16, true, precedingLines);
      expect(result?.blockType).toBe('workflow');
    });

    it('should detect nodeType block type', () => {
      const precedingLines = ['/**', ' * @flowWeaver nodeType', ' * @input {String} name'];
      const result = parseCompletionContext(' * @inp', 7, true, precedingLines);
      expect(result?.blockType).toBe('nodeType');
    });

    it('should detect bare @flowWeaver as workflow', () => {
      const precedingLines = ['/**', ' * @flowWeaver', ' * @node myNode '];
      const result = parseCompletionContext(' * @node myNode ', 16, true, precedingLines);
      expect(result?.blockType).toBe('workflow');
    });

    it('should return null block type when no preceding lines', () => {
      const result = parseCompletionContext(' * @', 4, true);
      expect(result?.blockType).toBeNull();
    });
  });
});

describe('detectBlockType', () => {
  it('should detect workflow', () => {
    expect(detectBlockType([' * @flowWeaver workflow'])).toBe('workflow');
  });

  it('should detect nodeType', () => {
    expect(detectBlockType([' * @flowWeaver nodeType'])).toBe('nodeType');
  });

  it('should detect bare @flowWeaver as workflow', () => {
    expect(detectBlockType([' * @flowWeaver'])).toBe('workflow');
  });

  it('should return null for no @flowWeaver', () => {
    expect(detectBlockType([' * @input {String} name'])).toBeNull();
  });
});

describe('getWordAtPosition', () => {
  it('should get word at start', () => {
    const result = getWordAtPosition('hello world', 2);
    expect(result).toEqual({ word: 'hello', start: 0, end: 5 });
  });

  it('should get word at end', () => {
    const result = getWordAtPosition('hello world', 8);
    expect(result).toEqual({ word: 'world', start: 6, end: 11 });
  });

  it('should return null for whitespace', () => {
    const result = getWordAtPosition('hello world', 5);
    expect(result).toBeNull();
  });

  it('should handle word at exact position', () => {
    const result = getWordAtPosition('@connect source.output', 9);
    expect(result).toEqual({ word: 'source', start: 9, end: 15 });
  });
});

describe('detectSymbolType', () => {
  it('should detect nodeType in @node declaration', () => {
    const result = detectSymbolType(' * @node myNode MyNodeType', 22);
    expect(result).toEqual({ type: 'nodeType', name: 'MyNodeType' });
  });

  it('should detect nodeId after @connect', () => {
    const result = detectSymbolType(' * @connect source.out', 12);
    expect(result).toEqual({ type: 'nodeId', name: 'source' });
  });

  it('should detect port after nodeId.', () => {
    const result = detectSymbolType(' * @connect source.output', 19);
    expect(result).toEqual({ type: 'port', name: 'output', nodeId: 'source' });
  });

  it('should detect nodeId in @path', () => {
    const result = detectSymbolType(' * @path Start -> processor:ok -> Exit', 18);
    expect(result).toEqual({ type: 'nodeId', name: 'processor' });
  });
});
