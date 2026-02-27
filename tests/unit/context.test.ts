import { describe, it, expect } from 'vitest';
import { buildContext, resolveTopics, PRESETS, PRESET_NAMES } from '../../src/context/index.js';

describe('resolveTopics', () => {
  it('returns preset topics by default', () => {
    const topics = resolveTopics('core');
    expect(topics).toEqual(PRESETS.core);
  });

  it('uses explicit topics when provided', () => {
    const topics = resolveTopics('core', ['error-codes', 'deployment']);
    expect(topics).toEqual(['error-codes', 'deployment']);
  });

  it('appends addTopics to preset', () => {
    const topics = resolveTopics('core', undefined, ['error-codes']);
    expect(topics).toEqual([...PRESETS.core, 'error-codes']);
  });

  it('deduplicates topics', () => {
    const topics = resolveTopics('core', undefined, ['concepts']);
    // 'concepts' is already in core
    expect(topics.filter((t) => t === 'concepts').length).toBe(1);
  });

  it('preserves order with addTopics at the end', () => {
    const topics = resolveTopics('core', undefined, ['deployment']);
    expect(topics[topics.length - 1]).toBe('deployment');
  });
});

describe('buildContext', () => {
  it('produces standalone profile by default', () => {
    const result = buildContext();
    expect(result.profile).toBe('standalone');
    expect(result.content).toContain('# Flow Weaver Reference');
  });

  it('produces assistant profile when requested', () => {
    const result = buildContext({ profile: 'assistant' });
    expect(result.profile).toBe('assistant');
    expect(result.content).toContain('# Flow Weaver Context');
    expect(result.content).toContain('fw_docs');
    expect(result.content).toContain('fw_create_model');
  });

  it('includes EBNF grammar by default', () => {
    const result = buildContext();
    expect(result.content).toContain('## JSDoc Annotation Grammar (EBNF)');
    expect(result.content).toContain('```ebnf');
  });

  it('omits grammar when includeGrammar is false', () => {
    const result = buildContext({ includeGrammar: false });
    expect(result.content).not.toContain('```ebnf');
  });

  it('includes core preset topics by default', () => {
    const result = buildContext();
    expect(result.topicCount).toBe(3);
    expect(result.topicSlugs).toEqual(PRESETS.core);
  });

  it('includes all topics for full preset', () => {
    const result = buildContext({ preset: 'full' });
    expect(result.topicCount).toBe(16);
  });

  it('respects explicit topics', () => {
    const result = buildContext({ topics: ['concepts'] });
    expect(result.topicCount).toBe(1);
    expect(result.topicSlugs).toEqual(['concepts']);
  });

  it('skips unknown topics gracefully', () => {
    const result = buildContext({ topics: ['concepts', 'nonexistent-topic'] });
    expect(result.topicCount).toBe(1);
    expect(result.topicSlugs).toEqual(['concepts']);
  });

  it('has accurate lineCount', () => {
    const result = buildContext({ topics: ['concepts'], includeGrammar: false });
    const actualLines = result.content.split('\n').length;
    expect(result.lineCount).toBe(actualLines);
  });

  it('separates sections with ---', () => {
    const result = buildContext();
    expect(result.content).toContain('---');
  });

  it('nests topic headings under ## level', () => {
    const result = buildContext({ topics: ['concepts'], includeGrammar: false });
    const lines = result.content.split('\n');
    // First heading should be # (preamble)
    const firstHeading = lines.find((l) => l.startsWith('#'));
    expect(firstHeading).toMatch(/^# /);
    // Topic heading should be ## level
    expect(result.content).toContain('## Flow Weaver Concepts');
    // Internal headings should be ### or deeper (not # or ##)
    const topicStart = result.content.indexOf('## Flow Weaver Concepts');
    const afterTopic = result.content.slice(topicStart + '## Flow Weaver Concepts'.length);
    const internalHeadings = afterTopic.split('\n').filter((l) => l.match(/^#{1,2}\s/) && !l.startsWith('##'));
    // No bare # headings inside topic content
    expect(internalHeadings.length).toBe(0);
  });

  it('assistant profile lists all doc slugs for fw_docs lookup', () => {
    const result = buildContext({ profile: 'assistant', topics: ['concepts'] });
    // Should mention available topics even if not included in the bundle
    expect(result.content).toContain('tutorial');
    expect(result.content).toContain('error-codes');
  });
});

describe('PRESETS', () => {
  it('has expected preset names', () => {
    expect(PRESET_NAMES).toContain('core');
    expect(PRESET_NAMES).toContain('authoring');
    expect(PRESET_NAMES).toContain('ops');
    expect(PRESET_NAMES).toContain('full');
  });

  it('full preset includes all 16 topics', () => {
    expect(PRESETS.full.length).toBe(16);
  });

  it('core preset is a subset of full', () => {
    for (const topic of PRESETS.core) {
      expect(PRESETS.full).toContain(topic);
    }
  });

  it('authoring preset is a subset of full', () => {
    for (const topic of PRESETS.authoring) {
      expect(PRESETS.full).toContain(topic);
    }
  });

  it('ops preset is a subset of full', () => {
    for (const topic of PRESETS.ops) {
      expect(PRESETS.full).toContain(topic);
    }
  });
});
