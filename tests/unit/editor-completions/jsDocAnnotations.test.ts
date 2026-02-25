import {
  JSDOC_ANNOTATIONS,
  getAnnotationCompletions,
  type AnnotationCompletion,
} from '../../../src/editor-completions/jsDocAnnotations';

describe('JSDOC_ANNOTATIONS', () => {
  it('should contain all expected annotations', () => {
    const labels = JSDOC_ANNOTATIONS.map((a) => a.label);
    // Core
    expect(labels).toContain('@flowWeaver');
    expect(labels).toContain('@flowWeaver nodeType');
    // Ports (nodeType)
    expect(labels).toContain('@input');
    expect(labels).toContain('@output');
    expect(labels).toContain('@step');
    // Nodes (workflow)
    expect(labels).toContain('@node');
    expect(labels).toContain('@connect');
    expect(labels).toContain('@fwImport');
    expect(labels).toContain('@path');
    expect(labels).toContain('@trigger');
    expect(labels).toContain('@cancelOn');
    expect(labels).toContain('@retries');
    expect(labels).toContain('@timeout');
    expect(labels).toContain('@throttle');
    expect(labels).toContain('@strictTypes');
    expect(labels).toContain('@port');
    // Metadata
    expect(labels).toContain('@label');
    expect(labels).toContain('@scope');
    expect(labels).toContain('@position');
    expect(labels).toContain('@name');
    expect(labels).toContain('@description');
    expect(labels).toContain('@color');
    expect(labels).toContain('@icon');
    expect(labels).toContain('@tag');
    expect(labels).toContain('@expression');
    expect(labels).toContain('@pullExecution');
    expect(labels).toContain('@executeWhen');
    // Standard JSDoc
    expect(labels).toContain('@param');
    expect(labels).toContain('@returns');
  });

  it('should have the annotation kind for all entries', () => {
    for (const a of JSDOC_ANNOTATIONS) {
      expect(a.kind).toBe('annotation');
    }
  });

  it('should have an insertText for every entry', () => {
    for (const a of JSDOC_ANNOTATIONS) {
      expect(a.insertText).toBeTruthy();
    }
  });

  it('should mark nodeType-only annotations with blockTypes', () => {
    const nodeTypeOnly = ['@input', '@output', '@step', '@scope', '@name', '@description',
      '@color', '@icon', '@tag', '@expression', '@pullExecution', '@executeWhen'];
    for (const label of nodeTypeOnly) {
      const ann = JSDOC_ANNOTATIONS.find((a) => a.label === label)!;
      expect(ann.blockTypes).toContain('nodeType');
      expect(ann.blockTypes).not.toContain('workflow');
    }
  });

  it('should mark workflow-only annotations with blockTypes', () => {
    const workflowOnly = ['@node', '@connect', '@fwImport', '@path', '@trigger',
      '@cancelOn', '@retries', '@timeout', '@throttle', '@strictTypes', '@port', '@position'];
    for (const label of workflowOnly) {
      const ann = JSDOC_ANNOTATIONS.find((a) => a.label === label)!;
      expect(ann.blockTypes).toContain('workflow');
      expect(ann.blockTypes).not.toContain('nodeType');
    }
  });

  it('should not set blockTypes for annotations valid in both contexts', () => {
    const bothContexts = ['@flowWeaver', '@flowWeaver nodeType', '@label', '@param', '@returns'];
    for (const label of bothContexts) {
      const ann = JSDOC_ANNOTATIONS.find((a) => a.label === label)!;
      expect(ann.blockTypes).toBeUndefined();
    }
  });

  it('should use snippet format for annotations with placeholders', () => {
    const snippets = JSDOC_ANNOTATIONS.filter((a) => a.insertText.includes('${'));
    expect(snippets.length).toBeGreaterThan(0);
    for (const s of snippets) {
      expect(s.insertTextFormat).toBe('snippet');
    }
  });

  it('should use plain format for annotations without placeholders', () => {
    const plain = JSDOC_ANNOTATIONS.filter(
      (a) => !a.insertText.includes('${')
    );
    expect(plain.length).toBeGreaterThan(0);
    for (const p of plain) {
      expect(p.insertTextFormat).toBe('plain');
    }
  });
});

