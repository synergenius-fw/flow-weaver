/**
 * Coverage tests for src/doc-metadata/extractors/annotations.ts
 *
 * Targets the three extractor functions at the bottom of the file (lines 659-675)
 * and ensures all exported arrays are exercised with deeper validation.
 */

import {
  ALL_ANNOTATIONS,
  PORT_MODIFIERS,
  NODE_MODIFIERS,
  CORE_ANNOTATIONS,
  PORT_ANNOTATIONS,
  WORKFLOW_ANNOTATIONS,
  METADATA_ANNOTATIONS,
  STANDARD_ANNOTATIONS,
  PATTERN_ANNOTATIONS,
  extractAnnotations,
  extractPortModifiers,
  extractNodeModifiers,
} from '../../src/doc-metadata/extractors/annotations';

describe('annotations extractors', () => {
  describe('extractAnnotations()', () => {
    it('should return the ALL_ANNOTATIONS array', () => {
      const result = extractAnnotations();
      expect(result).toBe(ALL_ANNOTATIONS);
    });

    it('should return a non-empty array', () => {
      const result = extractAnnotations();
      expect(result.length).toBeGreaterThan(0);
    });

    it('should include annotations from every category group', () => {
      const result = extractAnnotations();
      const categories = new Set(result.map((a) => a.category));
      expect(categories).toContain('marker');
      expect(categories).toContain('port');
      expect(categories).toContain('workflow');
      expect(categories).toContain('metadata');
      expect(categories).toContain('pattern');
      expect(categories).toContain('standard');
    });
  });

  describe('extractPortModifiers()', () => {
    it('should return the PORT_MODIFIERS array', () => {
      const result = extractPortModifiers();
      expect(result).toBe(PORT_MODIFIERS);
    });

    it('should return a non-empty array', () => {
      expect(extractPortModifiers().length).toBeGreaterThan(0);
    });

    it('should contain all expected modifier names', () => {
      const names = extractPortModifiers().map((m) => m.name);
      expect(names).toContain('order');
      expect(names).toContain('placement');
      expect(names).toContain('type');
      expect(names).toContain('hidden');
      expect(names).toContain('optional');
    });
  });

  describe('extractNodeModifiers()', () => {
    it('should return the NODE_MODIFIERS array', () => {
      const result = extractNodeModifiers();
      expect(result).toBe(NODE_MODIFIERS);
    });

    it('should return a non-empty array', () => {
      expect(extractNodeModifiers().length).toBeGreaterThan(0);
    });

    it('should contain all expected modifier names', () => {
      const names = extractNodeModifiers().map((m) => m.name);
      expect(names).toContain('label');
      expect(names).toContain('expr');
      expect(names).toContain('minimized');
      expect(names).toContain('pullExecution');
      expect(names).toContain('portOrder');
      expect(names).toContain('portLabel');
      expect(names).toContain('size');
    });
  });
});

describe('CORE_ANNOTATIONS', () => {
  it('should have exactly 4 core annotations', () => {
    expect(CORE_ANNOTATIONS.length).toBe(4);
  });

  it('all should be in the marker category', () => {
    for (const ann of CORE_ANNOTATIONS) {
      expect(ann.category).toBe('marker');
    }
  });

  it('should include @flowWeaver, @flowWeaver nodeType, workflow, pattern', () => {
    const names = CORE_ANNOTATIONS.map((a) => a.name);
    expect(names).toContain('@flowWeaver');
    expect(names).toContain('@flowWeaver nodeType');
    expect(names).toContain('@flowWeaver workflow');
    expect(names).toContain('@flowWeaver pattern');
  });

  it('all should have plain insertTextFormat', () => {
    for (const ann of CORE_ANNOTATIONS) {
      expect(ann.insertTextFormat).toBe('plain');
    }
  });
});

