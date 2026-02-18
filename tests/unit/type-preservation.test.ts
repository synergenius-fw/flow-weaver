/**
 * Tests for type preservation in code generation
 *
 * Both generateCode (standalone API) and generateInPlace (CLI) should
 * preserve interface and type declarations from the source file.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generateCode } from "../../src/api/generate";
import { generateInPlace } from "../../src/api/generate-in-place";
import { parseWorkflow } from "../../src/api/parse";

describe("Type Preservation", () => {
  const tempDir = path.join(os.tmpdir(), `flow-weaver-type-preservation-${process.pid}`);

  // Helper to write file ensuring directory exists (handles parallel test cleanup)
  function writeFile(filePath: string, content: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  beforeEach(() => {
    // Create temp dir before each test to handle parallel test cleanup
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    // Note: import() is cached by the JS runtime but we use unique file names
    // so cache clearing is not needed
  });

  const sourceWithTypes = `
interface Lead {
  email: string;
  name: string;
  company: string;
}

interface ProcessedLead {
  lead: Lead;
  status: 'success' | 'failed';
}

/**
 * @flowWeaver nodeType
 * @input lead - Lead to process
 * @output result - Processed result
 */
function processLead(
  execute: boolean,
  lead: Lead
): { onSuccess: boolean; onFailure: boolean; result: ProcessedLead } {
  if (!execute) return { onSuccess: false, onFailure: false, result: {} as ProcessedLead };
  return {
    onSuccess: true,
    onFailure: false,
    result: { lead, status: 'success' }
  };
}

/**
 * @flowWeaver workflow
 * @param lead - Input lead
 * @returns result - Processed lead
 * @node proc processLead
 * @connect Start.execute -> proc.execute
 * @connect Start.lead -> proc.lead
 * @connect proc.result -> Exit.result
 * @connect proc.onSuccess -> Exit.onSuccess
 * @connect proc.onFailure -> Exit.onFailure
 */
export function processLeadWorkflow(
  execute: boolean,
  params: { lead: Lead }
): { onSuccess: boolean; onFailure: boolean; result: ProcessedLead } {
  throw new Error('Not implemented');
}
`;

  describe("generateInPlace (CLI path)", () => {
    it("should preserve interface declarations", async () => {
      const testFile = path.join(tempDir, "in-place-types.ts");
      writeFile(testFile, sourceWithTypes);

      const parseResult = await parseWorkflow(testFile, { workflowName: "processLeadWorkflow" });
      expect(parseResult.errors).toHaveLength(0);

      const result = generateInPlace(sourceWithTypes, parseResult.ast);

      // Should contain the interface definitions
      expect(result.code).toContain("interface Lead {");
      expect(result.code).toContain("interface ProcessedLead {");

      // Write and verify it compiles
      writeFile(testFile, result.code);
      const module = await import(testFile);

      const execResult = module.processLeadWorkflow(true, {
        lead: { email: "test@example.com", name: "Test", company: "Acme" }
      });

      expect(execResult.result.lead.name).toBe("Test");
      expect(execResult.result.status).toBe("success");
    });
  });

  describe("generateCode (standalone API path)", () => {
    it("should preserve interface declarations from source file", async () => {
      const testFile = path.join(tempDir, "standalone-types.ts");
      writeFile(testFile, sourceWithTypes);

      const parseResult = await parseWorkflow(testFile, { workflowName: "processLeadWorkflow" });
      expect(parseResult.errors).toHaveLength(0);

      const code = generateCode(parseResult.ast, {});

      // Should contain the interface definitions
      expect(code).toContain("interface Lead {");
      expect(code).toContain("interface ProcessedLead {");

      // Write and verify it compiles
      const outputFile = path.join(tempDir, "standalone-types.generated.ts");
      writeFile(outputFile, code);
      const module = await import(outputFile);

      const execResult = module.processLeadWorkflow(true, {
        lead: { email: "test@example.com", name: "Test", company: "Acme" }
      });

      expect(execResult.result.lead.name).toBe("Test");
      expect(execResult.result.status).toBe("success");
    });
  });

  describe("type alias preservation", () => {
    const sourceWithTypeAlias = `
type Status = 'pending' | 'active' | 'completed';

type Task = {
  id: string;
  title: string;
  status: Status;
};

/**
 * @flowWeaver nodeType
 * @input task - Task to process
 * @output updated - Updated task
 */
function updateTask(
  execute: boolean,
  task: Task
): { onSuccess: boolean; onFailure: boolean; updated: Task } {
  if (!execute) return { onSuccess: false, onFailure: false, updated: {} as Task };
  return {
    onSuccess: true,
    onFailure: false,
    updated: { ...task, status: 'completed' as Status }
  };
}

/**
 * @flowWeaver workflow
 * @param task - Input task
 * @returns updated - Updated task
 * @node updater updateTask
 * @connect Start.execute -> updater.execute
 * @connect Start.task -> updater.task
 * @connect updater.updated -> Exit.updated
 * @connect updater.onSuccess -> Exit.onSuccess
 * @connect updater.onFailure -> Exit.onFailure
 */
export function updateTaskWorkflow(
  execute: boolean,
  params: { task: Task }
): { onSuccess: boolean; onFailure: boolean; updated: Task } {
  throw new Error('Not implemented');
}
`;

    it("should preserve type alias declarations", async () => {
      const testFile = path.join(tempDir, "type-alias.ts");
      writeFile(testFile, sourceWithTypeAlias);

      const parseResult = await parseWorkflow(testFile, { workflowName: "updateTaskWorkflow" });
      expect(parseResult.errors).toHaveLength(0);

      const code = generateCode(parseResult.ast, {});

      // Should contain type alias definitions
      expect(code).toContain("type Status =");
      expect(code).toContain("type Task =");

      // Write and verify it compiles
      const outputFile = path.join(tempDir, "type-alias.generated.ts");
      writeFile(outputFile, code);
      const module = await import(outputFile);

      const execResult = module.updateTaskWorkflow(true, {
        task: { id: "1", title: "Test Task", status: "pending" as const }
      });

      expect(execResult.updated.status).toBe("completed");
    });
  });
});
