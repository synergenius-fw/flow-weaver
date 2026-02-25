import {
  getModifierCompletions,
  getModifierValueCompletions,
} from '../../../src/editor-completions/modifierCompletions';

describe('getModifierCompletions', () => {
  describe('with no annotation context (null)', () => {
    it('should return all unique modifiers', () => {
      const result = getModifierCompletions(null, '');
      const labels = result.map((c) => c.label);
      expect(labels).toContain('order');
      expect(labels).toContain('placement');
      expect(labels).toContain('type');
      expect(labels).toContain('hidden');
      expect(labels).toContain('optional');
      expect(labels).toContain('label');
      expect(labels).toContain('expr');
      expect(labels).toContain('minimized');
      expect(labels).toContain('pullExecution');
      expect(labels).toContain('portOrder');
      expect(labels).toContain('portLabel');
      expect(labels).toContain('size');
    });

    it('should not have duplicate modifier names', () => {
      const result = getModifierCompletions(null, '');
      const labels = result.map((c) => c.label);
      const uniqueLabels = [...new Set(labels)];
      expect(labels).toEqual(uniqueLabels);
    });

    it('should have keyword kind for all modifiers', () => {
      const result = getModifierCompletions(null, '');
      for (const c of result) {
        expect(c.kind).toBe('keyword');
      }
    });

    it('should append colon to insertText', () => {
      const result = getModifierCompletions(null, '');
      for (const c of result) {
        expect(c.insertText).toBe(c.label + ':');
      }
    });

    it('should use plain insertTextFormat', () => {
      const result = getModifierCompletions(null, '');
      for (const c of result) {
        expect(c.insertTextFormat).toBe('plain');
      }
    });
  });

  describe('prefix filtering', () => {
    it('should filter by prefix', () => {
      const result = getModifierCompletions(null, 'plac');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('placement');
    });

    it('should be case-insensitive', () => {
      const result = getModifierCompletions(null, 'PLAC');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('placement');
    });

    it('should return empty for unmatched prefix', () => {
      const result = getModifierCompletions(null, 'xyz');
      expect(result).toEqual([]);
    });

    it('should match multiple modifiers with shared prefix', () => {
      const result = getModifierCompletions(null, 'p');
      const labels = result.map((c) => c.label);
      expect(labels).toContain('placement');
      expect(labels).toContain('pullExecution');
      expect(labels).toContain('portOrder');
      expect(labels).toContain('portLabel');
    });

    it('should match "port" prefix to portOrder and portLabel', () => {
      const result = getModifierCompletions(null, 'port');
      expect(result).toHaveLength(2);
      const labels = result.map((c) => c.label);
      expect(labels).toContain('portOrder');
      expect(labels).toContain('portLabel');
    });
  });

  describe('annotation context filtering', () => {
    it('should return port modifiers for @input', () => {
      const result = getModifierCompletions('@input', '');
      const labels = result.map((c) => c.label);
      expect(labels).toContain('order');
      expect(labels).toContain('placement');
      expect(labels).toContain('type');
      expect(labels).toContain('hidden');
      expect(labels).toContain('optional');
      expect(labels).toContain('label');
      expect(labels).toContain('expr');
      expect(labels).toContain('minimized');
      expect(labels).toContain('pullExecution');
    });

    it('should not return node-only modifiers for @input', () => {
      const result = getModifierCompletions('@input', '');
      const labels = result.map((c) => c.label);
      expect(labels).not.toContain('portOrder');
      expect(labels).not.toContain('size');
    });

    it('should return port modifiers for @output', () => {
      const result = getModifierCompletions('@output', '');
      const labels = result.map((c) => c.label);
      expect(labels).toContain('order');
      expect(labels).toContain('placement');
      expect(labels).toContain('hidden');
    });

    it('should return port modifiers for @step', () => {
      const result = getModifierCompletions('@step', '');
      const labels = result.map((c) => c.label);
      expect(labels).toContain('order');
      expect(labels).toContain('placement');
      expect(labels).toContain('hidden');
    });

    it('should return node modifiers for @node', () => {
      const result = getModifierCompletions('@node', '');
      const labels = result.map((c) => c.label);
      expect(labels).toContain('label');
      expect(labels).toContain('expr');
      expect(labels).toContain('minimized');
      expect(labels).toContain('pullExecution');
      expect(labels).toContain('portOrder');
      expect(labels).toContain('portLabel');
      expect(labels).toContain('size');
    });

    it('should not return port-only modifiers for @node', () => {
      const result = getModifierCompletions('@node', '');
      const labels = result.map((c) => c.label);
      // "order" is port-only (only on @input/@output/@step)
      expect(labels).not.toContain('order');
      // "placement" is port-only
      expect(labels).not.toContain('placement');
    });

    it('should return empty for annotation with no modifiers', () => {
      const result = getModifierCompletions('@connect', '');
      expect(result).toEqual([]);
    });

    it('should combine annotation context and prefix filtering', () => {
      const result = getModifierCompletions('@input', 'plac');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('placement');
    });

    it('should return empty when prefix matches modifier not valid for annotation', () => {
      const result = getModifierCompletions('@node', 'plac');
      expect(result).toHaveLength(0);
    });
  });

  describe('detail and documentation', () => {
    it('should have detail text for all modifiers', () => {
      const result = getModifierCompletions(null, '');
      for (const c of result) {
        expect(c.detail).toBeTruthy();
      }
    });

    it('should have meaningful detail for placement', () => {
      const result = getModifierCompletions(null, 'placement');
      expect(result[0].detail).toContain('Port placement');
    });

    it('should have meaningful detail for hidden', () => {
      const result = getModifierCompletions(null, 'hidden');
      expect(result[0].detail).toContain('Hide');
    });
  });
});