describe('PORT_ANNOTATIONS', () => {
  it('should have exactly 3 port annotations', () => {
    expect(PORT_ANNOTATIONS.length).toBe(3);
  });

  it('all should be in the port category', () => {
    for (const ann of PORT_ANNOTATIONS) {
      expect(ann.category).toBe('port');
    }
  });

  it('@input and @output should have snippet insertTextFormat', () => {
    const input = PORT_ANNOTATIONS.find((a) => a.name === '@input')!;
    const output = PORT_ANNOTATIONS.find((a) => a.name === '@output')!;
    expect(input.insertTextFormat).toBe('snippet');
    expect(output.insertTextFormat).toBe('snippet');
  });

  it('@input should have examples', () => {
    const input = PORT_ANNOTATIONS.find((a) => a.name === '@input')!;
    expect(input.examples).toBeDefined();
    expect(input.examples!.length).toBeGreaterThan(0);
  });

  it('@output should have examples', () => {
    const output = PORT_ANNOTATIONS.find((a) => a.name === '@output')!;
    expect(output.examples).toBeDefined();
    expect(output.examples!.length).toBeGreaterThan(0);
  });

  it('all port annotations should target nodeType context', () => {
    for (const ann of PORT_ANNOTATIONS) {
      expect(ann.contexts).toContain('nodeType');
    }
  });
});

describe('WORKFLOW_ANNOTATIONS', () => {
  it('all should be in the workflow category', () => {
    for (const ann of WORKFLOW_ANNOTATIONS) {
      expect(ann.category).toBe('workflow');
    }
  });

  it('should include @node, @connect, @path, @map, @fanOut, @fanIn, @coerce, @autoConnect', () => {
    const names = WORKFLOW_ANNOTATIONS.map((a) => a.name);
    expect(names).toContain('@node');
    expect(names).toContain('@connect');
    expect(names).toContain('@path');
    expect(names).toContain('@map');
    expect(names).toContain('@fanOut');
    expect(names).toContain('@fanIn');
    expect(names).toContain('@coerce');
    expect(names).toContain('@autoConnect');
  });

  it('should include trigger/cancelOn/retries/timeout/throttle annotations', () => {
    const names = WORKFLOW_ANNOTATIONS.map((a) => a.name);
    expect(names).toContain('@trigger');
    expect(names).toContain('@cancelOn');
    expect(names).toContain('@retries');
    expect(names).toContain('@timeout');
    expect(names).toContain('@throttle');
  });

  it('@node should have EBNF grammar', () => {
    const node = WORKFLOW_ANNOTATIONS.find((a) => a.name === '@node')!;
    expect(node.ebnf).toBeDefined();
    expect(node.ebnf).toContain('nodeTag');
  });

  it('@connect should have examples', () => {
    const connect = WORKFLOW_ANNOTATIONS.find((a) => a.name === '@connect')!;
    expect(connect.examples).toBeDefined();
    expect(connect.examples!.length).toBeGreaterThan(0);
  });

  it('@autoConnect should have plain insertTextFormat', () => {
    const ac = WORKFLOW_ANNOTATIONS.find((a) => a.name === '@autoConnect')!;
    expect(ac.insertTextFormat).toBe('plain');
  });

  it('@fwImport should target workflow context', () => {
    const fwImport = WORKFLOW_ANNOTATIONS.find((a) => a.name === '@fwImport')!;
    expect(fwImport.contexts).toContain('workflow');
  });

  it('@scope in workflow category should target workflow context', () => {
    const scope = WORKFLOW_ANNOTATIONS.find((a) => a.name === '@scope' && a.category === 'workflow')!;
    expect(scope.contexts).toContain('workflow');
  });
});

describe('METADATA_ANNOTATIONS', () => {
  it('all should be in the metadata category', () => {
    for (const ann of METADATA_ANNOTATIONS) {
      expect(ann.category).toBe('metadata');
    }
  });

  it('should include @name, @label, @description, @scope, @executeWhen', () => {
    const names = METADATA_ANNOTATIONS.map((a) => a.name);
    expect(names).toContain('@name');
    expect(names).toContain('@label');
    expect(names).toContain('@description');
    expect(names).toContain('@scope');
    expect(names).toContain('@executeWhen');
  });

  it('should include @pullExecution, @expression, @strictTypes, @color, @tag, @icon', () => {
    const names = METADATA_ANNOTATIONS.map((a) => a.name);
    expect(names).toContain('@pullExecution');
    expect(names).toContain('@expression');
    expect(names).toContain('@strictTypes');
    expect(names).toContain('@color');
    expect(names).toContain('@tag');
    expect(names).toContain('@icon');
  });

  it('@expression should have plain insertTextFormat', () => {
    const expr = METADATA_ANNOTATIONS.find((a) => a.name === '@expression')!;
    expect(expr.insertTextFormat).toBe('plain');
  });

  it('@strictTypes should have examples', () => {
    const st = METADATA_ANNOTATIONS.find((a) => a.name === '@strictTypes')!;
    expect(st.examples).toBeDefined();
    expect(st.examples!.length).toBeGreaterThan(0);
  });
});

