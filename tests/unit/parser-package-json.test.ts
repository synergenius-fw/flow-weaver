/**
 * Tests for parser.ts package.json handling
 * Ensures invalid package.json files are handled gracefully with warnings
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parser } from "../../src/parser";

describe("Parser package.json handling", () => {
  let tempDir: string;
  let consoleSpy: MockInstance;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-pkg-test-"));
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
  });

  it("should log warning for invalid package.json JSON", () => {
    // Create a directory with invalid package.json
    const pkgDir = path.join(tempDir, "bad-pkg");
    fs.mkdirSync(pkgDir);
    fs.writeFileSync(path.join(pkgDir, "package.json"), "not valid json {{{");
    fs.writeFileSync(
      path.join(pkgDir, "index.ts"),
      `
      /**
       * @flowWeaver nodeType
       * @input execute - Execute the node
       */
      export function badPkgNode(execute: boolean): { onSuccess: boolean } {
        return { onSuccess: true };
      }
    `
    );

    // Create test file that imports from the bad-pkg directory
    const testFile = path.join(tempDir, "test.ts");
    fs.writeFileSync(
      testFile,
      `
      import { badPkgNode } from './bad-pkg';

      /**
       * @flowWeaver workflow
       * @node n1 badPkgNode
       * @connect Start.execute -> n1.execute
       * @connect n1.onSuccess -> Exit.onSuccess
       */
      export function testWorkflow(execute: boolean): Promise<{ onSuccess: boolean }> {
        return Promise.resolve({ onSuccess: true });
      }
    `
    );

    // Parse should succeed (fallback to index.ts)
    const result = parser.parse(testFile);

    // Should have logged a warning about the invalid package.json
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("package.json")
    );
  });

  it("should include file path in package.json warning", () => {
    const pkgDir = path.join(tempDir, "invalid-json-pkg");
    fs.mkdirSync(pkgDir);
    fs.writeFileSync(path.join(pkgDir, "package.json"), "{ broken json");
    fs.writeFileSync(
      path.join(pkgDir, "index.ts"),
      `export const x = 1;`
    );

    const testFile = path.join(tempDir, "importer.ts");
    fs.writeFileSync(
      testFile,
      `
      import { x } from './invalid-json-pkg';

      /**
       * @flowWeaver workflow
       */
      export function importerWorkflow(execute: boolean): Promise<{ onSuccess: boolean }> {
        return Promise.resolve({ onSuccess: true });
      }
    `
    );

    parser.parse(testFile);

    // Warning should include the path to the invalid package.json
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("invalid-json-pkg")
    );
  });

  it("should continue resolution after package.json parse error", () => {
    const pkgDir = path.join(tempDir, "fallback-pkg");
    fs.mkdirSync(pkgDir);
    fs.writeFileSync(path.join(pkgDir, "package.json"), "invalid");
    fs.writeFileSync(
      path.join(pkgDir, "index.ts"),
      `
      /**
       * @flowWeaver nodeType
       * @input execute - Execute
       */
      export function fallbackNode(execute: boolean): { onSuccess: boolean } {
        return { onSuccess: true };
      }
    `
    );

    const testFile = path.join(tempDir, "fallback-test.ts");
    fs.writeFileSync(
      testFile,
      `
      import { fallbackNode } from './fallback-pkg';

      /**
       * @flowWeaver workflow
       * @node n1 fallbackNode
       * @connect Start.execute -> n1.execute
       * @connect n1.onSuccess -> Exit.onSuccess
       */
      export function fallbackWorkflow(execute: boolean): Promise<{ onSuccess: boolean }> {
        return Promise.resolve({ onSuccess: true });
      }
    `
    );

    const result = parser.parse(testFile);

    // Should have resolved to index.ts and found the node type
    expect(result.nodeTypes.find((n) => n.functionName === "fallbackNode")).toBeDefined();
  });

  it("should not log warning for valid package.json", () => {
    const pkgDir = path.join(tempDir, "good-pkg");
    fs.mkdirSync(pkgDir);
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ main: "index.ts" })
    );
    fs.writeFileSync(
      path.join(pkgDir, "index.ts"),
      `
      /**
       * @flowWeaver nodeType
       * @input execute - Execute
       */
      export function goodNode(execute: boolean): { onSuccess: boolean } {
        return { onSuccess: true };
      }
    `
    );

    const testFile = path.join(tempDir, "good-test.ts");
    fs.writeFileSync(
      testFile,
      `
      import { goodNode } from './good-pkg';

      /**
       * @flowWeaver workflow
       * @node n1 goodNode
       * @connect Start.execute -> n1.execute
       * @connect n1.onSuccess -> Exit.onSuccess
       */
      export function goodWorkflow(execute: boolean): Promise<{ onSuccess: boolean }> {
        return Promise.resolve({ onSuccess: true });
      }
    `
    );

    parser.parse(testFile);

    // Should NOT have logged any warning about package.json
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
