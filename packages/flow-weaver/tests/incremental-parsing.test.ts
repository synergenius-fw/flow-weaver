import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AnnotationParser } from "../src/parser";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("AnnotationParser incremental parsing", () => {
  let parser: AnnotationParser;
  let tmpDir: string;

  function writeFile(name: string, content: string): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  beforeEach(() => {
    parser = new AnnotationParser();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fw-incr-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("content hash caching", () => {
    it("returns cached result when content unchanged despite mtime change", () => {
      const content = `
/** @flowWeaver nodeType */
function add(execute: boolean, data: { a: number }): { onSuccess: boolean } {
  return { onSuccess: true };
}
`;
      const filePath = writeFile("test.ts", content);

      const result1 = parser.parse(filePath);

      // Touch file to change mtime without changing content
      const now = new Date();
      fs.utimesSync(filePath, now, now);

      const result2 = parser.parse(filePath);

      // Should be the same reference (cached)
      expect(result2).toBe(result1);
    });

    it("re-parses when content actually changes", () => {
      const content1 = `
/** @flowWeaver nodeType */
function add(execute: boolean, data: { a: number }): { onSuccess: boolean } {
  return { onSuccess: true };
}
`;
      const content2 = `
/** @flowWeaver nodeType */
function add(execute: boolean, data: { a: number }): { onSuccess: boolean } {
  return { onSuccess: false };
}
`;
      const filePath = writeFile("test.ts", content1);

      const result1 = parser.parse(filePath);
      fs.writeFileSync(filePath, content2);

      const result2 = parser.parse(filePath);

      // Should NOT be the same reference (re-parsed)
      expect(result2).not.toBe(result1);
    });
  });

  describe("minor edit detection", () => {
    it("patches AST for function body changes", () => {
      const content1 = `
/** @flowWeaver nodeType */
function calc(execute: boolean, data: { x: number }): { onSuccess: boolean; result: number } {
  return { onSuccess: true, result: data.x * 2 };
}
`;
      const content2 = content1.replace("* 2", "* 3");

      const filePath = writeFile("test.ts", content1);
      parser.parse(filePath);
      fs.writeFileSync(filePath, content2);

      const start = performance.now();
      const result = parser.parse(filePath);
      const elapsed = performance.now() - start;

      // Patching should be faster than full parse (rough heuristic)
      expect(elapsed).toBeLessThan(100);
      expect(result.nodeTypes[0].functionText).toContain("* 3");
    });

    it("does full parse when @output annotation changes", () => {
      const content1 = `
/** @flowWeaver nodeType
 * @output customOut - Custom output
 */
function calc(execute: boolean, data: { x: number }): { onSuccess: boolean; customOut: number } {
  return { onSuccess: true, customOut: data.x };
}
`;
      const content2 = `
/** @flowWeaver nodeType
 * @output renamedOut - Renamed output
 */
function calc(execute: boolean, data: { x: number }): { onSuccess: boolean; renamedOut: number } {
  return { onSuccess: true, renamedOut: data.x };
}
`;

      const filePath = writeFile("test.ts", content1);
      const result1 = parser.parse(filePath);
      expect(result1.nodeTypes[0].outputs.customOut).toBeDefined();
      expect(result1.nodeTypes[0].outputs.renamedOut).toBeUndefined();

      fs.writeFileSync(filePath, content2);
      const result2 = parser.parse(filePath);
      expect(result2.nodeTypes[0].outputs.renamedOut).toBeDefined();
      expect(result2.nodeTypes[0].outputs.customOut).toBeUndefined();
    });

    it("does full parse when function signature changes", () => {
      const content1 = `
/** @flowWeaver nodeType */
function calc(execute: boolean, data: { x: number }): { onSuccess: boolean } {
  return { onSuccess: true };
}
`;
      const content2 = `
/** @flowWeaver nodeType */
function calcRenamed(execute: boolean, data: { x: number }): { onSuccess: boolean } {
  return { onSuccess: true };
}
`;

      const filePath = writeFile("test.ts", content1);
      parser.parse(filePath);
      fs.writeFileSync(filePath, content2);

      const result = parser.parse(filePath);
      expect(result.nodeTypes[0].functionName).toBe("calcRenamed");
    });

    it("does full parse when import statements change", () => {
      const content1 = `
/** @flowWeaver nodeType */
function calc(execute: boolean, data: { x: number }): { onSuccess: boolean } {
  return { onSuccess: true };
}
`;
      const content2 = `import { something } from 'somewhere';

/** @flowWeaver nodeType */
function calc(execute: boolean, data: { x: number }): { onSuccess: boolean } {
  return { onSuccess: true };
}
`;

      const filePath = writeFile("test.ts", content1);
      parser.parse(filePath);
      fs.writeFileSync(filePath, content2);

      // Should not throw and should parse correctly
      const result = parser.parse(filePath);
      expect(result.nodeTypes.length).toBe(1);
    });

    it("does full parse when @flowWeaver annotation is added", () => {
      const content1 = `
function helperFunc() { return 1; }

/** @flowWeaver nodeType */
function calc(execute: boolean, data: { x: number }): { onSuccess: boolean } {
  return { onSuccess: true };
}
`;
      const content2 = `
/** @flowWeaver nodeType */
function helperFunc(execute: boolean, data: {}): { onSuccess: boolean } { return { onSuccess: true }; }

/** @flowWeaver nodeType */
function calc(execute: boolean, data: { x: number }): { onSuccess: boolean } {
  return { onSuccess: true };
}
`;

      const filePath = writeFile("test.ts", content1);
      const result1 = parser.parse(filePath);
      expect(result1.nodeTypes.length).toBe(1);

      fs.writeFileSync(filePath, content2);
      const result2 = parser.parse(filePath);
      expect(result2.nodeTypes.length).toBe(2);
    });
  });

  describe("mtime caching still works", () => {
    it("returns cached result when mtime unchanged", () => {
      const content = `
/** @flowWeaver nodeType */
function add(execute: boolean, data: { a: number }): { onSuccess: boolean } {
  return { onSuccess: true };
}
`;
      const filePath = writeFile("test.ts", content);

      const result1 = parser.parse(filePath);
      const result2 = parser.parse(filePath);

      // Same reference (mtime cache hit)
      expect(result2).toBe(result1);
    });
  });
});
