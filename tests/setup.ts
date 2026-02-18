/**
 * Vitest Setup File
 *
 * Runs before all tests to set up test environment
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseWorkflow } from '../src/api/parse';
import { generateCode } from '../src/api/generate';
import { getParserProject, parser } from '../src/parser';
import { resetSharedProject } from '../src/shared-project';

// Warm up the shared ts-morph Project and force type checker initialization.
// The first Program + type checker creation is the most expensive; doing it
// here means the LanguageService's internal caches are warm for all tests.
const _warmProject = getParserProject();
const _warmFile = _warmProject.createSourceFile('__warmup__.ts', 'const x: number = 1;');
_warmFile.getVariableDeclarations()[0].getType();
_warmProject.removeSourceFile(_warmFile);

// Use OS temp directory - no PID suffix to ensure consistency across forks
const outputDir = path.join(os.tmpdir(), 'flow-weaver-tests-output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Temp directory for tests that need to write temporary files
const tempDir = path.join(os.tmpdir(), 'flow-weaver-tests-temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// After each test file:
// 1. Clear parse-result cache (keep importCache — it's small and reusable)
// 2. Remove all source files from the shared project to prevent accumulation
// 3. Periodically reset the entire project to reclaim type inference memory
let fileCounter = 0;
afterAll(() => {
  parser.clearParseCache();
  const project = getParserProject();
  for (const sf of project.getSourceFiles()) {
    project.removeSourceFile(sf);
  }
  fileCounter++;
  if (fileCounter % 30 === 0) {
    resetSharedProject();
    parser.clearCache();
  }
});

// Extend global with test helpers
declare global {
   
  var testHelpers: {
    outputDir: string;
    cleanupOutput: (filename: string) => void;
    readOutput: (filename: string) => string;
    generateFast: (
      filePath: string,
      workflowName: string,
      options?: { production?: boolean }
    ) => Promise<string>;
  };
}

// Global test utilities
(globalThis as { testHelpers?: typeof globalThis.testHelpers }).testHelpers = {
  outputDir,

  /**
   * Clean up generated files after tests
   */
  cleanupOutput(filename: string) {
    const filepath = path.join(outputDir, filename);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  },

  /**
   * Read generated file
   */
  readOutput(filename: string): string {
    const filepath = path.join(outputDir, filename);
    return fs.readFileSync(filepath, 'utf-8');
  },

  /**
   * Fast workflow generation without console logging.
   * Use this instead of generator.generate() for better test performance.
   */
  async generateFast(
    filePath: string,
    workflowName: string,
    options: { production?: boolean } = {}
  ): Promise<string> {
    const parseResult = await parseWorkflow(filePath, { workflowName });
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors: ${parseResult.errors.join(', ')}`);
    }
    return generateCode(parseResult.ast, {
      production: options.production ?? false,
      allWorkflows: parseResult.allWorkflows,
    });
  },
};
