/**
 * Tests for Extract Types API
 * Tests extractTypeDeclarations and extractTypeDeclarationsFromFile
 */

import {
  extractTypeDeclarations,
  extractTypeDeclarationsFromFile,
} from "../../src/api/extract-types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Extract Types API", () => {
  describe("extractTypeDeclarations", () => {
    it("should extract interface declarations", () => {
      const code = `
interface User {
  name: string;
  age: number;
}

function doSomething() {}
`;
      const result = extractTypeDeclarations(code);

      expect(result.interfaces).toHaveLength(1);
      expect(result.interfaces[0]).toContain("interface User");
      expect(result.interfaces[0]).toContain("name: string");
    });

    it("should extract type alias declarations", () => {
      const code = `
type Status = "active" | "inactive";
type Count = number;

const x = 1;
`;
      const result = extractTypeDeclarations(code);

      expect(result.typeAliases).toHaveLength(2);
      expect(result.typeAliases[0]).toContain("type Status");
      expect(result.typeAliases[1]).toContain("type Count");
    });

    it("should extract both interfaces and type aliases", () => {
      const code = `
interface Config {
  debug: boolean;
}

type Mode = "dev" | "prod";

interface Settings extends Config {
  mode: Mode;
}
`;
      const result = extractTypeDeclarations(code);

      expect(result.interfaces).toHaveLength(2);
      expect(result.typeAliases).toHaveLength(1);
      expect(result.all).toHaveLength(3);
    });

    it("should preserve source order in all array", () => {
      const code = `
interface First {}
type Second = string;
interface Third {}
type Fourth = number;
`;
      const result = extractTypeDeclarations(code);

      expect(result.all[0]).toContain("interface First");
      expect(result.all[1]).toContain("type Second");
      expect(result.all[2]).toContain("interface Third");
      expect(result.all[3]).toContain("type Fourth");
    });

    it("should handle empty file", () => {
      const code = "";
      const result = extractTypeDeclarations(code);

      expect(result.interfaces).toEqual([]);
      expect(result.typeAliases).toEqual([]);
      expect(result.all).toEqual([]);
    });

    it("should handle file with only functions", () => {
      const code = `
function add(a: number, b: number): number {
  return a + b;
}

const multiply = (x: number, y: number) => x * y;

export async function fetchData() {
  return {};
}
`;
      const result = extractTypeDeclarations(code);

      expect(result.interfaces).toEqual([]);
      expect(result.typeAliases).toEqual([]);
      expect(result.all).toEqual([]);
    });

    it("should handle generic types", () => {
      const code = `
interface Container<T> {
  value: T;
}

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
`;
      const result = extractTypeDeclarations(code);

      expect(result.interfaces).toHaveLength(1);
      expect(result.interfaces[0]).toContain("Container<T>");

      expect(result.typeAliases).toHaveLength(1);
      expect(result.typeAliases[0]).toContain("Result<T, E>");
    });

    it("should handle nested types", () => {
      const code = `
interface Outer {
  inner: {
    nested: {
      value: string;
    };
  };
}
`;
      const result = extractTypeDeclarations(code);

      expect(result.interfaces).toHaveLength(1);
      expect(result.interfaces[0]).toContain("nested:");
    });

    it("should handle exported types", () => {
      const code = `
export interface ExportedInterface {
  x: number;
}

export type ExportedType = string;

interface PrivateInterface {
  y: number;
}
`;
      const result = extractTypeDeclarations(code);

      expect(result.interfaces).toHaveLength(2);
      expect(result.typeAliases).toHaveLength(1);
      expect(result.interfaces[0]).toContain("export interface ExportedInterface");
    });

    it("should handle complex type aliases", () => {
      const code = `
type Callback = (event: Event) => void;
type Optional<T> = T | undefined;
type DeepPartial<T> = {
  [P in keyof T]?: DeepPartial<T[P]>;
};
`;
      const result = extractTypeDeclarations(code);

      expect(result.typeAliases).toHaveLength(3);
    });

    it("should handle interface with methods", () => {
      const code = `
interface Calculator {
  add(a: number, b: number): number;
  subtract(a: number, b: number): number;
}
`;
      const result = extractTypeDeclarations(code);

      expect(result.interfaces).toHaveLength(1);
      expect(result.interfaces[0]).toContain("add(a: number, b: number)");
    });
  });

  describe("extractTypeDeclarationsFromFile", () => {
    let tempDir: string;

    beforeAll(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-types-test-"));
    });

    afterAll(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should extract types from a real file", () => {
      const filePath = path.join(tempDir, "types.ts");
      const content = `
interface User {
  id: number;
  name: string;
}

type Role = "admin" | "user";
`;
      fs.writeFileSync(filePath, content);

      const result = extractTypeDeclarationsFromFile(filePath);

      expect(result.interfaces).toHaveLength(1);
      expect(result.typeAliases).toHaveLength(1);
    });

    it("should return empty result for non-existent file", () => {
      const result = extractTypeDeclarationsFromFile("/nonexistent/path/file.ts");

      expect(result.interfaces).toEqual([]);
      expect(result.typeAliases).toEqual([]);
      expect(result.all).toEqual([]);
    });

    it("should handle file with no types", () => {
      const filePath = path.join(tempDir, "no-types.ts");
      fs.writeFileSync(filePath, "const x = 1;");

      const result = extractTypeDeclarationsFromFile(filePath);

      expect(result.all).toEqual([]);
    });
  });

  describe("Edge Cases", () => {
    it("should handle code with syntax errors gracefully", () => {
      const code = `
interface Incomplete {
  // missing closing brace
`;
      // TypeScript parser may still extract partial info or throw
      expect(() => extractTypeDeclarations(code)).not.toThrow();
    });

    it("should handle comments in types", () => {
      const code = `
/**
 * User interface
 */
interface User {
  /** User's name */
  name: string;
}
`;
      const result = extractTypeDeclarations(code);

      expect(result.interfaces).toHaveLength(1);
      // Comments should be included in extraction
      expect(result.interfaces[0]).toContain("User interface");
    });

    it("should handle multiline type definitions", () => {
      const code = `
type ComplexUnion =
  | { type: "a"; value: number }
  | { type: "b"; value: string }
  | { type: "c"; value: boolean };
`;
      const result = extractTypeDeclarations(code);

      expect(result.typeAliases).toHaveLength(1);
      expect(result.typeAliases[0]).toContain("ComplexUnion");
    });
  });
});
