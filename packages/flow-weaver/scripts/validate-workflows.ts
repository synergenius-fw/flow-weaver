#!/usr/bin/env ts-node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Build-Time Workflow Validation
 *
 * Validates all .ts files in the project for:
 * - Duplicate port names
 * - Invalid connections
 * - Type mismatches
 * - Structural issues
 *
 * Usage:
 *   npm run validate                    # Validate all files
 *   npm run validate:watch              # Watch mode
 *   npm run validate src/foo.ts      # Validate specific file
 */

import { parser } from '../src/parser';
import { validator } from '../src/validator';
import { convertToWorkflowAST } from '../src/parser-adapter';
import { glob } from 'glob';
import * as fs from 'fs';
import * as crypto from 'crypto';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

interface ValidationResult {
  file: string;
  success: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  timeMs: number;
}

interface ValidationError {
  type: string;
  message: string;
  line?: number;
  column?: number;
  node?: string;
  location?: {
    workflow?: string;
    node?: string;
    connection?: string;
  };
}

interface ValidationWarning {
  type: string;
  message: string;
  line?: number;
  node?: string;
}

interface CacheEntry {
  hash: string;
  timestamp: number;
  result: ValidationResult;
}

class ValidationCache {
  private cacheFile: string;
  private cache: Map<string, CacheEntry> = new Map();

  constructor(cacheFile: string = '.validation-cache.json') {
    this.cacheFile = cacheFile;
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8'));
        this.cache = new Map(Object.entries(data));
      }
    } catch {
      // Cache corrupted or doesn't exist, start fresh
      this.cache.clear();
    }
  }

  save() {
    try {
      const data = Object.fromEntries(this.cache.entries());
      fs.writeFileSync(this.cacheFile, JSON.stringify(data, null, 2));
    } catch {
      // Ignore save errors
    }
  }

  get(file: string, currentHash: string): ValidationResult | null {
    const entry = this.cache.get(file);
    if (entry && entry.hash === currentHash) {
      return entry.result;
    }
    return null;
  }

  set(file: string, hash: string, result: ValidationResult) {
    this.cache.set(file, {
      hash,
      timestamp: Date.now(),
      result,
    });
  }

  clear() {
    this.cache.clear();
    if (fs.existsSync(this.cacheFile)) {
      fs.unlinkSync(this.cacheFile);
    }
  }
}

class WorkflowValidator {
  private cache: ValidationCache;
  private useCache: boolean;

  constructor(useCache = true) {
    this.cache = new ValidationCache();
    this.useCache = useCache;
  }

