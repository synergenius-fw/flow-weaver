/**
 * Tests for JSDoc visual annotations: @color, @icon, @tag
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parser } from "../../src/parser";
import type { ParseResult } from "../../src/parser";

describe("JSDoc visual annotations", () => {
  const uniqueId = `jsdoc-visuals-${process.pid}-${Date.now()}`;
  const tempDir = path.join(os.tmpdir(), `flow-weaver-${uniqueId}`);

  // All test source code definitions
  const testSources: Record<string, string> = {
    'test-color': `
/**
 * @flowWeaver nodeType
 * @color blue
 * @input value
 * @output result
 */
function myNode(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 */
export function testWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}
`,
    'test-icon': `
/**
 * @flowWeaver nodeType
 * @icon api
 * @input value
 * @output result
 */
function myNode(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 */
export function testWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}
`,
    'test-tag-tooltip': `
/**
 * @flowWeaver nodeType
 * @tag async "Runs asynchronously"
 * @input value
 * @output result
 */
function myNode(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 */
export function testWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}
`,
    'test-tag-no-tooltip': `
/**
 * @flowWeaver nodeType
 * @tag deprecated
 * @input value
 * @output result
 */
function myNode(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 */
export function testWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}
`,
    'test-multiple-tags': `
/**
 * @flowWeaver nodeType
 * @tag async "Non-blocking"
 * @tag io
 * @tag v2
 * @input value
 * @output result
 */
function myNode(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 */
export function testWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}
`,
    'test-all-visuals': `
/**
 * Fetches user data from the API.
 *
 * @flowWeaver nodeType
 * @color purple
 * @icon rocketLaunch
 * @tag async "Non-blocking"
 * @tag io
 * @input userId
 * @output userData
 */
function fetchUser(execute: boolean, userId: string) {
  return { onSuccess: true, onFailure: false, userData: { id: userId } };
}

/**
 * @flowWeaver workflow
 */
export function testWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}
`,
    'test-no-visuals': `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function myNode(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 */
export function testWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}
`,
  };

  // Store parse results keyed by test name
  const results: Record<string, ParseResult> = {};

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    // Write all files, then parse all files
    for (const [name, source] of Object.entries(testSources)) {
      fs.writeFileSync(path.join(tempDir, `${name}.ts`), source, "utf-8");
    }
    for (const name of Object.keys(testSources)) {
      results[name] = parser.parse(path.join(tempDir, `${name}.ts`));
    }
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it("should parse @color annotation", () => {
    const nodeType = results['test-color'].nodeTypes[0];
    expect(nodeType).toBeDefined();
    expect(nodeType.visuals?.color).toBe("blue");
  });

  it("should parse @icon annotation", () => {
    const nodeType = results['test-icon'].nodeTypes[0];
    expect(nodeType).toBeDefined();
    expect(nodeType.visuals?.icon).toBe("api");
  });

  it("should parse @tag with tooltip", () => {
    const nodeType = results['test-tag-tooltip'].nodeTypes[0];
    expect(nodeType).toBeDefined();
    expect(nodeType.visuals?.tags).toEqual([
      { label: "async", tooltip: "Runs asynchronously" }
    ]);
  });

  it("should parse @tag without tooltip", () => {
    const nodeType = results['test-tag-no-tooltip'].nodeTypes[0];
    expect(nodeType).toBeDefined();
    expect(nodeType.visuals?.tags).toEqual([{ label: "deprecated" }]);
  });

  it("should parse multiple @tag annotations", () => {
    const nodeType = results['test-multiple-tags'].nodeTypes[0];
    expect(nodeType).toBeDefined();
    expect(nodeType.visuals?.tags).toHaveLength(3);
    expect(nodeType.visuals?.tags).toEqual([
      { label: "async", tooltip: "Non-blocking" },
      { label: "io" },
      { label: "v2" }
    ]);
  });

  it("should parse all visual annotations together", () => {
    const nodeType = results['test-all-visuals'].nodeTypes[0];
    expect(nodeType).toBeDefined();
    expect(nodeType.visuals).toEqual({
      color: "purple",
      icon: "rocketLaunch",
      tags: [
        { label: "async", tooltip: "Non-blocking" },
        { label: "io" }
      ]
    });
  });

  it("should have undefined visuals when no visual annotations present", () => {
    const nodeType = results['test-no-visuals'].nodeTypes[0];
    expect(nodeType).toBeDefined();
    expect(nodeType.visuals).toBeUndefined();
  });
});
