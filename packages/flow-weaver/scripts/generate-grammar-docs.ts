#!/usr/bin/env tsx
/**
 * Generates grammar railroad diagrams for TypeDoc documentation.
 * Run before typedoc to include grammar.html in docs.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { generateGrammarDiagrams } from "../src/chevrotain-parser/grammar-diagrams";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(__dirname, "../docs/api");

// Ensure docs directory exists
fs.mkdirSync(docsDir, { recursive: true });

// Generate the grammar HTML
const html = generateGrammarDiagrams();
const outputPath = path.join(docsDir, "grammar.html");

fs.writeFileSync(outputPath, html);
console.log(`Grammar diagrams written to ${outputPath}`);
