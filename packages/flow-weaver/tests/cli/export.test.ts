/**
 * Tests for the export command
 *
 * Tests serverless function generation for Lambda, Vercel, and Cloudflare.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exportWorkflow, getSupportedTargets } from '../../src/export/index';
import { LAMBDA_TEMPLATE, VERCEL_TEMPLATE, CLOUDFLARE_TEMPLATE, INNGEST_TEMPLATE } from '../../src/export/templates';

const tempDir = path.join(os.tmpdir(), `flow-weaver-export-test-${process.pid}`);

// Sample workflow for testing
const SAMPLE_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input a - First number
 * @input b - Second number
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output sum - Sum result
 */
function addNumbers(execute: boolean, a: number, b: number): { onSuccess: boolean; onFailure: boolean; sum: number } {
  if (!execute) return { onSuccess: false, onFailure: false, sum: 0 };
  return { onSuccess: true, onFailure: false, sum: a + b };
}

/**
 * @flowWeaver workflow
 * @name calculator
 * @description A simple calculator workflow
 * @node add addNumbers
 * @connect Start.execute -> add.execute
 * @connect Start.a -> add.a
 * @connect Start.b -> add.b
 * @connect add.onSuccess -> Exit.onSuccess
 * @connect add.sum -> Exit.sum
 */
export function calculator(
  execute: boolean,
  params: { a: number; b: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; sum: number }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}
`;

const MULTI_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input x - Input value
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output result - Multiplied result
 */
function multiply(execute: boolean, x: number): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: x * 2 };
}

/**
 * @flowWeaver workflow
 * @name firstWorkflow
 * @node m multiply
 * @connect Start.execute -> m.execute
 * @connect Start.x -> m.x
 * @connect m.onSuccess -> Exit.onSuccess
 * @connect m.result -> Exit.result
 */
export function firstWorkflow(
  execute: boolean,
  params: { x: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}

/**
 * @flowWeaver workflow
 * @name secondWorkflow
 * @node m2 multiply
 * @connect Start.execute -> m2.execute
 * @connect Start.x -> m2.x
 * @connect m2.onSuccess -> Exit.onSuccess
 * @connect m2.result -> Exit.result
 */
export function secondWorkflow(
  execute: boolean,
  params: { x: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}
`;

// Setup temp directory
beforeAll(() => {
  fs.mkdirSync(tempDir, { recursive: true });
});

