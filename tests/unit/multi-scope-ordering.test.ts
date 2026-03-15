/**
 * Test multi-scope ordering: scopes array should follow function parameter order,
 * not JSDoc declaration order or Set insertion order.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parser } from "../../src/parser";

const testDir = path.join(
  os.tmpdir(),
  `flow-weaver-multi-scope-ordering-${process.pid}`
);

beforeAll(() => {
  fs.mkdirSync(testDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

function parseNodeType(content: string, functionName: string) {
  const testFile = path.join(testDir, `${functionName}.ts`);
  fs.writeFileSync(testFile, content.trim());
  const result = parser.parse(testFile);
  return result.nodeTypes.find((nt) => nt.functionName === functionName);
}

describe("Multi-scope ordering", () => {
  it("orders scopes by function parameter position when JSDoc declares them out of order", () => {
    // JSDoc declares scope:b ports BEFORE scope:a ports,
    // but function signature is (execute, a, b) so scopes should be ["a", "b"]
    const nt = parseNodeType(
      `
/**
 * @flowWeaver nodeType
 * @label Execute String Function
 * @input success scope:b [order:-2] - Success
 * @input failure scope:b [order:-1] - Failure
 * @input aResult scope:a [order:0] - A Result
 * @input bResult scope:b [order:0] - B Result
 * @input execute [order:-1] - Execute
 * @output start scope:b [order:-1] - Start
 * @output a1 scope:a [order:0] - A1
 * @output b1 scope:b [order:0] - B1
 * @output result [order:0] - Result
 * @output onSuccess [order:-2] - On Success
 * @output onFailure [order:-1] - On Failure
 */
async function ExecStrFn(
  execute: boolean,
  a: (start: boolean, a1: string) => Promise<{ success: boolean; failure: boolean; aResult: string }>,
  b: (start: boolean, b1: number) => Promise<{ success: boolean; failure: boolean; bResult: string }>
): Promise<{ onSuccess: boolean; onFailure: boolean; result: string | undefined }> {
  return { onSuccess: true, onFailure: false, result: undefined };
}

export { ExecStrFn };
`,
      "ExecStrFn"
    );

    expect(nt).toBeDefined();
    expect(nt!.scopes).toEqual(["a", "b"]);
  });

  it("respects reversed parameter order (second before first)", () => {
    const nt = parseNodeType(
      `
/**
 * @flowWeaver nodeType
 * @output item scope:first
 * @output element scope:second
 * @input done scope:first
 * @input done scope:second
 */
function Reversed(
  execute: boolean,
  second: (start: boolean, element: string) => Promise<{ done: boolean }>,
  first: (start: boolean, item: number) => Promise<{ done: boolean }>
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  return { onSuccess: true, onFailure: false };
}

export { Reversed };
`,
      "Reversed"
    );

    expect(nt).toBeDefined();
    expect(nt!.scopes).toEqual(["second", "first"]);
  });

  it("handles three scopes in parameter order", () => {
    const nt = parseNodeType(
      `
/**
 * @flowWeaver nodeType
 * @output z1 scope:z
 * @output x1 scope:x
 * @output y1 scope:y
 * @input zResult scope:z
 * @input xResult scope:x
 * @input yResult scope:y
 */
async function ThreeScopes(
  execute: boolean,
  x: (start: boolean, x1: string) => Promise<{ success: boolean; xResult: string }>,
  y: (start: boolean, y1: number) => Promise<{ success: boolean; yResult: number }>,
  z: (start: boolean, z1: boolean) => Promise<{ success: boolean; zResult: boolean }>
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  return { onSuccess: true, onFailure: false };
}

export { ThreeScopes };
`,
      "ThreeScopes"
    );

    expect(nt).toBeDefined();
    expect(nt!.scopes).toEqual(["x", "y", "z"]);
  });

  it("single scope still works", () => {
    const nt = parseNodeType(
      `
/**
 * @flowWeaver nodeType
 * @output start scope:iteration
 * @output item scope:iteration
 * @input success scope:iteration
 */
function SingleScope(
  execute: boolean,
  items: any[],
  iteration: (start: boolean, item: string) => Promise<{ success: boolean }>
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  return { onSuccess: true, onFailure: false };
}

export { SingleScope };
`,
      "SingleScope"
    );

    expect(nt).toBeDefined();
    expect(nt!.scopes).toEqual(["iteration"]);
  });

  it("node-level @scope still works (old architecture)", () => {
    const nt = parseNodeType(
      `
/**
 * @flowWeaver nodeType
 * @scope container
 * @input value
 * @output result
 */
function OldScope(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

export { OldScope };
`,
      "OldScope"
    );

    expect(nt).toBeDefined();
    expect(nt!.scopes).toEqual(["container"]);
    expect(nt!.scope).toBe("container");
  });

  it("non-scoped nodes have undefined scopes", () => {
    const nt = parseNodeType(
      `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function NoScope(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x };
}

export { NoScope };
`,
      "NoScope"
    );

    expect(nt).toBeDefined();
    expect(nt!.scopes).toBeUndefined();
  });

  it("includes scopes from JSDoc-only declarations not matching params", () => {
    // Scope name in port doesn't match any parameter name
    // Should still appear in scopes (appended after param-matched ones)
    const nt = parseNodeType(
      `
/**
 * @flowWeaver nodeType
 * @output item scope:custom
 * @input result scope:custom
 */
function JsDocOnly(
  execute: boolean,
  handler: (start: boolean, item: string) => Promise<{ result: string }>
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  return { onSuccess: true, onFailure: false };
}

export { JsDocOnly };
`,
      "JsDocOnly"
    );

    expect(nt).toBeDefined();
    expect(nt!.scopes).toBeDefined();
    expect(nt!.scopes).toContain("custom");
  });

  it("ports for each scope have correct scope field values", () => {
    const nt = parseNodeType(
      `
/**
 * @flowWeaver nodeType
 * @output a1 scope:a - A1
 * @output b1 scope:b - B1
 * @input aResult scope:a - A Result
 * @input bResult scope:b - B Result
 */
async function PortScopes(
  execute: boolean,
  a: (start: boolean, a1: string) => Promise<{ success: boolean; aResult: string }>,
  b: (start: boolean, b1: number) => Promise<{ success: boolean; bResult: string }>
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  return { onSuccess: true, onFailure: false };
}

export { PortScopes };
`,
      "PortScopes"
    );

    expect(nt).toBeDefined();
    expect(nt!.outputs.a1?.scope).toBe("a");
    expect(nt!.outputs.b1?.scope).toBe("b");
    expect(nt!.inputs.aResult?.scope).toBe("a");
    expect(nt!.inputs.bResult?.scope).toBe("b");
  });
});
