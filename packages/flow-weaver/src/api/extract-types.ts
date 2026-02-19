/**
 * Type Declaration Extraction
 *
 * Extracts interface and type alias declarations from TypeScript source code.
 * Used by generateCode to preserve type definitions in generated output.
 */

import * as ts from "typescript";
import * as fs from "fs";

export interface ExtractedTypes {
  /** Interface declarations (e.g., "interface Foo { ... }") */
  interfaces: string[];
  /** Type alias declarations (e.g., "type Bar = ...") */
  typeAliases: string[];
  /** Combined declarations in source order */
  all: string[];
}

/**
 * Extract interface and type alias declarations from TypeScript source code.
 *
 * @param sourceCode - The TypeScript source code
 * @returns Object containing extracted type declarations
 */
export function extractTypeDeclarations(sourceCode: string): ExtractedTypes {
  const sourceFile = ts.createSourceFile(
    "temp.ts",
    sourceCode,
    ts.ScriptTarget.Latest,
    true
  );

  const interfaces: string[] = [];
  const typeAliases: string[] = [];
  const all: { text: string; pos: number; kind: "interface" | "type" }[] = [];

  ts.forEachChild(sourceFile, (node) => {
    // Interface declarations
    if (ts.isInterfaceDeclaration(node)) {
      const text = sourceCode.slice(node.getFullStart(), node.getEnd()).trim();
      interfaces.push(text);
      all.push({ text, pos: node.getFullStart(), kind: "interface" });
    }

    // Type alias declarations
    if (ts.isTypeAliasDeclaration(node)) {
      const text = sourceCode.slice(node.getFullStart(), node.getEnd()).trim();
      typeAliases.push(text);
      all.push({ text, pos: node.getFullStart(), kind: "type" });
    }
  });

  // Sort by source position to maintain original order
  all.sort((a, b) => a.pos - b.pos);

  return {
    interfaces,
    typeAliases,
    all: all.map((item) => item.text),
  };
}

/**
 * Extract type declarations from a source file path.
 *
 * @param filePath - Path to the TypeScript source file
 * @returns Object containing extracted type declarations, or empty if file can't be read
 */
export function extractTypeDeclarationsFromFile(filePath: string): ExtractedTypes {
  try {
    const sourceCode = fs.readFileSync(filePath, "utf-8");
    return extractTypeDeclarations(sourceCode);
  } catch {
    return { interfaces: [], typeAliases: [], all: [] };
  }
}
