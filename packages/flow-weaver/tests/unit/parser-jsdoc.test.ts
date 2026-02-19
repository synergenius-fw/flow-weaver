/**
 * Tests for parser JSDoc extraction
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parser } from "../../src/parser";

describe("Parser JSDoc Extraction", () => {
  const uniqueId = `parser-jsdoc-${process.pid}-${Date.now()}`;
  const tempDir = path.join(os.tmpdir(), `flow-weaver-${uniqueId}`);

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it("should only capture JSDoc + function, not preceding comments", () => {
    const sourceCode = `
// @flow-weaver-runtime-end
// Some random comment before

// ============================================================================
// NODE DEFINITIONS
// ============================================================================

/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items - Array to iterate
 * @output results - All processed results
 */
function forEach(items: any[]) {
  return { results: items };
}
`;

    const testFile = path.join(tempDir, "test-jsdoc-extraction.ts");
    fs.writeFileSync(testFile, sourceCode, "utf-8");

    try {
      const result = parser.parse(testFile);
      const nodeType = result.nodeTypes[0];

      expect(nodeType).toBeDefined();
      expect(nodeType.functionText).toBeDefined();

      // Should NOT contain preceding comments
      expect(nodeType.functionText).not.toContain("@flow-weaver-runtime-end");
      expect(nodeType.functionText).not.toContain("Some random comment");
      expect(nodeType.functionText).not.toContain("NODE DEFINITIONS");

      // Should contain JSDoc and function
      expect(nodeType.functionText).toContain("@flowWeaver nodeType");
      expect(nodeType.functionText).toContain("@label For Each");
      expect(nodeType.functionText).toContain("function forEach");
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });

  it("should capture multi-line JSDoc with description", () => {
    const sourceCode = `
/**
 * This is a description of the node.
 * It spans multiple lines.
 *
 * @flowWeaver nodeType
 * @label My Node
 * @input x - The X value
 * @output result - The result
 */
