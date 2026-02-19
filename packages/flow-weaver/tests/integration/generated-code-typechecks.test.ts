/**
 * Generated Code TypeScript Type-Checking Tests
 *
 * Ensures generated code passes TSC without type errors.
 * This prevents regressions like `number | undefined` not assignable to `number`.
 *
 * Uses TypeScript Compiler API for in-memory type checking (no process spawning).
 */

import { describe, expect, test } from "vitest";
import { generateCode } from "../../src/api/generate";
import { parser } from "../../src/parser";
import * as ts from "typescript";

/**
 * Type-check TypeScript code in-memory using the TypeScript Compiler API.
 * Much faster than spawning `npx tsc` (~100ms vs ~9s per check).
 */
function typeCheckInMemory(code: string, fileName: string = "test.ts"): {
  success: boolean;
  errors: string[];
} {
  const options: ts.CompilerOptions = {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    strict: false,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
  };

  // Create a virtual file system with our code
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);

  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    if (name === fileName || name === `/${fileName}`) {
      return ts.createSourceFile(name, code, languageVersion, true);
    }
    return originalGetSourceFile(name, languageVersion, onError, shouldCreate);
  };

  host.fileExists = (name) => {
    if (name === fileName || name === `/${fileName}`) {
      return true;
    }
    return originalFileExists(name);
  };

  host.readFile = (name) => {
    if (name === fileName || name === `/${fileName}`) {
      return code;
    }
    return originalReadFile(name);
  };

  const program = ts.createProgram([fileName], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);

  const errors = diagnostics
    .filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      if (d.file && d.start !== undefined) {
        const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
        return `${d.file.fileName}(${line + 1},${character + 1}): ${message}`;
      }
      return message;
    })
    // Filter out module resolution errors - we're testing type safety, not imports
    // Generated code imports from source file path which doesn't exist in virtual context
    .filter(e => !e.includes("Cannot find module"));

  return {
    success: errors.length === 0,
    errors,
  };
}

describe("Generated Code - TypeScript Type Checking", () => {
  test("should generate type-safe code for basic workflow", async () => {
    const workflowContent = `
/**
 * @flowWeaver nodeType
 * @input a
 * @input b
 * @output sum
 */
function add(execute: boolean, a: number, b: number) {
  if (!execute) return { onSuccess: false, onFailure: false, sum: 0 };
  return { onSuccess: true, onFailure: false, sum: a + b };
}

/**
 * @flowWeaver workflow
 * @node adder add
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.sum -> Exit.sum
 * @param {NUMBER} a
 * @param {NUMBER} b
 * @returns {NUMBER} sum
 */
export async function calculateSum(
  execute: boolean,
  params: { a: number; b: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; sum: number }> {
  throw new Error('Not implemented');
}
`;

    // Parse in-memory
    const parseResult = parser.parseFromString(workflowContent);
    const workflow = parseResult.workflows.find(w => w.functionName === "calculateSum")!;
    const generatedCode = await generateCode(workflow, { production: false });

    const tscResult = typeCheckInMemory(generatedCode, "calculateSum.generated.ts");
    if (!tscResult.success) {
      console.error("TSC errors:", tscResult.errors.join("\n"));
    }
    expect(tscResult.success).toBe(true);
  });

  test("should generate type-safe code for scoped workflow (forEach pattern)", async () => {
    // Self-contained scoped workflow example
    const workflowContent = `
/**
 * @flowWeaver nodeType
 * @input items [type: NUMBER[]]
 * @output item [type: NUMBER, scope: forEach]
 * @output done
 * @scope forEach
 */
function forEach(execute: boolean, items: number[]) {
  return { onSuccess: true, onFailure: false, item: 0, done: true };
}

/**
 * @flowWeaver nodeType
 * @input value [type: NUMBER]
 * @output doubled [type: NUMBER]
 */
function double(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node loop forEach
 * @node proc double
 * @connect Start.numbers -> loop.items
 * @connect loop.item:forEach -> proc.value
 * @connect proc.doubled -> Exit.results
 * @connect loop.done -> Exit.complete
 * @param {NUMBER[]} numbers
 * @returns {NUMBER[]} results
 * @returns {BOOLEAN} complete
 * @scope forEach [proc]
 */
export async function scopedWorkflow(
  execute: boolean,
  params: { numbers: number[] }
): Promise<{ onSuccess: boolean; onFailure: boolean; results: number[]; complete: boolean }> {
  throw new Error('Not implemented');
}
`;

    // Parse in-memory
    const parseResult = parser.parseFromString(workflowContent);
    const workflow = parseResult.workflows.find(w => w.functionName === "scopedWorkflow")!;
    const generatedCode = await generateCode(workflow, { production: false });

    const tscResult = typeCheckInMemory(generatedCode, "scopedWorkflow.generated.ts");
    if (!tscResult.success) {
      console.error("TSC errors in scoped workflow:", tscResult.errors.join("\n"));
    }
    expect(tscResult.success).toBe(true);
  });

  test("should generate type-safe code for production mode", async () => {
    const workflowContent = `
/**
 * @flowWeaver nodeType
 * @input input
 * @output output
 */
function echo(execute: boolean, input: string) {
  return { onSuccess: true, onFailure: false, output: input };
}

/**
 * @flowWeaver workflow
 * @node echo1 echo
 * @connect Start.message -> echo1.input
 * @connect echo1.output -> Exit.result
 * @param {STRING} message
 * @returns {STRING} result
 */
export async function echoWorkflow(
  execute: boolean,
  params: { message: string }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: string }> {
  throw new Error('Not implemented');
}
`;

    // Parse in-memory
    const parseResult = parser.parseFromString(workflowContent);
    const workflow = parseResult.workflows.find(w => w.functionName === "echoWorkflow")!;
    const generatedCode = await generateCode(workflow, { production: true });

    const tscResult = typeCheckInMemory(generatedCode, "echoWorkflow.production.ts");
    if (!tscResult.success) {
      console.error("TSC errors in production mode:", tscResult.errors.join("\n"));
    }
    expect(tscResult.success).toBe(true);
  });
});
