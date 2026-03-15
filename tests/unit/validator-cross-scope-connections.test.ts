/**
 * TDD tests for cross-scope connection validation.
 *
 * When a child in scope "a" connects to a child in scope "b" (non-scoped connection),
 * the validator should flag it. Children in different scopes execute in separate
 * callback contexts and cannot share data directly.
 */
import { WorkflowValidator } from "../../src/validator";
import type {
  TWorkflowAST,
  TNodeTypeAST,
  TNodeInstanceAST,
  TConnectionAST,
} from "../../src/ast/types";

function createWorkflow(
  instances: Partial<TNodeInstanceAST>[],
  connections: Partial<TConnectionAST>[],
  nodeTypes?: Partial<TNodeTypeAST>[],
): TWorkflowAST {
  const defaultNodeTypes: TNodeTypeAST[] = [
    {
      type: "NodeType",
      name: "ScopedParent",
      functionName: "ScopedParent",
      variant: "FUNCTION",
      scopes: ["a", "b"],
      inputs: {
        execute: { dataType: "STEP" },
        success: { dataType: "STEP", scope: "a" },
        failure: { dataType: "STEP", scope: "a", failure: true },
        "success\0b": { dataType: "STEP", scope: "b" },
        "failure\0b": { dataType: "STEP", scope: "b", failure: true },
      },
      outputs: {
        onSuccess: { dataType: "STEP", isControlFlow: true },
        onFailure: { dataType: "STEP", isControlFlow: true, failure: true },
        start: { dataType: "STEP", scope: "a" },
        a1: { dataType: "STRING", scope: "a" },
        "start\0b": { dataType: "STEP", scope: "b" },
        b1: { dataType: "NUMBER", scope: "b" },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: true,
    } as TNodeTypeAST,
    {
      type: "NodeType",
      name: "ChildNode",
      functionName: "ChildNode",
      variant: "FUNCTION",
      inputs: { execute: { dataType: "STEP" } },
      outputs: {
        onSuccess: { dataType: "STEP", isControlFlow: true },
        onFailure: { dataType: "STEP", isControlFlow: true, failure: true },
        result: { dataType: "STRING" },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
    } as TNodeTypeAST,
    ...(nodeTypes ?? []) as TNodeTypeAST[],
  ];

  return {
    type: "Workflow",
    name: "testWorkflow",
    functionName: "testWorkflow",
    instances: instances.map((i) => ({
      type: "NodeInstance",
      id: i.id!,
      nodeType: i.nodeType!,
      ...i,
    })) as TNodeInstanceAST[],
    connections: connections.map((c) => ({
      type: "Connection",
      ...c,
    })) as TConnectionAST[],
    nodeTypes: defaultNodeTypes,
    startPorts: { execute: { dataType: "STEP" } },
    exitPorts: {
      onSuccess: { dataType: "STEP" },
      onFailure: { dataType: "STEP" },
    },
  } as TWorkflowAST;
}

function getErrors(workflow: TWorkflowAST) {
  const v = new WorkflowValidator();
  const result = v.validate(workflow);
  return result.errors;
}

function getWarnings(workflow: TWorkflowAST) {
  const v = new WorkflowValidator();
  const result = v.validate(workflow);
  return result.warnings;
}

describe("Cross-scope connection validation", () => {
  it("should error when a child in scope 'a' connects to a child in scope 'b'", () => {
    const wf = createWorkflow(
      [
        { id: "parent1", nodeType: "ScopedParent" },
        { id: "childA", nodeType: "ChildNode", parent: { id: "parent1", scope: "a" } },
        { id: "childB", nodeType: "ChildNode", parent: { id: "parent1", scope: "b" } },
      ],
      [
        // Non-scoped connection crossing scope boundary
        {
          from: { node: "childA", port: "result" },
          to: { node: "childB", port: "execute" },
        },
      ],
    );

    const errors = getErrors(wf);
    const crossScopeErrors = errors.filter(
      (e) => e.code === "CROSS_SCOPE_CONNECTION",
    );
    expect(crossScopeErrors.length).toBeGreaterThan(0);
  });

  it("should allow connections between children in the SAME scope", () => {
    const wf = createWorkflow(
      [
        { id: "parent1", nodeType: "ScopedParent" },
        { id: "child1", nodeType: "ChildNode", parent: { id: "parent1", scope: "a" } },
        { id: "child2", nodeType: "ChildNode", parent: { id: "parent1", scope: "a" } },
      ],
      [
        {
          from: { node: "child1", port: "result" },
          to: { node: "child2", port: "execute" },
        },
      ],
    );

    const errors = getErrors(wf);
    const crossScopeErrors = errors.filter(
      (e) => e.code === "CROSS_SCOPE_CONNECTION",
    );
    expect(crossScopeErrors).toHaveLength(0);
  });

  it("should error when a scoped child connects to a root-level node", () => {
    const wf = createWorkflow(
      [
        { id: "parent1", nodeType: "ScopedParent" },
        { id: "childA", nodeType: "ChildNode", parent: { id: "parent1", scope: "a" } },
        { id: "rootNode", nodeType: "ChildNode" },
      ],
      [
        // Child in scope connecting to root node (outside scope)
        {
          from: { node: "childA", port: "result" },
          to: { node: "rootNode", port: "execute" },
        },
      ],
    );

    const errors = getErrors(wf);
    const crossScopeErrors = errors.filter(
      (e) => e.code === "CROSS_SCOPE_CONNECTION",
    );
    expect(crossScopeErrors.length).toBeGreaterThan(0);
  });

  it("should allow scoped connections from parent to child (inner ports)", () => {
    const wf = createWorkflow(
      [
        { id: "parent1", nodeType: "ScopedParent" },
        { id: "childA", nodeType: "ChildNode", parent: { id: "parent1", scope: "a" } },
      ],
      [
        // Parent's scoped inner port -> child (valid)
        {
          from: { node: "parent1", port: "start", scope: "a" },
          to: { node: "childA", port: "execute" },
        },
      ],
    );

    const errors = getErrors(wf);
    const crossScopeErrors = errors.filter(
      (e) => e.code === "CROSS_SCOPE_CONNECTION",
    );
    expect(crossScopeErrors).toHaveLength(0);
  });

  it("should allow connections between root-level nodes", () => {
    const wf = createWorkflow(
      [
        { id: "parent1", nodeType: "ScopedParent" },
        { id: "rootNode", nodeType: "ChildNode" },
      ],
      [
        {
          from: { node: "parent1", port: "onSuccess" },
          to: { node: "rootNode", port: "execute" },
        },
      ],
    );

    const errors = getErrors(wf);
    const crossScopeErrors = errors.filter(
      (e) => e.code === "CROSS_SCOPE_CONNECTION",
    );
    expect(crossScopeErrors).toHaveLength(0);
  });

  it("should error when child connects to a node in a different parent's scope", () => {
    const wf = createWorkflow(
      [
        { id: "parent1", nodeType: "ScopedParent" },
        { id: "parent2", nodeType: "ScopedParent" },
        { id: "childP1", nodeType: "ChildNode", parent: { id: "parent1", scope: "a" } },
        { id: "childP2", nodeType: "ChildNode", parent: { id: "parent2", scope: "a" } },
      ],
      [
        // Cross-parent scope connection
        {
          from: { node: "childP1", port: "result" },
          to: { node: "childP2", port: "execute" },
        },
      ],
    );

    const errors = getErrors(wf);
    const crossScopeErrors = errors.filter(
      (e) => e.code === "CROSS_SCOPE_CONNECTION",
    );
    expect(crossScopeErrors.length).toBeGreaterThan(0);
  });
});
