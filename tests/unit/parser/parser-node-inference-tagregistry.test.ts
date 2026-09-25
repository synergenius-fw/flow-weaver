/**
 * Characterization test for the tagRegistry threading in the extracted
 * extractNodeTypes.
 *
 * When extractNodeTypes was moved out of AnnotationParser into
 * src/parser/node-inference.ts, its former `this.tagRegistry` access became an
 * explicit parameter, passed as `this.tagRegistry` at each call site. The
 * fixture-based golden corpus only ever uses the default tag registry, so it
 * structurally CANNOT detect a regression where the wrong (or a default)
 * registry is threaded through.
 *
 * This test closes that gap: it registers a custom nodeType-scoped tag handler
 * on a fresh per-instance registry and confirms the handler's effect appears on
 * the parsed node type's deploy data, which only happens if extractNodeTypes
 * actually uses the instance's tagRegistry.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AnnotationParser } from '../../../src/parser/annotation-parser';
import { TagHandlerRegistry } from '../../../src/parser/tag-registry';

describe('extractNodeTypes threads the instance tagRegistry', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-tagreg-'));
    file = path.join(dir, 'node-with-custom-tag.ts');
    // A node type carrying a custom @customdeploy tag that only a registered
    // handler knows how to interpret.
    fs.writeFileSync(
      file,
      [
        '/**',
        ' * @flowWeaver nodeType',
        ' * @input value - number',
        ' * @output result - number',
        ' * @customdeploy region=eu-west-1',
        ' */',
        'export function widget(execute: boolean, value: number) {',
        '  return { onSuccess: true, onFailure: false, result: value };',
        '}',
      ].join('\n'),
    );
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('applies a custom nodeType tag handler registered on the instance registry', () => {
    const parser = new AnnotationParser();
    parser.tagRegistry = new TagHandlerRegistry();
    parser.tagRegistry.register(
      ['customdeploy'],
      'customns',
      'nodeType',
      (_tagName, comment, ctx) => {
        ctx.deploy.raw = comment;
      },
    );

    const result = parser.parse(file);
    const widget = result.nodeTypes.find((nt) => nt.functionName === 'widget');

    expect(widget).toBeDefined();
    // The custom handler ran (via extractNodeTypes -> parseNodeType with the
    // instance registry), writing into deploy['customns'].
    expect(widget!.deploy?.['customns']).toBeDefined();
    expect(widget!.deploy?.['customns']?.raw).toBe('region=eu-west-1');
  });

  it('does NOT apply the custom tag when the instance registry lacks the handler', () => {
    // A default parser (empty registry, no custom handler) must not populate the
    // custom namespace, proving the effect above is registry-driven, not
    // hardcoded.
    const parser = new AnnotationParser();
    parser.tagRegistry = new TagHandlerRegistry();

    const result = parser.parse(file);
    const widget = result.nodeTypes.find((nt) => nt.functionName === 'widget');

    expect(widget).toBeDefined();
    expect(widget!.deploy?.['customns']).toBeUndefined();
  });
});
