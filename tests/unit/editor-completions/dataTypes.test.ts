import {
  DATA_TYPES,
  getDataTypeCompletions,
} from '../../../src/editor-completions/dataTypes';

describe('DATA_TYPES', () => {
  it('should contain all 8 data types', () => {
    expect(DATA_TYPES).toHaveLength(8);
  });

  it('should include all expected type labels', () => {
    const labels = DATA_TYPES.map((t) => t.label);
    expect(labels).toContain('STEP');
    expect(labels).toContain('String');
    expect(labels).toContain('Number');
    expect(labels).toContain('Boolean');
    expect(labels).toContain('Array');
    expect(labels).toContain('Object');
    expect(labels).toContain('Function');
    expect(labels).toContain('Any');
  });

  it('should have type kind for all entries', () => {
    for (const t of DATA_TYPES) {
      expect(t.kind).toBe('type');
    }
  });

  it('should append closing brace to insertText', () => {
    for (const t of DATA_TYPES) {
      expect(t.insertText).toBe(t.label + '}');
    }
  });

  it('should use plain insertTextFormat', () => {
    for (const t of DATA_TYPES) {
      expect(t.insertTextFormat).toBe('plain');
    }
  });

  it('should have detail for all types', () => {
    for (const t of DATA_TYPES) {
      expect(t.detail).toBeTruthy();
    }
  });

  it('should have documentation for all types', () => {
    for (const t of DATA_TYPES) {
      expect(t.documentation).toBeTruthy();
    }
  });

  it('should list STEP first (lowest sortOrder)', () => {
    const step = DATA_TYPES.find((t) => t.label === 'STEP')!;
    expect(step.sortOrder).toBe(0);
  });

  it('should group primitives with sortOrder 10-12', () => {
    const primitives = ['String', 'Number', 'Boolean'];
    for (const name of primitives) {
      const t = DATA_TYPES.find((dt) => dt.label === name)!;
      expect(t.sortOrder).toBeGreaterThanOrEqual(10);
      expect(t.sortOrder).toBeLessThanOrEqual(12);
    }
  });

  it('should group complex types with sortOrder 20-22', () => {
    const complex = ['Array', 'Object', 'Function'];
    for (const name of complex) {
      const t = DATA_TYPES.find((dt) => dt.label === name)!;
      expect(t.sortOrder).toBeGreaterThanOrEqual(20);
      expect(t.sortOrder).toBeLessThanOrEqual(22);
    }
  });

  it('should put Any last (sortOrder 30)', () => {
    const any = DATA_TYPES.find((t) => t.label === 'Any')!;
    expect(any.sortOrder).toBe(30);
  });
});

describe('getDataTypeCompletions', () => {
  describe('with empty prefix', () => {
    it('should return all data types', () => {
      const result = getDataTypeCompletions('');
      expect(result).toHaveLength(8);
    });
  });

  describe('prefix filtering', () => {
    it('should match String by prefix', () => {
      const result = getDataTypeCompletions('Str');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('String');
    });

    it('should match Number by prefix', () => {
      const result = getDataTypeCompletions('Num');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Number');
    });

    it('should match Boolean by prefix', () => {
      const result = getDataTypeCompletions('Bool');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Boolean');
    });

    it('should match STEP by prefix', () => {
      const result = getDataTypeCompletions('STE');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('STEP');
    });

    it('should match Array by prefix', () => {
      const result = getDataTypeCompletions('Arr');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Array');
    });

    it('should match Object by prefix', () => {
      const result = getDataTypeCompletions('Obj');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Object');
    });

    it('should match Function by prefix', () => {
      const result = getDataTypeCompletions('Fun');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Function');
    });

    it('should match Any by prefix', () => {
      const result = getDataTypeCompletions('An');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Any');
    });
  });

  describe('case-insensitive matching', () => {
    it('should match "string" (lowercase)', () => {
      const result = getDataTypeCompletions('string');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('String');
    });

    it('should match "STEP" (uppercase)', () => {
      const result = getDataTypeCompletions('STEP');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('STEP');
    });

    it('should match "step" (lowercase)', () => {
      const result = getDataTypeCompletions('step');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('STEP');
    });

    it('should match "boolean" (lowercase)', () => {
      const result = getDataTypeCompletions('boolean');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Boolean');
    });
  });

  describe('multiple matches', () => {
    it('should return multiple types starting with same letter', () => {
      // "A" matches Array and Any
      const result = getDataTypeCompletions('A');
      expect(result).toHaveLength(2);
      const labels = result.map((c) => c.label);
      expect(labels).toContain('Array');
      expect(labels).toContain('Any');
    });

    it('should return String and STEP for "s"', () => {
      const result = getDataTypeCompletions('s');
      expect(result).toHaveLength(2);
      const labels = result.map((c) => c.label);
      expect(labels).toContain('STEP');
      expect(labels).toContain('String');
    });
  });

  describe('no matches', () => {
    it('should return empty for non-matching prefix', () => {
      const result = getDataTypeCompletions('xyz');
      expect(result).toEqual([]);
    });

    it('should return empty for prefix that partially matches but not from start', () => {
      const result = getDataTypeCompletions('ring');
      expect(result).toEqual([]);
    });
  });

  describe('returned completion properties', () => {
    it('should preserve all properties from DATA_TYPES', () => {
      const result = getDataTypeCompletions('String');
      expect(result).toHaveLength(1);
      const c = result[0];
      expect(c.label).toBe('String');
      expect(c.detail).toBe('Text value');
      expect(c.documentation).toContain('string/text value');
      expect(c.insertText).toBe('String}');
      expect(c.insertTextFormat).toBe('plain');
      expect(c.kind).toBe('type');
      expect(c.sortOrder).toBe(10);
    });
  });
});
