/**
 * Diagnostic tests for CLI templates
 *
 * Tests that all templates generate valid workflows with no validation errors.
 * These tests serve as regression tests for template correctness.
 */

import { parser } from "../../src/parser";
import { validator } from "../../src/validator";
import {
  listWorkflowTemplates,
  listNodeTemplates,
  generateWorkflowFromTemplate,
  generateNodeFromTemplate,
} from "../../src/api/templates";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const tempDir = path.join(os.tmpdir(), `flow-weaver-template-diagnostics-${process.pid}`);

// Ensure temp directory exists
beforeAll(() => {
  fs.mkdirSync(tempDir, { recursive: true });
});

// Clean up after each test
afterEach(() => {
  // Clear require cache for temp files
  Object.keys(require.cache).forEach((key) => {
    if (key.includes(tempDir)) {
      delete require.cache[key];
    }
  });
});

describe("Template Diagnostics", () => {
  describe("Workflow Templates", () => {
    const templates = listWorkflowTemplates();

    templates.forEach((template) => {
      describe(`${template.name} (${template.id})`, () => {
        let generatedCode: string;
        let testFilePath: string;

        beforeAll(() => {
          generatedCode = generateWorkflowFromTemplate(template.id, { workflowName: `Test${template.id.replace(/-/g, "")}Workflow` });
          testFilePath = path.join(tempDir, `${template.id}-workflow.ts`);
          fs.writeFileSync(testFilePath, generatedCode);
        });

        it("should generate valid TypeScript code", () => {
          expect(generatedCode).toBeDefined();
          expect(generatedCode.length).toBeGreaterThan(0);
        });

        it("should contain @flowWeaver workflow annotation", () => {
          expect(generatedCode).toContain("@flowWeaver workflow");
        });

        it("should contain @flowWeaver nodeType annotations", () => {
          expect(generatedCode).toContain("@flowWeaver nodeType");
        });

        it("should parse without errors", () => {
          const result = parser.parse(testFilePath);

          expect(result.workflows.length).toBeGreaterThanOrEqual(1);
          expect(result.nodeTypes.length).toBeGreaterThanOrEqual(1);
        });

        it("should validate without errors", () => {
          const parseResult = parser.parse(testFilePath);
          const workflow = parseResult.workflows[0];

          const validationResult = validator.validate(workflow);

          // Log errors for debugging if validation fails
          if (!validationResult.valid) {
            console.error(`Validation errors for ${template.id}:`);
            validationResult.errors.forEach((err) => {
              console.error(`  - ${err.message}`);
            });
          }

          expect(validationResult.errors).toEqual([]);
          expect(validationResult.valid).toBe(true);
        });

        it("should have all node instances reference existing node types", () => {
          const parseResult = parser.parse(testFilePath);
          const workflow = parseResult.workflows[0];
          const nodeTypeNames = parseResult.nodeTypes.map((nt) => nt.functionName);

          workflow.instances.forEach((instance) => {
            expect(nodeTypeNames).toContain(instance.nodeType);
          });
        });

        it("should have valid @connect annotations", () => {
          const parseResult = parser.parse(testFilePath);
          const workflow = parseResult.workflows[0];

          // All connections should have valid from/to references
          workflow.connections.forEach((conn) => {
            expect(conn.from.node).toBeDefined();
            expect(conn.from.port).toBeDefined();
            expect(conn.to.node).toBeDefined();
            expect(conn.to.port).toBeDefined();
          });
        });

        it("should have matching STEP port connections", () => {
          const parseResult = parser.parse(testFilePath);
          const workflow = parseResult.workflows[0];
          const validationResult = validator.validate(workflow);

          // Check for STEP port type mismatches
          const stepMismatchErrors = validationResult.errors.filter(
            (err) =>
              err.message.includes("STEP port") &&
              (err.message.includes("cannot connect to non-STEP") ||
                err.message.includes("Non-STEP port") && err.message.includes("cannot connect to STEP"))
          );

          if (stepMismatchErrors.length > 0) {
            console.error(`STEP port mismatch errors for ${template.id}:`);
            stepMismatchErrors.forEach((err) => {
              console.error(`  - ${err.message}`);
            });
          }

          expect(stepMismatchErrors).toEqual([]);
        });
      });
    });
  });

  describe("Node Templates", () => {
    const templates = listNodeTemplates();

    templates.forEach((template) => {
      describe(`${template.name} (${template.id})`, () => {
        let generatedCode: string;
        let testFilePath: string;

        beforeAll(() => {
          generatedCode = generateNodeFromTemplate(template.id, `test${template.id.replace(/-/g, "")}Node`);
          testFilePath = path.join(tempDir, `${template.id}-node.ts`);
          fs.writeFileSync(testFilePath, generatedCode);
        });

        it("should generate valid TypeScript code", () => {
          expect(generatedCode).toBeDefined();
          expect(generatedCode.length).toBeGreaterThan(0);
        });

        it("should contain @flowWeaver nodeType annotation", () => {
          expect(generatedCode).toContain("@flowWeaver nodeType");
        });

        it("should contain mandatory @input execute port (normal-mode only)", () => {
          const isExpression = generatedCode.includes("@expression");
          if (isExpression) {
            // Expression nodes must NOT have execute/onSuccess/onFailure
            expect(generatedCode).not.toContain("@input execute");
          } else {
            expect(generatedCode).toContain("@input execute");
          }
        });

        it("should contain mandatory @output onSuccess port (normal-mode only)", () => {
          const isExpression = generatedCode.includes("@expression");
          if (isExpression) {
            expect(generatedCode).not.toContain("@output onSuccess");
          } else {
            expect(generatedCode).toContain("@output onSuccess");
          }
        });

        it("should contain mandatory @output onFailure port (normal-mode only)", () => {
          const isExpression = generatedCode.includes("@expression");
          if (isExpression) {
            expect(generatedCode).not.toContain("@output onFailure");
          } else {
            expect(generatedCode).toContain("@output onFailure");
          }
        });

        it("should contain @label annotation", () => {
          expect(generatedCode).toContain("@label");
        });

        it("should parse without errors", () => {
          const result = parser.parse(testFilePath);

          expect(result.nodeTypes.length).toBeGreaterThanOrEqual(1);
        });

        it("should have valid port definitions", () => {
          const result = parser.parse(testFilePath);
          const nodeType = result.nodeTypes[0];

          // Parser auto-adds STEP ports for all node types (including expression nodes)
          expect(nodeType.inputs.execute).toBeDefined();
          expect(nodeType.inputs.execute.dataType).toBe("STEP");

          expect(nodeType.outputs.onSuccess).toBeDefined();
          expect(nodeType.outputs.onSuccess.dataType).toBe("STEP");

          expect(nodeType.outputs.onFailure).toBeDefined();
          expect(nodeType.outputs.onFailure.dataType).toBe("STEP");
        });
      });
    });
  });

  describe("Scoped Template Specifics", () => {
    it("foreach template should have valid scoped STEP ports", () => {
      const generatedCode = generateWorkflowFromTemplate("foreach", { workflowName: "TestForEachWorkflow" });
      const testFilePath = path.join(tempDir, "foreach-scoped-test.ts");
      fs.writeFileSync(testFilePath, generatedCode);

      const result = parser.parse(testFilePath);
      const forEachNodeType = result.nodeTypes.find((nt) => nt.functionName === "forEachItem");

      expect(forEachNodeType).toBeDefined();
      if (!forEachNodeType) return;

      // Scoped output ports should be STEP type
      const startPort = forEachNodeType.outputs.start;
      expect(startPort).toBeDefined();
      expect(startPort.scope).toBe("processItem");
      expect(startPort.dataType).toBe("STEP");

      // Scoped input ports should be STEP type
      const successPort = forEachNodeType.inputs.success;
      expect(successPort).toBeDefined();
      expect(successPort.scope).toBe("processItem");
      expect(successPort.dataType).toBe("STEP");

      const failurePort = forEachNodeType.inputs.failure;
      expect(failurePort).toBeDefined();
      expect(failurePort.scope).toBe("processItem");
      expect(failurePort.dataType).toBe("STEP");
    });

    it("foreach template workflow should validate without STEP mismatch errors", () => {
      const generatedCode = generateWorkflowFromTemplate("foreach", { workflowName: "TestForEachValidation" });
      const testFilePath = path.join(tempDir, "foreach-validation-test.ts");
      fs.writeFileSync(testFilePath, generatedCode);

      const result = parser.parse(testFilePath);
      const workflow = result.workflows[0];
      const validationResult = validator.validate(workflow);

      // Check for STEP port type mismatches
      const stepMismatchErrors = validationResult.errors.filter(
        (err) =>
          err.message.includes("STEP port") ||
          err.message.includes("non-STEP port")
      );

      if (stepMismatchErrors.length > 0) {
        console.error("STEP port mismatch errors in foreach template:");
        stepMismatchErrors.forEach((err) => {
          console.error(`  - ${err.message}`);
        });
      }

      expect(stepMismatchErrors).toEqual([]);
    });
  });
});
