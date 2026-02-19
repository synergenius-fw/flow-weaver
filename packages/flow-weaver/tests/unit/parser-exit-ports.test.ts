/**
 * Tests for parser.ts exit port handling
 * Ensures helpful warnings when return type cannot be determined
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parser } from "../../src/parser";

describe("Parser exit port handling", () => {
  let tempDir: string;
  let warnSpy: MockInstance;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-exit-test-"));
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    warnSpy.mockRestore();
  });

  it("should include function name in return type warning", () => {
    const testFile = path.join(tempDir, "test.ts");
    fs.writeFileSync(
      testFile,
      `
      /**
       * @flowWeaver workflow
       */
      export function myWorkflowWithNoReturn(execute: boolean) {
        // Function with no return type annotation
      }
    `
    );

    parser.parse(testFile);

    // Warning should include the function name
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("myWorkflowWithNoReturn")
    );
  });

  it("should include file location in return type warning", () => {
    const testFile = path.join(tempDir, "my-workflow.ts");
    fs.writeFileSync(
      testFile,
      `
      /**
       * @flowWeaver workflow
       */
      export function noReturnWorkflow(execute: boolean) {
        // No return type
      }
    `
    );

    parser.parse(testFile);

    // Warning should include the file path or name
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("my-workflow.ts")
    );
  });

  it("should provide actionable suggestion in warning", () => {
    const testFile = path.join(tempDir, "suggestion.ts");
    fs.writeFileSync(
      testFile,
      `
      /**
       * @flowWeaver workflow
       */
      export function needsReturnType(execute: boolean) {
        // Missing return type
      }
    `
    );

    parser.parse(testFile);

    // Warning should include a suggestion about return type format
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Promise<\{|return type/)
    );
  });

  it("should not warn for workflow with valid return type", () => {
    const testFile = path.join(tempDir, "valid.ts");
    fs.writeFileSync(
      testFile,
      `
      /**
       * @flowWeaver workflow
       */
      export function validWorkflow(execute: boolean): Promise<{ onSuccess: boolean }> {
        return Promise.resolve({ onSuccess: true });
      }
    `
    );

    parser.parse(testFile);

    // Should not have logged any warning about return type
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("should still return workflow with empty exit ports when return type missing", () => {
    const testFile = path.join(tempDir, "empty-exits.ts");
    fs.writeFileSync(
      testFile,
      `
      /**
       * @flowWeaver workflow
       */
      export function emptyExitWorkflow(execute: boolean) {
        // No return type
      }
    `
    );

    const result = parser.parse(testFile);

    // Should still have a workflow in results
    expect(result.workflows).toHaveLength(1);
    // Exit ports should be empty
    expect(Object.keys(result.workflows[0].exitPorts)).toHaveLength(0);
  });
});