// Cleanup
afterAll(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe('export module', () => {
  describe('getSupportedTargets', () => {
    it('should return all supported targets', () => {
      const targets = getSupportedTargets();

      expect(targets).toContain('lambda');
      expect(targets).toContain('vercel');
      expect(targets).toContain('cloudflare');
      expect(targets).toContain('inngest');
      expect(targets.length).toBe(4);
    });
  });

  describe('templates', () => {
    it('should have valid Lambda template', () => {
      expect(LAMBDA_TEMPLATE).toContain('APIGatewayProxyEventV2');
      expect(LAMBDA_TEMPLATE).toContain('{{WORKFLOW_IMPORT}}');
      expect(LAMBDA_TEMPLATE).toContain('{{FUNCTION_NAME}}');
      expect(LAMBDA_TEMPLATE).toContain('handler');
    });

    it('should have valid Vercel template', () => {
      expect(VERCEL_TEMPLATE).toContain('VercelRequest');
      expect(VERCEL_TEMPLATE).toContain('VercelResponse');
      expect(VERCEL_TEMPLATE).toContain('{{WORKFLOW_IMPORT}}');
      expect(VERCEL_TEMPLATE).toContain('{{FUNCTION_NAME}}');
      expect(VERCEL_TEMPLATE).toContain('{{MAX_DURATION}}');
    });

    it('should have valid Cloudflare template', () => {
      expect(CLOUDFLARE_TEMPLATE).toContain('fetch');
      expect(CLOUDFLARE_TEMPLATE).toContain('Request');
      expect(CLOUDFLARE_TEMPLATE).toContain('Response');
      expect(CLOUDFLARE_TEMPLATE).toContain('{{WORKFLOW_IMPORT}}');
      expect(CLOUDFLARE_TEMPLATE).toContain('{{FUNCTION_NAME}}');
    });

    it('should have valid Inngest template', () => {
      expect(INNGEST_TEMPLATE).toContain('Inngest');
      expect(INNGEST_TEMPLATE).toContain('createFunction');
      expect(INNGEST_TEMPLATE).toContain('step.run');
      expect(INNGEST_TEMPLATE).toContain('{{WORKFLOW_IMPORT}}');
      expect(INNGEST_TEMPLATE).toContain('{{FUNCTION_NAME}}');
    });
  });

  describe('exportWorkflow', () => {
    describe('Lambda export', () => {
      it('should generate Lambda handler', async () => {
        const inputPath = path.join(tempDir, 'lambda-input.ts');
        const outputDir = path.join(tempDir, 'lambda-output');

        fs.writeFileSync(inputPath, SAMPLE_WORKFLOW);

        const result = await exportWorkflow({
          target: 'lambda',
          input: inputPath,
          output: outputDir,
        });

        expect(result.target).toBe('lambda');
        expect(result.workflow).toBe('calculator');

        // Should generate handler.ts
        const handlerFile = result.files.find((f) => f.path.includes('handler.ts'));
        expect(handlerFile).toBeDefined();
        expect(handlerFile?.content).toContain('calculator');

        // Should generate template.yaml
        const templateFile = result.files.find((f) => f.path.includes('template.yaml'));
        expect(templateFile).toBeDefined();

        // Should generate package.json
        const packageFile = result.files.find((f) => f.path.includes('package.json'));
        expect(packageFile).toBeDefined();

        // Should generate compiled workflow
        const workflowFile = result.files.find((f) => f.path.includes('workflow.ts'));
        expect(workflowFile).toBeDefined();
      });

      it('should generate SAM template with correct workflow name', async () => {
        const inputPath = path.join(tempDir, 'lambda-sam-input.ts');
        const outputDir = path.join(tempDir, 'lambda-sam-output');

        fs.writeFileSync(inputPath, SAMPLE_WORKFLOW);

        const result = await exportWorkflow({
          target: 'lambda',
          input: inputPath,
          output: outputDir,
        });

        const templateFile = result.files.find((f) => f.path.includes('template.yaml'));
        expect(templateFile?.content).toContain('calculator');
        expect(templateFile?.content).toContain('AWS::Serverless::Function');
      });
    });

    describe('Vercel export', () => {
      it('should generate Vercel handler', async () => {
        const inputPath = path.join(tempDir, 'vercel-input.ts');
        const outputDir = path.join(tempDir, 'vercel-output');

        fs.writeFileSync(inputPath, SAMPLE_WORKFLOW);

        const result = await exportWorkflow({
          target: 'vercel',
          input: inputPath,
          output: outputDir,
        });

        expect(result.target).toBe('vercel');
        expect(result.workflow).toBe('calculator');

        // Should generate workflow-named handler
        const handlerFile = result.files.find((f) => f.path.includes('calculator.ts'));
        expect(handlerFile).toBeDefined();
        expect(handlerFile?.content).toContain('VercelRequest');

        // Should generate vercel.json
        const vercelConfig = result.files.find((f) => f.path.includes('vercel.json'));
        expect(vercelConfig).toBeDefined();
      });

      it('should generate vercel.json with correct settings', async () => {
        const inputPath = path.join(tempDir, 'vercel-config-input.ts');
        const outputDir = path.join(tempDir, 'vercel-config-output');

        fs.writeFileSync(inputPath, SAMPLE_WORKFLOW);

        const result = await exportWorkflow({
          target: 'vercel',
          input: inputPath,
          output: outputDir,
        });

        const vercelConfig = result.files.find((f) => f.path.includes('vercel.json'));
        const config = JSON.parse(vercelConfig!.content);

        expect(config.functions).toBeDefined();
        expect(config.functions['api/calculator.ts']).toBeDefined();
        expect(config.functions['api/calculator.ts'].maxDuration).toBe(60);
      });
    });

    describe('Cloudflare export', () => {
      it('should generate Cloudflare Worker', async () => {
        const inputPath = path.join(tempDir, 'cf-input.ts');
        const outputDir = path.join(tempDir, 'cf-output');

        fs.writeFileSync(inputPath, SAMPLE_WORKFLOW);

        const result = await exportWorkflow({
          target: 'cloudflare',
          input: inputPath,
          output: outputDir,
        });

        expect(result.target).toBe('cloudflare');
        expect(result.workflow).toBe('calculator');

        // Should generate index.ts
        const handlerFile = result.files.find((f) => f.path.includes('index.ts'));
        expect(handlerFile).toBeDefined();
        expect(handlerFile?.content).toContain('fetch');

        // Should generate wrangler.toml
        const wranglerConfig = result.files.find((f) => f.path.includes('wrangler.toml'));
        expect(wranglerConfig).toBeDefined();
        expect(wranglerConfig?.content).toContain('calculator');
      });

      it('should generate package.json with wrangler dependency', async () => {
        const inputPath = path.join(tempDir, 'cf-pkg-input.ts');
        const outputDir = path.join(tempDir, 'cf-pkg-output');

        fs.writeFileSync(inputPath, SAMPLE_WORKFLOW);

        const result = await exportWorkflow({
          target: 'cloudflare',
          input: inputPath,
          output: outputDir,
        });

        const packageFile = result.files.find((f) => f.path.includes('package.json'));
        const pkg = JSON.parse(packageFile!.content);

        expect(pkg.devDependencies.wrangler).toBeDefined();
        expect(pkg.devDependencies['@cloudflare/workers-types']).toBeDefined();
      });
    });

    describe('workflow selection', () => {
      it('should export first workflow by default', async () => {
        const inputPath = path.join(tempDir, 'multi-default-input.ts');
        const outputDir = path.join(tempDir, 'multi-default-output');

        fs.writeFileSync(inputPath, MULTI_WORKFLOW);

        const result = await exportWorkflow({
          target: 'vercel',
          input: inputPath,
          output: outputDir,
        });

        expect(result.workflow).toBe('firstWorkflow');
      });

      it('should export specific workflow with --workflow option', async () => {
        const inputPath = path.join(tempDir, 'multi-specific-input.ts');
        const outputDir = path.join(tempDir, 'multi-specific-output');

        fs.writeFileSync(inputPath, MULTI_WORKFLOW);

        const result = await exportWorkflow({
          target: 'vercel',
          input: inputPath,
          output: outputDir,
          workflow: 'secondWorkflow',
        });

        expect(result.workflow).toBe('secondWorkflow');
      });

      it('should throw error for non-existent workflow', async () => {
        const inputPath = path.join(tempDir, 'multi-error-input.ts');
        const outputDir = path.join(tempDir, 'multi-error-output');

        fs.writeFileSync(inputPath, MULTI_WORKFLOW);

        await expect(
          exportWorkflow({
            target: 'vercel',
            input: inputPath,
            output: outputDir,
            workflow: 'nonexistent',
          })
        ).rejects.toThrow('not found');
      });
    });

    describe('error handling', () => {
      it('should throw error for non-existent input file', async () => {
        await expect(
          exportWorkflow({
            target: 'lambda',
            input: '/nonexistent/file.ts',
            output: tempDir,
          })
        ).rejects.toThrow('Input file not found');
      });

      it('should throw error for file without workflows', async () => {
        const inputPath = path.join(tempDir, 'no-workflow-input.ts');

        fs.writeFileSync(
          inputPath,
          `
          export function notAWorkflow() {
            return 42;
          }
        `
        );

        await expect(
          exportWorkflow({
            target: 'lambda',
            input: inputPath,
            output: tempDir,
          })
        ).rejects.toThrow('No workflows found');
      });
    });

    describe('output directory', () => {
      it('should create output directory if it does not exist', async () => {
        const inputPath = path.join(tempDir, 'mkdir-input.ts');
        const outputDir = path.join(tempDir, 'new-dir', 'nested');

        fs.writeFileSync(inputPath, SAMPLE_WORKFLOW);

        await exportWorkflow({
          target: 'lambda',
          input: inputPath,
          output: outputDir,
        });

        expect(fs.existsSync(outputDir)).toBe(true);
      });

      it('should write all files to output directory', async () => {
        const inputPath = path.join(tempDir, 'write-files-input.ts');
        const outputDir = path.join(tempDir, 'write-files-output');

        fs.writeFileSync(inputPath, SAMPLE_WORKFLOW);

        const result = await exportWorkflow({
          target: 'lambda',
          input: inputPath,
          output: outputDir,
        });

        for (const file of result.files) {
          expect(fs.existsSync(file.path)).toBe(true);
        }
      });
    });

    describe('dry-run mode', () => {
      it('should not create output directory in dry-run mode', async () => {
        const inputPath = path.join(tempDir, 'dryrun-mkdir-input.ts');
        const outputDir = path.join(tempDir, 'dryrun-new-dir', 'nested');

        fs.writeFileSync(inputPath, SAMPLE_WORKFLOW);

        await exportWorkflow({
          target: 'lambda',
          input: inputPath,
          output: outputDir,
          dryRun: true,
        });

        expect(fs.existsSync(outputDir)).toBe(false);
      });

      it('should not write any files in dry-run mode', async () => {
        const inputPath = path.join(tempDir, 'dryrun-nowrite-input.ts');
        const outputDir = path.join(tempDir, 'dryrun-nowrite-output');

        fs.writeFileSync(inputPath, SAMPLE_WORKFLOW);

        const result = await exportWorkflow({
          target: 'vercel',
          input: inputPath,
          output: outputDir,
          dryRun: true,
        });

        expect(result.files.length).toBeGreaterThan(0);
        for (const file of result.files) {
          expect(fs.existsSync(file.path)).toBe(false);
        }
      });

      it('should still return file contents in dry-run mode', async () => {
        const inputPath = path.join(tempDir, 'dryrun-content-input.ts');
        const outputDir = path.join(tempDir, 'dryrun-content-output');

        fs.writeFileSync(inputPath, SAMPLE_WORKFLOW);

        const result = await exportWorkflow({
          target: 'cloudflare',
          input: inputPath,
          output: outputDir,
          dryRun: true,
        });

        // Handler should contain workflow function name
        const handlerFile = result.files.find((f) => f.path.includes('index.ts'));
        expect(handlerFile).toBeDefined();
        expect(handlerFile?.content).toContain('calculator');
        expect(handlerFile?.content).toContain('fetch');

        // Should have wrangler.toml content
        const wranglerFile = result.files.find((f) => f.path.includes('wrangler.toml'));
        expect(wranglerFile).toBeDefined();
        expect(wranglerFile?.content).toContain('calculator');
      });

      it('should return correct workflow metadata in dry-run mode', async () => {
        const inputPath = path.join(tempDir, 'dryrun-meta-input.ts');
        const outputDir = path.join(tempDir, 'dryrun-meta-output');

        fs.writeFileSync(inputPath, SAMPLE_WORKFLOW);

        const result = await exportWorkflow({
          target: 'lambda',
          input: inputPath,
          output: outputDir,
          dryRun: true,
        });

        expect(result.target).toBe('lambda');
        expect(result.workflow).toBe('calculator');
      });
    });
  });
});
