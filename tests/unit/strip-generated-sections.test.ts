import { describe, it, expect } from 'vitest';
import { stripGeneratedSections, MARKERS } from '../../src/api/generate-in-place';

describe('stripGeneratedSections', () => {
  it('should strip all body sections in multi-workflow files', () => {
    const source = `
// node types here

function wf1() {
  ${MARKERS.BODY_START}
  // body 1 content
  ${MARKERS.BODY_END}
}

function wf2() {
  ${MARKERS.BODY_START}
  // body 2 content
  ${MARKERS.BODY_END}
}
`;
    const result = stripGeneratedSections(source);
    expect(result).not.toContain('body 1 content');
    expect(result).not.toContain('body 2 content');
    expect(result.match(/throw new Error/g)?.length).toBe(2);
  });
});