  /**
   * Compute file hash for caching
   */
  private computeHash(filePath: string): string {
    const content = fs.readFileSync(filePath, 'utf-8');
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Validate a single workflow file
   */
  async validateFile(filePath: string): Promise<ValidationResult> {
    const startTime = Date.now();

    // Check cache
    if (this.useCache) {
      const hash = this.computeHash(filePath);
      const cached = this.cache.get(filePath, hash);
      if (cached) {
        return cached;
      }
    }

    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    try {
      // Parse the file
      const parsed = await parser.parse(filePath);

      // Check for duplicate ports in nodes
      for (const node of parsed.nodes) {
        this.checkDuplicatePorts(node, errors);
      }

      // Validate each workflow
      for (const workflow of parsed.workflows) {
        const workflowAST = convertToWorkflowAST(parsed, workflow.functionName);

        // Run validator
        const validation = validator.validate(workflowAST);

        if (!validation.valid) {
          errors.push(
            ...validation.errors.map((err) => ({
              type: err.type || 'VALIDATION_ERROR',
              message: err.message,
              node: err.location?.node,
            }))
          );
        }

        // Check for naming convention warnings
        this.checkNamingConventions(workflowAST, warnings);
      }
    } catch (error: any) {
      errors.push({
        type: 'PARSE_ERROR',
        message: error.message || String(error),
      });
    }

    const result: ValidationResult = {
      file: filePath,
      success: errors.length === 0,
      errors,
      warnings,
      timeMs: Date.now() - startTime,
    };

    // Update cache
    if (this.useCache) {
      const hash = this.computeHash(filePath);
      this.cache.set(filePath, hash, result);
    }

    return result;
  }

  /**
   * Check for duplicate port names
   */
  private checkDuplicatePorts(node: any, errors: ValidationError[]) {
    const seenInputs = new Set<string>();
    const seenOutputs = new Set<string>();

    for (const portName of Object.keys(node.inputs)) {
      if (seenInputs.has(portName)) {
        errors.push({
          type: 'DUPLICATE_PORT',
          message: `Duplicate input port '${portName}' in node '${node.functionName}'`,
          node: node.functionName,
        });
      }
      seenInputs.add(portName);
    }

    for (const portName of Object.keys(node.outputs)) {
      if (seenOutputs.has(portName)) {
        errors.push({
          type: 'DUPLICATE_PORT',
          message: `Duplicate output port '${portName}' in node '${node.functionName}'`,
          node: node.functionName,
        });
      }
      seenOutputs.add(portName);
    }
  }

  /**
   * Check naming conventions
   */
  private checkNamingConventions(workflow: any, warnings: ValidationWarning[]) {
    // Check if port names are camelCase
    for (const node of workflow.nodes) {
      for (const portName of Object.keys(node.inputs)) {
        if (!this.isCamelCase(portName) && portName !== 'execute') {
          warnings.push({
            type: 'NAMING_CONVENTION',
            message: `Port '${portName}' should use camelCase naming`,
            node: node.name,
          });
        }
      }
    }
  }

  private isCamelCase(str: string): boolean {
    return /^[a-z][a-zA-Z0-9]*$/.test(str);
  }

  /**
   * Validate multiple files in parallel
   */
  async validateFiles(files: string[], maxConcurrency = 10): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    // Process in batches for controlled concurrency
    for (let i = 0; i < files.length; i += maxConcurrency) {
      const batch = files.slice(i, i + maxConcurrency);
      const batchResults = await Promise.all(batch.map((file) => this.validateFile(file)));
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Save cache to disk
   */
  saveCache() {
    this.cache.save();
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}

/**
 * Format and print validation results
 */
function printResults(results: ValidationResult[], verbose = false) {
  let totalErrors = 0;
  let totalWarnings = 0;
  const totalFiles = results.length;
  let successFiles = 0;

  for (const result of results) {
    totalErrors += result.errors.length;
    totalWarnings += result.warnings.length;
    if (result.success && result.warnings.length === 0) {
      successFiles++;
    }

    // Print errors
    if (result.errors.length > 0) {
      console.log(`\n${colors.red}${colors.bold}✗ ${result.file}${colors.reset}`);
      for (const error of result.errors) {
        console.log(`  ${colors.red}ERROR${colors.reset} [${error.type}] ${error.message}`);
        if (error.node) {
          console.log(`    ${colors.gray}in node: ${error.node}${colors.reset}`);
        }
      }
    }

    // Print warnings
    if (result.warnings.length > 0 && verbose) {
      if (result.errors.length === 0) {
        console.log(`\n${colors.yellow}⚠ ${result.file}${colors.reset}`);
      }
      for (const warning of result.warnings) {
        console.log(
          `  ${colors.yellow}WARNING${colors.reset} [${warning.type}] ${warning.message}`
        );
        if (warning.node) {
          console.log(`    ${colors.gray}in node: ${warning.node}${colors.reset}`);
        }
      }
    }

    // Print success (only in verbose mode)
    if (verbose && result.success && result.warnings.length === 0) {
      console.log(
        `${colors.green}✓${colors.reset} ${colors.gray}${result.file}${colors.reset} ${colors.gray}(${result.timeMs}ms)${colors.reset}`
      );
    }
  }

  // Summary
  console.log(`\n${colors.bold}Summary:${colors.reset}`);
  console.log(`  ${colors.gray}Total files:${colors.reset} ${totalFiles}`);
  console.log(`  ${colors.green}Success:${colors.reset} ${successFiles}`);
  if (totalErrors > 0) {
    console.log(`  ${colors.red}Errors:${colors.reset} ${totalErrors}`);
  }
  if (totalWarnings > 0) {
    console.log(`  ${colors.yellow}Warnings:${colors.reset} ${totalWarnings}`);
  }

  const totalTime = results.reduce((sum, r) => sum + r.timeMs, 0);
  console.log(`  ${colors.gray}Time:${colors.reset} ${totalTime}ms`);
}

/**
 * Watch mode
 */
async function watchMode(pattern: string, workflowValidator: WorkflowValidator) {
  console.log(`${colors.blue}Watching for changes...${colors.reset}\n`);

  const chokidar = require('chokidar');
  const watcher = chokidar.watch(pattern, {
    persistent: true,
    ignoreInitial: false,
  });

  watcher.on('change', async (filePath: string) => {
    console.log(`\n${colors.gray}File changed: ${filePath}${colors.reset}`);
    const result = await workflowValidator.validateFile(filePath);
    printResults([result], true);
    workflowValidator.saveCache();
  });

  watcher.on('add', async (filePath: string) => {
    if (filePath.endsWith('.ts')) {
      console.log(`\n${colors.gray}File added: ${filePath}${colors.reset}`);
      const result = await workflowValidator.validateFile(filePath);
      printResults([result], true);
      workflowValidator.saveCache();
    }
  });
}

/**
 * Main CLI
 */
async function main() {
  const args = process.argv.slice(2);

  const flags = {
    watch: args.includes('--watch') || args.includes('-w'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    noCache: args.includes('--no-cache'),
    clearCache: args.includes('--clear-cache'),
    help: args.includes('--help') || args.includes('-h'),
  };

  if (flags.help) {
    console.log(`
${colors.bold}Flow Weaver Workflow Validation${colors.reset}

Usage:
  npm run validate [options] [pattern]

Options:
  --watch, -w       Watch mode (re-validate on file changes)
  --verbose, -v     Show all files including successful ones
  --no-cache        Disable caching
  --clear-cache     Clear validation cache and exit
  --help, -h        Show this help

Examples:
  npm run validate                     # Validate all workflows
  npm run validate --watch             # Watch mode
  npm run validate src/foo.ts       # Validate specific file
  npm run validate "src/**/*.ts"    # Custom pattern
    `);
    process.exit(0);
  }

  const workflowValidator = new WorkflowValidator(!flags.noCache);

  if (flags.clearCache) {
    workflowValidator.clearCache();
    console.log(`${colors.green}✓${colors.reset} Cache cleared`);
    process.exit(0);
  }

  // Determine pattern
  const fileArgs = args.filter((arg) => !arg.startsWith('--') && !arg.startsWith('-'));
  let pattern: string;

  if (fileArgs.length > 0) {
    pattern = fileArgs[0];
  } else {
    // Default patterns
    pattern = '{src,fixtures,test,tests}/**/*.ts';
  }

  // Find files
  const files = glob.sync(pattern, {
    ignore: ['**/node_modules/**', '**/dist/**', '**/.tmp/**'],
  });

  if (files.length === 0) {
    console.log(
      `${colors.yellow}⚠${colors.reset} No .ts files found matching pattern: ${pattern}`
    );
    process.exit(0);
  }

  console.log(`${colors.blue}Validating ${files.length} workflow file(s)...${colors.reset}\n`);

  // Watch mode
  if (flags.watch) {
    await watchMode(pattern, workflowValidator);
    return;
  }

  // Validate files
  const results = await workflowValidator.validateFiles(files);

  // Print results
  printResults(results, flags.verbose);

  // Save cache
  workflowValidator.saveCache();

  // Exit with error if any validation failed
  const hasErrors = results.some((r) => !r.success);
  process.exit(hasErrors ? 1 : 0);
}

// Run
if (require.main === module) {
  main().catch((error) => {
    console.error(`${colors.red}${colors.bold}Fatal error:${colors.reset}`, error);
    process.exit(1);
  });
}

export { WorkflowValidator, ValidationResult, ValidationError, ValidationWarning };