describe('getModifierValueCompletions', () => {
  describe('placement values', () => {
    it('should return TOP and BOTTOM', () => {
      const result = getModifierValueCompletions('placement', '');
      expect(result).toHaveLength(2);
      expect(result.some((c) => c.label === 'TOP')).toBe(true);
      expect(result.some((c) => c.label === 'BOTTOM')).toBe(true);
    });

    it('should filter by prefix', () => {
      const result = getModifierValueCompletions('placement', 'TO');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('TOP');
    });

    it('should be case-insensitive', () => {
      const result = getModifierValueCompletions('placement', 'bot');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('BOTTOM');
    });

    it('should have value kind', () => {
      const result = getModifierValueCompletions('placement', '');
      for (const c of result) {
        expect(c.kind).toBe('value');
      }
    });

    it('should have detail text', () => {
      const result = getModifierValueCompletions('placement', 'TOP');
      expect(result[0].detail).toContain('top');
    });
  });

  describe('hidden values', () => {
    it('should return true and false', () => {
      const result = getModifierValueCompletions('hidden', '');
      expect(result).toHaveLength(2);
      expect(result.some((c) => c.label === 'true')).toBe(true);
      expect(result.some((c) => c.label === 'false')).toBe(true);
    });

    it('should filter by prefix', () => {
      const result = getModifierValueCompletions('hidden', 'tr');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('true');
    });
  });

  describe('optional values', () => {
    it('should return true and false', () => {
      const result = getModifierValueCompletions('optional', '');
      expect(result).toHaveLength(2);
      const labels = result.map((c) => c.label);
      expect(labels).toContain('true');
      expect(labels).toContain('false');
    });
  });

  describe('minimized values', () => {
    it('should return true and false', () => {
      const result = getModifierValueCompletions('minimized', '');
      expect(result).toHaveLength(2);
      const labels = result.map((c) => c.label);
      expect(labels).toContain('true');
      expect(labels).toContain('false');
    });

    it('should have correct detail for true', () => {
      const result = getModifierValueCompletions('minimized', 'tr');
      expect(result[0].detail).toBe('Start minimized');
    });

    it('should have correct detail for false', () => {
      const result = getModifierValueCompletions('minimized', 'fa');
      expect(result[0].detail).toBe('Start expanded');
    });
  });

  describe('pullExecution values', () => {
    it('should return true and false', () => {
      const result = getModifierValueCompletions('pullExecution', '');
      expect(result).toHaveLength(2);
      const labels = result.map((c) => c.label);
      expect(labels).toContain('true');
      expect(labels).toContain('false');
    });
  });

  describe('unknown modifier', () => {
    it('should return empty for unknown modifier', () => {
      const result = getModifierValueCompletions('unknown', '');
      expect(result).toEqual([]);
    });

    it('should return empty for order (no enumerated values)', () => {
      const result = getModifierValueCompletions('order', '');
      expect(result).toEqual([]);
    });

    it('should return empty for label (no enumerated values)', () => {
      const result = getModifierValueCompletions('label', '');
      expect(result).toEqual([]);
    });

    it('should return empty for type (no enumerated values)', () => {
      const result = getModifierValueCompletions('type', '');
      expect(result).toEqual([]);
    });

    it('should return empty for expr (no enumerated values)', () => {
      const result = getModifierValueCompletions('expr', '');
      expect(result).toEqual([]);
    });

    it('should return empty for size (no enumerated values)', () => {
      const result = getModifierValueCompletions('size', '');
      expect(result).toEqual([]);
    });
  });

  describe('insertText and format', () => {
    it('should have insertText matching the label', () => {
      const result = getModifierValueCompletions('placement', '');
      for (const c of result) {
        expect(c.insertText).toBe(c.label);
      }
    });

    it('should use plain insertTextFormat', () => {
      const result = getModifierValueCompletions('placement', '');
      for (const c of result) {
        expect(c.insertTextFormat).toBe('plain');
      }
    });
  });
});
