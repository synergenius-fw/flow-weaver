import { describe, it, expect } from "vitest";
import {
  extractStartPorts,
  extractExitPorts,
  getNodeType,
  getConnectionsFrom,
  getConnectionsTo,
  hasBranching,
} from "../../../src/ast/workflow-utils.js";
import type {
  TWorkflowAST,
  TNodeTypeAST,
  TConnectionAST,
} from "../../../src/ast/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function minimalWorkflow(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
  return {
    type: "Workflow",
    name: "test",
    functionName: "test",
    sourceFile: "test.ts",
    nodeTypes: [],
    instances: [],
    connections: [],
    startPorts: {},
    exitPorts: {},
    imports: [],
    ...overrides,
  };
}

function makeNodeType(overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: "NodeType",
    name: "Default",
    functionName: "defaultFn",
    inputs: {},
    outputs: {},
    hasSuccessPort: false,
    hasFailurePort: false,
    executeWhen: "CONJUNCTION",
    isAsync: false,
    ...overrides,
  };
}

function makeConnection(
  fromNode: string,
  fromPort: string,
  toNode: string,
  toPort: string,
): TConnectionAST {
  return {
    type: "Connection",
    from: { node: fromNode, port: fromPort },
    to: { node: toNode, port: toPort },
  };
}

// ---------------------------------------------------------------------------
// extractStartPorts
// ---------------------------------------------------------------------------

describe("extractStartPorts", () => {
  it("returns explicit startPorts when they are defined on the workflow", () => {
    const wf = minimalWorkflow({
      startPorts: {
        execute: { dataType: "STEP", isControlFlow: true },
        input: { dataType: "STRING" },
      },
    });
    const ports = extractStartPorts(wf);
    expect(ports).toEqual(wf.startPorts);
  });

  it("always includes the execute control flow port when inferring", () => {
    const wf = minimalWorkflow({
      startPorts: {} as any, // empty but truthy triggers early return
    });
    // The function returns startPorts directly when defined (even if empty),
    // so we test the inference path by removing startPorts entirely.
    // TWorkflowAST requires startPorts, so we delete it at runtime.
    const wfNoStart = { ...minimalWorkflow(), startPorts: undefined } as any;
    delete wfNoStart.startPorts;
    // extractStartPorts checks `if (workflow.startPorts)`, so falsy triggers inference.
    const ports = extractStartPorts(wfNoStart);
    expect(ports.execute).toEqual({ dataType: "STEP", isControlFlow: true });
  });

  it("infers port types from target node type inputs when Start connections exist", () => {
    const wf = minimalWorkflow({
      nodeTypes: [
        makeNodeType({
          name: "Adder",
          inputs: {
            execute: { dataType: "STEP", isControlFlow: true },
            value: { dataType: "NUMBER", tsType: "number" },
          },
        }),
      ],
      connections: [
        makeConnection("Start", "execute", "Adder", "execute"),
        makeConnection("Start", "value", "Adder", "value"),
      ],
    });
    // Remove startPorts to trigger inference
    const wfInfer = { ...wf, startPorts: undefined } as any;
    delete wfInfer.startPorts;

    const ports = extractStartPorts(wfInfer);
    expect(ports.execute).toEqual({ dataType: "STEP", isControlFlow: true });
    expect(ports.value).toEqual({ dataType: "NUMBER", tsType: "number" });
  });

  it("falls back to ANY when the target node type is not found", () => {
    const wf = minimalWorkflow({
      nodeTypes: [],
      connections: [makeConnection("Start", "data", "Unknown", "input")],
    });
    const wfInfer = { ...wf, startPorts: undefined } as any;
    delete wfInfer.startPorts;

    const ports = extractStartPorts(wfInfer);
    expect(ports.data).toEqual({ dataType: "ANY" });
  });

  it("falls back to ANY when the target port is not found on the node type", () => {
    const wf = minimalWorkflow({
      nodeTypes: [
        makeNodeType({
          name: "Adder",
          inputs: { execute: { dataType: "STEP" } },
        }),
      ],
      connections: [makeConnection("Start", "missing", "Adder", "nonexistent")],
    });
    const wfInfer = { ...wf, startPorts: undefined } as any;
    delete wfInfer.startPorts;

    const ports = extractStartPorts(wfInfer);
    expect(ports.missing).toEqual({ dataType: "ANY" });
  });

  it("does not include connections from non-Start nodes", () => {
    const wf = minimalWorkflow({
      nodeTypes: [makeNodeType({ name: "A" }), makeNodeType({ name: "B" })],
      connections: [
        makeConnection("Start", "execute", "A", "execute"),
        makeConnection("A", "onSuccess", "B", "execute"),
      ],
    });
    const wfInfer = { ...wf, startPorts: undefined } as any;
    delete wfInfer.startPorts;

    const ports = extractStartPorts(wfInfer);
    // Should only have execute (from Start->A), not onSuccess (from A->B)
    expect(Object.keys(ports)).toEqual(["execute"]);
  });

  it("returns only the execute port when there are no Start connections", () => {
    const wf = minimalWorkflow({
      connections: [makeConnection("A", "out", "B", "in")],
    });
    const wfInfer = { ...wf, startPorts: undefined } as any;
    delete wfInfer.startPorts;

    const ports = extractStartPorts(wfInfer);
    expect(Object.keys(ports)).toEqual(["execute"]);
  });
});

