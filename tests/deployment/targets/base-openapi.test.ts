/**
 * The OpenAPI documents an export target writes for a node-type service, a
 * multi-workflow service and a bundle. Packs call these builders from their
 * own targets, so the whole document is pinned, and every document must be
 * valid OpenAPI 3.0: a schema `type` is one of the six the specification
 * allows. (`any` is not one of them; a value of any type has no `type`.)
 */
import { describe, it, expect } from 'vitest';
import {
  BaseExportTarget,
  type ExportArtifacts,
  type MultiWorkflowArtifacts,
  type NodeTypeArtifacts,
  type BundleArtifacts,
  type DeployInstructions,
  type NodeTypeInfo,
  type CompiledWorkflow,
  type BundleWorkflow,
  type BundleNodeType,
} from '../../../src/deployment/targets/base';

class Target extends BaseExportTarget {
  readonly name = 'openapi-test';
  readonly description = 'Exposes the OpenAPI builders';
  async generate(): Promise<ExportArtifacts> { throw new Error('unused'); }
  async generateMultiWorkflow(): Promise<MultiWorkflowArtifacts> { throw new Error('unused'); }
  async generateNodeTypeService(): Promise<NodeTypeArtifacts> { throw new Error('unused'); }
  async generateBundle(): Promise<BundleArtifacts> { throw new Error('unused'); }
  getDeployInstructions(): DeployInstructions { throw new Error('unused'); }
  nodeTypes(n: NodeTypeInfo[], o: { title: string; version: string; baseUrl?: string }) { return this.generateNodeTypeOpenAPI(n, o); }
  consolidated(w: CompiledWorkflow[], o: { title: string; version: string; baseUrl?: string }) { return this.generateConsolidatedOpenAPI(w, o); }
  bundle(w: BundleWorkflow[], n: BundleNodeType[], o: { title: string; version: string; baseUrl?: string }) { return this.generateBundleOpenAPI(w, n, o); }
}

const nodeTypes: NodeTypeInfo[] = [
  {
    name: 'FetchData',
    functionName: 'fetchData',
    description: 'Fetches data from an API',
    inputs: {
      execute: { dataType: 'STEP' },
      url: { dataType: 'STRING', label: 'URL', tsType: 'string' },
      headers: { dataType: 'OBJECT', label: 'Headers', optional: true },
    },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      data: { dataType: 'OBJECT', label: 'Response data' },
      status: { dataType: 'NUMBER' },
    },
  },
  {
    name: 'Anything',
    functionName: 'anything',
    inputs: {
      value: { dataType: 'ANY', label: 'Any value' },
      mystery: { dataType: 'SOMETHING_NEW' },
      handler: { dataType: 'FUNCTION' },
      list: { dataType: 'ARRAY', optional: true },
      flag: { dataType: 'BOOLEAN' },
    },
    outputs: {
      result: { dataType: 'ANY' },
    },
  },
];

const workflows: CompiledWorkflow[] = [
  { name: 'validate-input', functionName: 'validateInput', description: 'Validates user input' },
  { name: 'send-email', functionName: 'sendEmail' },
];

const options = { title: 'Test API', version: '1.2.3' };

const ALLOWED_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);

/** Every `type` in a schema position, with the path it sits at. */
function schemaTypes(node: unknown, at = '$'): Array<{ at: string; type: unknown }> {
  if (!node || typeof node !== 'object') return [];
  const out: Array<{ at: string; type: unknown }> = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' && !at.endsWith('.tags')) out.push({ at, type: value });
    out.push(...schemaTypes(value, `${at}.${key}`));
  }
  return out;
}

describe('export target OpenAPI documents', () => {
  const target = new Target();

  it('pins the node-type service document', () => {
    expect(target.nodeTypes(nodeTypes, { ...options, baseUrl: 'https://api.example.com' })).toMatchSnapshot();
  });

  it('pins the multi-workflow service document', () => {
    expect(target.consolidated(workflows, options)).toMatchSnapshot();
  });

  it('pins the bundle document', () => {
    const bundleWorkflows: BundleWorkflow[] = [{ ...workflows[0], expose: true }, { ...workflows[1], expose: false }];
    const bundleNodeTypes: BundleNodeType[] = nodeTypes.map((n, i) => ({ ...n, expose: i === 0 }));
    expect(target.bundle(bundleWorkflows, bundleNodeTypes, options)).toMatchSnapshot();
  });

  it('writes only types OpenAPI 3.0 allows, leaving a value of any type untyped', () => {
    const bundleNodeTypes: BundleNodeType[] = nodeTypes.map((n) => ({ ...n, expose: true }));
    const documents = [
      target.nodeTypes(nodeTypes, options),
      target.consolidated(workflows, options),
      target.bundle(workflows.map((w) => ({ ...w, expose: true })), bundleNodeTypes, options),
    ];
    for (const doc of documents) {
      const invalid = schemaTypes(doc).filter(({ type }) => typeof type !== 'string' || !ALLOWED_TYPES.has(type));
      expect(invalid).toEqual([]);
    }
    const anything = (target.nodeTypes(nodeTypes, options) as {
      paths: Record<string, { post: { requestBody: { content: { 'application/json': { schema: { properties: Record<string, Record<string, unknown>> } } } } } }>;
    }).paths['/api/Anything'].post.requestBody.content['application/json'].schema.properties;
    expect(anything.value).toEqual({ description: 'Any value' });
    expect(anything.mystery).toEqual({ description: 'mystery' });
    expect(anything.handler.type).toBe('object');
  });

  it('describes a bundle that exposes nothing, and still serves the registry and the document', () => {
    const doc = target.bundle(
      workflows.map((w) => ({ ...w, expose: false })),
      nodeTypes.map((n) => ({ ...n, expose: false })),
      options,
    ) as { info: { description: string }; paths: Record<string, unknown>; tags: Array<{ name: string }> };
    expect(doc.info.description).toBe('Bundle service with no workflows or node types exposed');
    expect(Object.keys(doc.paths)).toEqual(['/api/functions', '/api/openapi.json']);
    expect(doc.tags.map((t) => t.name)).toEqual(['functions', 'documentation']);
  });

  it('counts a single exposed item in the singular', () => {
    const doc = target.bundle(
      [{ ...workflows[0], expose: true }],
      [{ ...nodeTypes[0], expose: true }],
      options,
    ) as { info: { description: string } };
    expect(doc.info.description).toBe('Bundle service with 1 workflow and 1 node type exposed');
  });

  it('leaves out `required` when every input is optional, and omits STEP ports on both sides', () => {
    const doc = target.nodeTypes(
      [{ name: 'Opt', functionName: 'opt', inputs: { execute: { dataType: 'STEP' }, a: { dataType: 'STRING', optional: true } }, outputs: { onSuccess: { dataType: 'STEP' } } }],
      options,
    ) as { paths: Record<string, { post: { requestBody: { content: { 'application/json': { schema: { properties: object; required?: string[] } } } }; responses: Record<string, { content: { 'application/json': { schema: { properties: { result: { properties: object } } } } } }> } }> };
    const post = doc.paths['/api/Opt'].post;
    const request = post.requestBody.content['application/json'].schema;
    expect(request.required).toBeUndefined();
    expect(Object.keys(request.properties)).toEqual(['a']);
    expect(post.responses['200'].content['application/json'].schema.properties.result.properties).toEqual({});
  });
});