describe('getAnnotationCompletions', () => {
  describe('prefix filtering', () => {
    it('should return all annotations with empty prefix', () => {
      const result = getAnnotationCompletions('');
      expect(result.length).toBe(JSDOC_ANNOTATIONS.length);
    });

    it('should filter by prefix (case-insensitive)', () => {
      const result = getAnnotationCompletions('inp');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('@input');
    });

    it('should match multiple annotations with shared prefix', () => {
      const result = getAnnotationCompletions('flow');
      expect(result).toHaveLength(2);
      const labels = result.map((c) => c.label);
      expect(labels).toContain('@flowWeaver');
      expect(labels).toContain('@flowWeaver nodeType');
    });

    it('should return empty when prefix matches nothing', () => {
      const result = getAnnotationCompletions('xyz');
      expect(result).toEqual([]);
    });

    it('should be case-insensitive', () => {
      const result = getAnnotationCompletions('NODE');
      expect(result.some((c) => c.label === '@node')).toBe(true);
    });

    it('should match partial long prefixes', () => {
      const result = getAnnotationCompletions('executeW');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('@executeWhen');
    });
  });

  describe('block type filtering', () => {
    it('should filter to workflow-only annotations when blockType is workflow', () => {
      const result = getAnnotationCompletions('', 'workflow');
      // Should include workflow annotations
      expect(result.some((c) => c.label === '@node')).toBe(true);
      expect(result.some((c) => c.label === '@connect')).toBe(true);
      expect(result.some((c) => c.label === '@path')).toBe(true);
      expect(result.some((c) => c.label === '@trigger')).toBe(true);
      // Should include annotations with no blockTypes (valid in both)
      expect(result.some((c) => c.label === '@label')).toBe(true);
      expect(result.some((c) => c.label === '@param')).toBe(true);
      // Should NOT include nodeType-only annotations
      expect(result.some((c) => c.label === '@input')).toBe(false);
      expect(result.some((c) => c.label === '@output')).toBe(false);
      expect(result.some((c) => c.label === '@expression')).toBe(false);
    });

    it('should filter to nodeType-only annotations when blockType is nodeType', () => {
      const result = getAnnotationCompletions('', 'nodeType');
      // Should include nodeType annotations
      expect(result.some((c) => c.label === '@input')).toBe(true);
      expect(result.some((c) => c.label === '@output')).toBe(true);
      expect(result.some((c) => c.label === '@step')).toBe(true);
      expect(result.some((c) => c.label === '@expression')).toBe(true);
      // Should include annotations with no blockTypes (valid in both)
      expect(result.some((c) => c.label === '@label')).toBe(true);
      expect(result.some((c) => c.label === '@param')).toBe(true);
      // Should NOT include workflow-only annotations
      expect(result.some((c) => c.label === '@node')).toBe(false);
      expect(result.some((c) => c.label === '@connect')).toBe(false);
      expect(result.some((c) => c.label === '@position')).toBe(false);
    });

    it('should return all annotations when blockType is null', () => {
      const result = getAnnotationCompletions('', null);
      expect(result.length).toBe(JSDOC_ANNOTATIONS.length);
    });

    it('should return all annotations when blockType is undefined', () => {
      const result = getAnnotationCompletions('');
      expect(result.length).toBe(JSDOC_ANNOTATIONS.length);
    });

    it('should combine prefix and block type filtering', () => {
      const result = getAnnotationCompletions('inp', 'nodeType');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('@input');
    });

    it('should exclude nodeType prefix matches when in workflow context', () => {
      const result = getAnnotationCompletions('inp', 'workflow');
      expect(result).toHaveLength(0);
    });
  });

  describe('context-aware sorting boosts', () => {
    it('should boost @connect and @path when workflow has @node but no connections', () => {
      const result = getAnnotationCompletions('', 'workflow', ['node']);
      const connectItem = result.find((c) => c.label === '@connect')!;
      const pathItem = result.find((c) => c.label === '@path')!;
      // Boosted items should appear near the top (sortOrder decreased by 10)
      expect(connectItem.sortOrder).toBeLessThan(15);
      expect(pathItem.sortOrder).toBeLessThan(20);
    });

    it('should not boost connections when workflow already has @connect', () => {
      const result = getAnnotationCompletions('', 'workflow', ['node', 'connect']);
      const connectItem = result.find((c) => c.label === '@connect')!;
      // Should keep original sortOrder (21)
      expect(connectItem.sortOrder).toBe(21);
    });

    it('should not boost connections when workflow already has @path', () => {
      const result = getAnnotationCompletions('', 'workflow', ['node', 'path']);
      const connectItem = result.find((c) => c.label === '@connect')!;
      expect(connectItem.sortOrder).toBe(21);
    });

    it('should boost @input when nodeType has no @input yet', () => {
      const result = getAnnotationCompletions('', 'nodeType', []);
      const inputItem = result.find((c) => c.label === '@input')!;
      // Boosted: sortOrder should be 10 - 10 = 0
      expect(inputItem.sortOrder).toBe(0);
    });

    it('should boost @output when nodeType has @input but no @output', () => {
      const result = getAnnotationCompletions('', 'nodeType', ['input']);
      const outputItem = result.find((c) => c.label === '@output')!;
      // Boosted: sortOrder should be 11 - 10 = 1
      expect(outputItem.sortOrder).toBe(1);
    });

    it('should not boost @input when nodeType already has @input', () => {
      const result = getAnnotationCompletions('', 'nodeType', ['input']);
      const inputItem = result.find((c) => c.label === '@input')!;
      // No boost, keeps original sortOrder of 10
      expect(inputItem.sortOrder).toBe(10);
    });

    it('should not boost @output when nodeType already has both @input and @output', () => {
      const result = getAnnotationCompletions('', 'nodeType', ['input', 'output']);
      const outputItem = result.find((c) => c.label === '@output')!;
      expect(outputItem.sortOrder).toBe(11);
    });

    it('should not apply boosts when no existingAnnotations provided', () => {
      const result = getAnnotationCompletions('', 'workflow');
      const connectItem = result.find((c) => c.label === '@connect')!;
      expect(connectItem.sortOrder).toBe(21);
    });
  });

  describe('result sorting', () => {
    it('should sort results by sortOrder ascending', () => {
      const result = getAnnotationCompletions('');
      for (let i = 1; i < result.length; i++) {
        expect((result[i].sortOrder ?? 0)).toBeGreaterThanOrEqual(
          (result[i - 1].sortOrder ?? 0)
        );
      }
    });

    it('should sort boosted items to front', () => {
      const result = getAnnotationCompletions('', 'nodeType', []);
      // @input boosted to sortOrder 0, same as @flowWeaver (sortOrder 0).
      // Both share sortOrder 0, but @flowWeaver appears first in the source array,
      // so stable sort keeps it ahead. @input should appear very early.
      const inputIndex = result.findIndex((c) => c.label === '@input');
      expect(inputIndex).toBeLessThan(3);
      expect(result[inputIndex].sortOrder).toBe(0);
    });
  });
});