// ---------------------------------------------------------------------------
// extractExitPorts
// ---------------------------------------------------------------------------

describe("extractExitPorts", () => {
  it("returns explicit exitPorts when they are defined on the workflow", () => {
    const wf = minimalWorkflow({
      exitPorts: {
        onSuccess: { dataType: "STEP", isControlFlow: true },
        result: { dataType: "NUMBER" },
      },
    });
    const ports = extractExitPorts(wf);
    expect(ports).toEqual(wf.exitPorts);
  });

  it("infers port types from source node type outputs when Exit connections exist", () => {
    const wf = minimalWorkflow({
      nodeTypes: [
        makeNodeType({
          name: "Calculator",
          outputs: {
            onSuccess: { dataType: "STEP", isControlFlow: true },
            result: { dataType: "NUMBER", tsType: "number" },
          },
        }),
      ],
      connections: [
        makeConnection("Calculator", "onSuccess", "Exit", "onSuccess"),
        makeConnection("Calculator", "result", "Exit", "result"),
      ],
    });
    const wfInfer = { ...wf, exitPorts: undefined } as any;
    delete wfInfer.exitPorts;

    const ports = extractExitPorts(wfInfer);
    expect(ports.onSuccess).toEqual({ dataType: "STEP", isControlFlow: true });
    expect(ports.result).toEqual({ dataType: "NUMBER", tsType: "number" });
  });

  it("falls back to ANY when the source node type is not found", () => {
    const wf = minimalWorkflow({
      nodeTypes: [],
      connections: [makeConnection("Unknown", "output", "Exit", "data")],
    });
    const wfInfer = { ...wf, exitPorts: undefined } as any;
    delete wfInfer.exitPorts;

    const ports = extractExitPorts(wfInfer);
    expect(ports.data).toEqual({ dataType: "ANY" });
  });

  it("falls back to ANY when the source port is not found on the node type", () => {
    const wf = minimalWorkflow({
      nodeTypes: [
        makeNodeType({
          name: "Foo",
          outputs: { x: { dataType: "STRING" } },
        }),
      ],
      connections: [makeConnection("Foo", "nonexistent", "Exit", "output")],
    });
    const wfInfer = { ...wf, exitPorts: undefined } as any;
    delete wfInfer.exitPorts;

    const ports = extractExitPorts(wfInfer);
    expect(ports.output).toEqual({ dataType: "ANY" });
  });

  it("does not include connections to non-Exit nodes", () => {
    const wf = minimalWorkflow({
      nodeTypes: [makeNodeType({ name: "A" }), makeNodeType({ name: "B" })],
      connections: [
        makeConnection("A", "out", "B", "in"),
        makeConnection("B", "result", "Exit", "result"),
      ],
    });
    const wfInfer = { ...wf, exitPorts: undefined } as any;
    delete wfInfer.exitPorts;

    const ports = extractExitPorts(wfInfer);
    expect(Object.keys(ports)).toEqual(["result"]);
  });

  it("returns empty object when there are no Exit connections", () => {
    const wf = minimalWorkflow({
      connections: [makeConnection("A", "out", "B", "in")],
    });
    const wfInfer = { ...wf, exitPorts: undefined } as any;
    delete wfInfer.exitPorts;

    const ports = extractExitPorts(wfInfer);
    expect(ports).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// getNodeType
// ---------------------------------------------------------------------------

describe("getNodeType", () => {
  const wf = minimalWorkflow({
    nodeTypes: [
      makeNodeType({ name: "Add", functionName: "add" }),
      makeNodeType({ name: "Multiply", functionName: "multiply" }),
      makeNodeType({ name: "Subtract", functionName: "subtract" }),
    ],
  });

  it("finds a node type by name", () => {
    const result = getNodeType(wf, "Add");
    expect(result).toBeDefined();
    expect(result!.name).toBe("Add");
    expect(result!.functionName).toBe("add");
  });

  it("returns the correct node when multiple exist", () => {
    expect(getNodeType(wf, "Multiply")!.functionName).toBe("multiply");
    expect(getNodeType(wf, "Subtract")!.functionName).toBe("subtract");
  });

  it("returns undefined for a non-existent node name", () => {
    expect(getNodeType(wf, "Divide")).toBeUndefined();
  });

  it("returns undefined when nodeTypes is empty", () => {
    const empty = minimalWorkflow();
    expect(getNodeType(empty, "Add")).toBeUndefined();
  });

  it("is case-sensitive", () => {
    expect(getNodeType(wf, "add")).toBeUndefined();
    expect(getNodeType(wf, "ADD")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getConnectionsFrom
// ---------------------------------------------------------------------------

describe("getConnectionsFrom", () => {
  const wf = minimalWorkflow({
    connections: [
      makeConnection("Start", "execute", "A", "execute"),
      makeConnection("A", "onSuccess", "B", "execute"),
      makeConnection("A", "result", "C", "input"),
      makeConnection("B", "onSuccess", "Exit", "onSuccess"),
    ],
  });

  it("returns all connections originating from a given node", () => {
    const conns = getConnectionsFrom(wf, "A");
    expect(conns).toHaveLength(2);
    expect(conns[0].from.port).toBe("onSuccess");
    expect(conns[1].from.port).toBe("result");
  });

  it("returns connections from Start", () => {
    const conns = getConnectionsFrom(wf, "Start");
    expect(conns).toHaveLength(1);
    expect(conns[0].to.node).toBe("A");
  });

  it("returns a single connection when only one exists", () => {
    const conns = getConnectionsFrom(wf, "B");
    expect(conns).toHaveLength(1);
    expect(conns[0].to.node).toBe("Exit");
  });

  it("returns empty array for a node with no outgoing connections", () => {
    const conns = getConnectionsFrom(wf, "C");
    expect(conns).toEqual([]);
  });

  it("returns empty array for a non-existent node", () => {
    const conns = getConnectionsFrom(wf, "NonExistent");
    expect(conns).toEqual([]);
  });

  it("returns empty array when workflow has no connections", () => {
    const empty = minimalWorkflow();
    expect(getConnectionsFrom(empty, "A")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getConnectionsTo
// ---------------------------------------------------------------------------

describe("getConnectionsTo", () => {
  const wf = minimalWorkflow({
    connections: [
      makeConnection("Start", "execute", "A", "execute"),
      makeConnection("A", "onSuccess", "B", "execute"),
      makeConnection("A", "result", "B", "data"),
      makeConnection("B", "onSuccess", "Exit", "onSuccess"),
    ],
  });

  it("returns all connections targeting a given node", () => {
    const conns = getConnectionsTo(wf, "B");
    expect(conns).toHaveLength(2);
    expect(conns[0].from.node).toBe("A");
    expect(conns[1].from.node).toBe("A");
  });

  it("returns connections to Exit", () => {
    const conns = getConnectionsTo(wf, "Exit");
    expect(conns).toHaveLength(1);
    expect(conns[0].from.node).toBe("B");
  });

  it("returns a single connection when only one targets the node", () => {
    const conns = getConnectionsTo(wf, "A");
    expect(conns).toHaveLength(1);
    expect(conns[0].from.node).toBe("Start");
  });

  it("returns empty array for a node with no incoming connections", () => {
    const conns = getConnectionsTo(wf, "Start");
    expect(conns).toEqual([]);
  });

  it("returns empty array for a non-existent node", () => {
    const conns = getConnectionsTo(wf, "NonExistent");
    expect(conns).toEqual([]);
  });

  it("returns empty array when workflow has no connections", () => {
    const empty = minimalWorkflow();
    expect(getConnectionsTo(empty, "B")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// hasBranching
// ---------------------------------------------------------------------------

describe("hasBranching", () => {
  it("returns false for an empty workflow", () => {
    const wf = minimalWorkflow();
    expect(hasBranching(wf)).toBe(false);
  });

  it("returns false for a linear workflow (no branching)", () => {
    const wf = minimalWorkflow({
      nodeTypes: [
        makeNodeType({ name: "A", hasSuccessPort: true }),
        makeNodeType({ name: "B", hasSuccessPort: true }),
      ],
      connections: [
        makeConnection("Start", "execute", "A", "execute"),
        makeConnection("A", "onSuccess", "B", "execute"),
        makeConnection("B", "onSuccess", "Exit", "onSuccess"),
      ],
    });
    expect(hasBranching(wf)).toBe(false);
  });

  it("returns true when a node has multiple outgoing success connections", () => {
    const wf = minimalWorkflow({
      nodeTypes: [makeNodeType({ name: "Fork" })],
      connections: [
        makeConnection("Fork", "onSuccess", "A", "execute"),
        makeConnection("Fork", "onSuccess", "B", "execute"),
      ],
    });
    expect(hasBranching(wf)).toBe(true);
  });

  it("returns true when a node has any failure connections", () => {
    const wf = minimalWorkflow({
      nodeTypes: [makeNodeType({ name: "Risky" })],
      connections: [
        makeConnection("Risky", "onFailure", "ErrorHandler", "execute"),
      ],
    });
    expect(hasBranching(wf)).toBe(true);
  });

  it("returns true when a node has both success and failure connections", () => {
    const wf = minimalWorkflow({
      nodeTypes: [makeNodeType({ name: "Branch" })],
      connections: [
        makeConnection("Branch", "onSuccess", "HappyPath", "execute"),
        makeConnection("Branch", "onFailure", "SadPath", "execute"),
      ],
    });
    expect(hasBranching(wf)).toBe(true);
  });

  it("returns false when only non-control-flow connections exist from a node type", () => {
    const wf = minimalWorkflow({
      nodeTypes: [makeNodeType({ name: "DataNode" })],
      connections: [
        makeConnection("DataNode", "result", "Consumer", "input"),
        makeConnection("DataNode", "count", "Logger", "value"),
      ],
    });
    expect(hasBranching(wf)).toBe(false);
  });

  it("returns false when a single success connection exists per node", () => {
    const wf = minimalWorkflow({
      nodeTypes: [
        makeNodeType({ name: "A" }),
        makeNodeType({ name: "B" }),
      ],
      connections: [
        makeConnection("A", "onSuccess", "B", "execute"),
        makeConnection("B", "onSuccess", "Exit", "onSuccess"),
      ],
    });
    expect(hasBranching(wf)).toBe(false);
  });

  it("only checks connections from nodeTypes, not from arbitrary nodes", () => {
    // Connections from "Unknown" (not in nodeTypes) should be ignored.
    const wf = minimalWorkflow({
      nodeTypes: [makeNodeType({ name: "A" })],
      connections: [
        makeConnection("A", "onSuccess", "B", "execute"),
        makeConnection("Unknown", "onSuccess", "C", "execute"),
        makeConnection("Unknown", "onSuccess", "D", "execute"),
      ],
    });
    // A only has one success connection. Unknown is not a nodeType, so not checked.
    expect(hasBranching(wf)).toBe(false);
  });

  it("detects branching even when only one node among many branches", () => {
    const wf = minimalWorkflow({
      nodeTypes: [
        makeNodeType({ name: "Linear" }),
        makeNodeType({ name: "Branching" }),
      ],
      connections: [
        makeConnection("Linear", "onSuccess", "Branching", "execute"),
        makeConnection("Branching", "onSuccess", "PathA", "execute"),
        makeConnection("Branching", "onSuccess", "PathB", "execute"),
      ],
    });
    expect(hasBranching(wf)).toBe(true);
  });
});