function myNode(x: number) {
  return { result: x * 2 };
}
`;

    const testFile = path.join(tempDir, "test-jsdoc-multiline.ts");
    fs.writeFileSync(testFile, sourceCode, "utf-8");

    try {
      const result = parser.parse(testFile);
      const nodeType = result.nodeTypes[0];

      expect(nodeType).toBeDefined();
      expect(nodeType.functionText).toContain("This is a description of the node.");
      expect(nodeType.functionText).toContain("It spans multiple lines.");
      expect(nodeType.functionText).toContain("@flowWeaver nodeType");
      expect(nodeType.functionText).toContain("function myNode");
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });

  it("should NOT parse commented-out node types", () => {
    // This simulates the default template with a commented example
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @label My Node
 * @input value
 * @output result
 */
function myNode(
  execute: boolean,
  value: number
): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, result: 0 };
  }
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

// ============================================================
// SCOPED NODE TEMPLATE
// ============================================================
// /**
//  * @flowWeaver nodeType
//  * @label For Each
//  * @scope iteration
//  * @input items
//  * @output results
//  */
// function forEach(execute: boolean, items: any[]) {}
`;

    const testFile = path.join(tempDir, "test-commented-nodetype.ts");
    fs.writeFileSync(testFile, sourceCode, "utf-8");

    try {
      const result = parser.parse(testFile);

      // Should only parse ONE node type (myNode), NOT the commented forEach
      expect(result.nodeTypes).toHaveLength(1);
      expect(result.nodeTypes[0].name).toBe("myNode");

      // The commented forEach should NOT be parsed
      const forEachNodeType = result.nodeTypes.find(nt => nt.name === "forEach");
      expect(forEachNodeType).toBeUndefined();
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });

  it("should parse node instance labels from @node tag [label: ...] attribute", () => {
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function double(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node doubler1 double [label: "My Custom Label"]
 * @node doubler2 double [label: "Label with \\"quotes\\""]
 * @node doubler3 double
 * @position doubler1 100 100
 * @position doubler2 200 100
 * @position doubler3 300 100
 */
export function myWorkflow(execute: boolean) {
  return { onSuccess: true };
}
`;

    const testFile = path.join(tempDir, "test-node-label.ts");
    fs.writeFileSync(testFile, sourceCode, "utf-8");

    try {
      const result = parser.parse(testFile);
      const workflow = result.workflows[0];

      expect(workflow).toBeDefined();
      expect(workflow.instances).toHaveLength(3);

      // First instance should have the label
      const doubler1 = workflow.instances.find(i => i.id === "doubler1");
      expect(doubler1).toBeDefined();
      expect(doubler1!.config?.label).toBe("My Custom Label");

      // Second instance should have label with escaped quotes
      const doubler2 = workflow.instances.find(i => i.id === "doubler2");
      expect(doubler2).toBeDefined();
      expect(doubler2!.config?.label).toBe('Label with "quotes"');

      // Third instance should have no label (undefined)
      const doubler3 = workflow.instances.find(i => i.id === "doubler3");
      expect(doubler3).toBeDefined();
      expect(doubler3!.config?.label).toBeUndefined();
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });

  it("should parse port constant expressions from @node tag [expr: ...] attribute", () => {
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function double(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node calc1 double [expr: value="5"]
 * @node calc2 double [expr: x="(ctx) => ctx.a + \\"test\\""]
 * @node calc3 double
 * @position calc1 100 100
 * @position calc2 200 100
 * @position calc3 300 100
 */
export function myWorkflow(execute: boolean) {
  return { onSuccess: true };
}
`;

    const testFile = path.join(tempDir, "test-expr-parsing.ts");
    fs.writeFileSync(testFile, sourceCode, "utf-8");

    try {
      const result = parser.parse(testFile);
      const workflow = result.workflows[0];

      expect(workflow).toBeDefined();
      expect(workflow.instances).toHaveLength(3);

      // First instance should have constant expression
      const calc1 = workflow.instances.find(i => i.id === "calc1");
      expect(calc1).toBeDefined();
      expect(calc1!.config?.portConfigs).toBeDefined();
      const calc1PortConfig = calc1!.config!.portConfigs!.find(pc => pc.portName === "value");
      expect(calc1PortConfig).toBeDefined();
      expect(calc1PortConfig!.expression).toEqual("5");

      // Second instance should have expression with unescaped quotes
      const calc2 = workflow.instances.find(i => i.id === "calc2");
      expect(calc2).toBeDefined();
      const calc2PortConfig = calc2!.config!.portConfigs!.find(pc => pc.portName === "x");
      expect(calc2PortConfig).toBeDefined();
      expect(calc2PortConfig!.expression).toEqual('(ctx) => ctx.a + "test"');

      // Third instance should have no portConfigs (no expression)
      const calc3 = workflow.instances.find(i => i.id === "calc3");
      expect(calc3).toBeDefined();
      expect(calc3!.config?.portConfigs).toBeUndefined();
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });

  it("should parse @name tag for node types", () => {
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @label My Display Label
 * @name myDisplayName
 * @input value
 * @output result
 */
function randomGeneratedId123(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}
`;

    const testFile = path.join(tempDir, "test-name-tag.ts");
    fs.writeFileSync(testFile, sourceCode, "utf-8");

    try {
      const result = parser.parse(testFile);
      const nodeType = result.nodeTypes[0];

      expect(nodeType).toBeDefined();
      // name should come from @name tag, not function name
      expect(nodeType.name).toBe("myDisplayName");
      // functionName should be the actual function identifier
      expect(nodeType.functionName).toBe("randomGeneratedId123");
      // label should come from @label tag
      expect(nodeType.label).toBe("My Display Label");
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });

  it("should default name to functionName when @name tag is missing", () => {
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @label My Node
 * @input value
 * @output result
 */
function myFunction(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}
`;

    const testFile = path.join(tempDir, "test-name-default.ts");
    fs.writeFileSync(testFile, sourceCode, "utf-8");

    try {
      const result = parser.parse(testFile);
      const nodeType = result.nodeTypes[0];

      expect(nodeType).toBeDefined();
      // Both name and functionName should be the function identifier
      expect(nodeType.name).toBe("myFunction");
      expect(nodeType.functionName).toBe("myFunction");
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });

  it("should include ALL nodeTypes in workflow AST, even if not used by instances", () => {
    // This is a regression test for a bug where nodeTypes were filtered to only
    // include ones used by instances. This caused newly created nodeTypes to be
    // removed during subsequent operations (like addNode) because no instances
    // existed yet to reference them.
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @label Used Node
 * @input value
 * @output result
 */
function usedNode(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver nodeType
 * @label Unused Node
 * @input x
 * @output y
 */
function unusedNode(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, y: x * 2 };
}

/**
 * @flowWeaver workflow
 * @node instance1 usedNode
 * @position instance1 100 100
 */
export function myWorkflow(execute: boolean) {
  return { onSuccess: true };
}
`;

    const testFile = path.join(tempDir, "test-unused-nodetype.ts");
    fs.writeFileSync(testFile, sourceCode, "utf-8");

    try {
      const result = parser.parse(testFile);
      const workflow = result.workflows[0];

      expect(workflow).toBeDefined();

      // The workflow should include BOTH nodeTypes, not just the used one
      // Also includes the workflow itself as IMPORTED_WORKFLOW variant
      expect(workflow.nodeTypes).toHaveLength(3);

      const usedNodeType = workflow.nodeTypes.find(nt => nt.functionName === "usedNode");
      const unusedNodeType = workflow.nodeTypes.find(nt => nt.functionName === "unusedNode");

      expect(usedNodeType).toBeDefined();
      expect(unusedNodeType).toBeDefined();

      // Both should have functionText preserved
      expect(usedNodeType!.functionText).toContain("function usedNode");
      expect(unusedNodeType!.functionText).toContain("function unusedNode");
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });

  it("should parse description from JSDoc comment text (before tags)", () => {
    const sourceCode = `
/**
 * This is a description of the node.
 * It spans multiple lines.
 *
 * @flowWeaver nodeType
 * @label My Node
 * @input x
 * @output result
 */
function myNode(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x * 2 };
}

/**
 * @flowWeaver workflow
 */
export function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}
`;

    const testFile = path.join(tempDir, "test-description-parsing.ts");
    fs.writeFileSync(testFile, sourceCode, "utf-8");

    try {
      const result = parser.parse(testFile);
      const nodeType = result.nodeTypes[0];

      expect(nodeType).toBeDefined();
      expect(nodeType.description).toBe("This is a description of the node.\nIt spans multiple lines.");
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });

  it("should parse single-line description from JSDoc", () => {
    const sourceCode = `
/**
 * A simple description.
 * @flowWeaver nodeType
 * @label Simple Node
 * @input value
 * @output result
 */
function simpleNode(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 */
export function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}
`;

    const testFile = path.join(tempDir, "test-single-line-description.ts");
    fs.writeFileSync(testFile, sourceCode, "utf-8");

    try {
      const result = parser.parse(testFile);
      const nodeType = result.nodeTypes[0];

      expect(nodeType).toBeDefined();
      expect(nodeType.description).toBe("A simple description.");
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });

  it("should have undefined description when no description text present", () => {
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @label No Description Node
 * @input value
 * @output result
 */
function noDescNode(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 */
export function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}
`;

    const testFile = path.join(tempDir, "test-no-description.ts");
    fs.writeFileSync(testFile, sourceCode, "utf-8");

    try {
      const result = parser.parse(testFile);
      const nodeType = result.nodeTypes[0];

      expect(nodeType).toBeDefined();
      expect(nodeType.description).toBeUndefined();
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });

  it("should preserve full generic type in output port tsType (Record<string, unknown>)", () => {
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @expression
 * @output report - Combined report
 * @output count - Number of items
 */
function mergeResults(
  a: string,
  b: string
): { report: Record<string, unknown>; count: number } {
  return { report: { [a]: b }, count: 1 };
}
`;

    const testFile = path.join(tempDir, "test-generic-output-type.ts");
    fs.writeFileSync(testFile, sourceCode, "utf-8");

    try {
      const result = parser.parse(testFile);
      const nodeType = result.nodeTypes[0];

      expect(nodeType).toBeDefined();
      expect(nodeType.outputs.report).toBeDefined();
      expect(nodeType.outputs.report.tsType).toBe("Record<string, unknown>");
      expect(nodeType.outputs.count).toBeDefined();
      expect(nodeType.outputs.count.tsType).toBe("number");
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });

});
