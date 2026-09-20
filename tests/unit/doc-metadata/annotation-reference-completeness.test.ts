import { describe, it, expect } from 'vitest';
import {
  KNOWN_NODETYPE_TAGS,
  KNOWN_WORKFLOW_TAGS,
} from '../../../src/constants.js';
import { ALL_ANNOTATIONS } from '../../../src/doc-metadata/extractors/annotations.js';

/**
 * Guardrail: every JSDoc tag the parser accepts must appear in the annotation
 * reference that `fw_docs` / `fw_list_resources` serve to editors and MCP
 * clients, and vice versa. When the two drift, a tag the parser recognises is
 * reported as "Unknown annotation @…" or is simply invisible to an assistant
 * reading the reference — the exact shape of the "@durablePure/@http not
 * recognized" reports. This test makes that drift a build failure.
 *
 * The parser's source of truth is KNOWN_NODETYPE_TAGS + KNOWN_WORKFLOW_TAGS in
 * constants.ts. The reference's source of truth is ALL_ANNOTATIONS.
 */

/** Bare tag names the parser recognises, from both block contexts. */
const parsedTags = new Set<string>([
  ...KNOWN_NODETYPE_TAGS,
  ...KNOWN_WORKFLOW_TAGS,
]);

/**
 * Bare tag names the reference documents. Reference entries may carry a
 * compound name that encodes a marker variant or a port direction rather than
 * a distinct tag (e.g. "@flowWeaver nodeType", "@port IN"); reduce to the tag
 * token so they match the parser's set.
 */
const documentedTags = new Set<string>(
  ALL_ANNOTATIONS.map((a) => a.name.replace(/^@/, '').split(/\s+/)[0])
);

/**
 * Reference entries that are documentation-only and deliberately absent from
 * the parser's KNOWN_* sets. Keep this list tight and justified — it is the
 * only sanctioned way for the two sides to differ.
 */
const DOCUMENTED_ONLY = new Set<string>([
  // Standard JSDoc tags carried for IDE completeness (see STANDARD_ANNOTATIONS).
  'example',
  'see',
  'deprecated',
  'type',
  'typedef',
  'template',
  'link',
  'since',
  'version',
  'author',
  // Marker / port entries whose bare token is a real tag but whose reference
  // rows describe variants; the base tag is itself covered elsewhere.
  'flowWeaver',
  'port',
  'input',
  'output',
  'connect',
  'node',
  'scope',
]);

describe('annotation reference completeness', () => {
  it('documents every tag the parser accepts', () => {
    const missing = [...parsedTags].filter((t) => !documentedTags.has(t)).sort();
    expect(
      missing,
      `These tags are in KNOWN_NODETYPE_TAGS/KNOWN_WORKFLOW_TAGS but have no ` +
        `entry in ALL_ANNOTATIONS (src/doc-metadata/extractors/annotations.ts). ` +
        `Add a TAnnotationDoc for each, or remove it from constants.ts if it is ` +
        `no longer a real tag.`
    ).toEqual([]);
  });

  it('does not document tags the parser rejects', () => {
    const orphan = [...documentedTags].filter(
      (t) => !parsedTags.has(t) && !DOCUMENTED_ONLY.has(t)
    ).sort();
    expect(
      orphan,
      `These tags have a reference entry but are not in the parser's KNOWN_* ` +
        `sets, so a workflow using them warns "Unknown annotation". Either add ` +
        `them to constants.ts, or list them in DOCUMENTED_ONLY with a reason.`
    ).toEqual([]);
  });
});