describe('STANDARD_ANNOTATIONS', () => {
  it('should have exactly 2 standard annotations', () => {
    expect(STANDARD_ANNOTATIONS.length).toBe(2);
  });

  it('should include @param and @returns', () => {
    const names = STANDARD_ANNOTATIONS.map((a) => a.name);
    expect(names).toContain('@param');
    expect(names).toContain('@returns');
  });

  it('both should target workflow context', () => {
    for (const ann of STANDARD_ANNOTATIONS) {
      expect(ann.contexts).toContain('workflow');
    }
  });

  it('both should have snippet insertTextFormat', () => {
    for (const ann of STANDARD_ANNOTATIONS) {
      expect(ann.insertTextFormat).toBe('snippet');
    }
  });
});

describe('PATTERN_ANNOTATIONS', () => {
  it('should have exactly 2 pattern annotations', () => {
    expect(PATTERN_ANNOTATIONS.length).toBe(2);
  });

  it('should include @port IN and @port OUT', () => {
    const names = PATTERN_ANNOTATIONS.map((a) => a.name);
    expect(names).toContain('@port IN');
    expect(names).toContain('@port OUT');
  });

  it('both should target pattern context', () => {
    for (const ann of PATTERN_ANNOTATIONS) {
      expect(ann.contexts).toContain('pattern');
    }
  });

  it('both should have examples', () => {
    for (const ann of PATTERN_ANNOTATIONS) {
      expect(ann.examples).toBeDefined();
      expect(ann.examples!.length).toBeGreaterThan(0);
    }
  });
});

describe('ALL_ANNOTATIONS composition', () => {
  it('should be the concatenation of all sub-arrays', () => {
    const expected =
      CORE_ANNOTATIONS.length +
      PORT_ANNOTATIONS.length +
      WORKFLOW_ANNOTATIONS.length +
      METADATA_ANNOTATIONS.length +
      PATTERN_ANNOTATIONS.length +
      STANDARD_ANNOTATIONS.length;
    expect(ALL_ANNOTATIONS.length).toBe(expected);
  });

  it('every annotation should have a non-empty insertText', () => {
    for (const ann of ALL_ANNOTATIONS) {
      expect(ann.insertText.length).toBeGreaterThan(0);
    }
  });

  it('every annotation should have a valid insertTextFormat', () => {
    for (const ann of ALL_ANNOTATIONS) {
      expect(['plain', 'snippet']).toContain(ann.insertTextFormat);
    }
  });
});

describe('PORT_MODIFIERS details', () => {
  it('placement modifier should have enum values TOP and BOTTOM', () => {
    const placement = PORT_MODIFIERS.find((m) => m.name === 'placement')!;
    expect(placement.enum).toEqual(['TOP', 'BOTTOM']);
  });

  it('order modifier should not have enum', () => {
    const order = PORT_MODIFIERS.find((m) => m.name === 'order')!;
    expect(order.enum).toBeUndefined();
  });

  it('hidden modifier should not have enum', () => {
    const hidden = PORT_MODIFIERS.find((m) => m.name === 'hidden')!;
    expect(hidden.enum).toBeUndefined();
  });
});

describe('NODE_MODIFIERS details', () => {
  it('all modifiers should have syntax starting with [', () => {
    for (const mod of NODE_MODIFIERS) {
      expect(mod.syntax.startsWith('[')).toBe(true);
    }
  });

  it('no modifier should have enum values', () => {
    for (const mod of NODE_MODIFIERS) {
      expect(mod.enum).toBeUndefined();
    }
  });
});
