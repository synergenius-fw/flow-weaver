/**
 * Node.js-only AST file I/O functions.
 * NOT exported from /ast - use direct import if needed.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { TWorkflowAST } from "./types";
import { serializeAST, deserializeAST } from "./serialization";

export async function saveAST(
  ast: TWorkflowAST,
  filePath: string,
): Promise<void> {
  const json = serializeAST(ast, true);
  await fs.writeFile(filePath, json, "utf-8");
}

export async function loadAST(filePath: string): Promise<TWorkflowAST> {
  const json = await fs.readFile(filePath, "utf-8");
  return deserializeAST(json);
}

export async function saveASTAlongside(ast: TWorkflowAST): Promise<string> {
  const sourceFile = ast.sourceFile;
  const dir = path.dirname(sourceFile);
  const basename = path.basename(sourceFile, path.extname(sourceFile));
  const astFile = path.join(dir, `${basename}.ast.json`);
  await saveAST(ast, astFile);
  return astFile;
}

export async function loadASTAlongside(
  sourceFile: string,
): Promise<TWorkflowAST> {
  const dir = path.dirname(sourceFile);
  const basename = path.basename(sourceFile, path.extname(sourceFile));
  const astFile = path.join(dir, `${basename}.ast.json`);
  return loadAST(astFile);
}
