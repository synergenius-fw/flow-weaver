import { getAnnotationValueCompletions } from '../../../src/editor-completions/annotationValues';

describe('getAnnotationValueCompletions', () => {
  describe('@executeWhen values', () => {
    it('should return all three values with empty prefix', () => {
      const result = getAnnotationValueCompletions('@executeWhen', '');
      expect(result).toHaveLength(3);
      const labels = result.map((c) => c.label);
      expect(labels).toContain('CONJUNCTION');
      expect(labels).toContain('DISJUNCTION');
      expect(labels).toContain('CUSTOM');
    });

    it('should filter by prefix (case-insensitive)', () => {
      const result = getAnnotationValueCompletions('@executeWhen', 'con');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('CONJUNCTION');
    });

    it('should filter DISJUNCTION by partial prefix', () => {
      const result = getAnnotationValueCompletions('@executeWhen', 'DIS');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('DISJUNCTION');
    });

    it('should filter CUSTOM by prefix', () => {
      const result = getAnnotationValueCompletions('@executeWhen', 'CU');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('CUSTOM');
    });

    it('should return empty when prefix matches nothing', () => {
      const result = getAnnotationValueCompletions('@executeWhen', 'xyz');
      expect(result).toEqual([]);
    });

    it('should include correct detail and documentation', () => {
      const result = getAnnotationValueCompletions('@executeWhen', '');
      const conjunction = result.find((c) => c.label === 'CONJUNCTION')!;
      expect(conjunction.detail).toBe('All inputs required');
      expect(conjunction.documentation).toContain('ALL connected input step ports');
      expect(conjunction.kind).toBe('value');
      expect(conjunction.insertText).toBe('CONJUNCTION');
      expect(conjunction.insertTextFormat).toBe('plain');
    });

    it('should have ascending sortOrder', () => {
      const result = getAnnotationValueCompletions('@executeWhen', '');
      const orders = result.map((c) => c.sortOrder);
      expect(orders).toEqual([0, 1, 2]);
    });
  });

  describe('@flowWeaver values', () => {
    it('should return workflow and nodeType', () => {
      const result = getAnnotationValueCompletions('@flowWeaver', '');
      expect(result).toHaveLength(2);
      expect(result[0].label).toBe('workflow');
      expect(result[1].label).toBe('nodeType');
    });

    it('should filter by prefix', () => {
      const result = getAnnotationValueCompletions('@flowWeaver', 'work');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('workflow');
    });

    it('should filter nodeType by prefix', () => {
      const result = getAnnotationValueCompletions('@flowWeaver', 'node');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('nodeType');
    });

    it('should include documentation for workflow', () => {
      const result = getAnnotationValueCompletions('@flowWeaver', 'work');
      expect(result[0].documentation).toContain('Flow Weaver workflow');
      expect(result[0].detail).toBe('Visual workflow');
    });

    it('should include documentation for nodeType', () => {
      const result = getAnnotationValueCompletions('@flowWeaver', 'node');
      expect(result[0].documentation).toContain('reusable node type');
      expect(result[0].detail).toBe('Reusable node type');
    });
  });

  describe('@color values', () => {
    it('should return all 9 color values', () => {
      const result = getAnnotationValueCompletions('@color', '');
      expect(result).toHaveLength(9);
    });

    it('should include all expected colors', () => {
      const result = getAnnotationValueCompletions('@color', '');
      const labels = result.map((c) => c.label);
      expect(labels).toEqual([
        'purple', 'blue', 'green', 'orange', 'red', 'teal', 'pink', 'yellow', 'cyan',
      ]);
    });

    it('should filter by prefix', () => {
      const result = getAnnotationValueCompletions('@color', 'pur');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('purple');
    });

    it('should match multiple colors sharing a prefix', () => {
      // "blue" is the only one starting with "b" in the list
      const result = getAnnotationValueCompletions('@color', 'b');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('blue');
    });

    it('should be case-insensitive', () => {
      const result = getAnnotationValueCompletions('@color', 'PURPLE');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('purple');
    });

    it('should have correct detail format', () => {
      const result = getAnnotationValueCompletions('@color', 'cyan');
      expect(result[0].detail).toBe('Cyan node color');
      expect(result[0].insertText).toBe('cyan');
    });

    it('should have ascending sort order', () => {
      const result = getAnnotationValueCompletions('@color', '');
      for (let i = 0; i < result.length; i++) {
        expect(result[i].sortOrder).toBe(i);
      }
    });
  });

  describe('unknown annotations', () => {
    it('should return empty for an unknown annotation', () => {
      const result = getAnnotationValueCompletions('@unknown', '');
      expect(result).toEqual([]);
    });

    it('should return empty for @input (no enumerated values)', () => {
      const result = getAnnotationValueCompletions('@input', '');
      expect(result).toEqual([]);
    });

    it('should return empty for @node (no enumerated values)', () => {
      const result = getAnnotationValueCompletions('@node', '');
      expect(result).toEqual([]);
    });

    it('should return empty for empty string annotation', () => {
      const result = getAnnotationValueCompletions('', '');
      expect(result).toEqual([]);
    });
  });
});
