/**
 * Tests for Transform API
 * Tests transformWorkflow, applyTransformations, and composeTransformers
 */

import {
  transformWorkflow,
  applyTransformations,
  composeTransformers,
} from "../../src/api/transform";
import type { TASTTransformer } from "../../src/ast/types";
import { createSimpleWorkflow, createChainWorkflow } from "../helpers/test-fixtures";

describe("Transform API", () => {
  describe("transformWorkflow", () => {
    it("should apply a basic transformation", () => {
      const workflow = createSimpleWorkflow();
      const transformer: TASTTransformer = {
        name: "rename-workflow",
        transform: (ast) => ({ ...ast, name: "renamedWorkflow" }),
      };

      const result = transformWorkflow(workflow, transformer);

      expect(result.name).toBe("renamedWorkflow");
    });

    it("should not mutate the original workflow (deep clone)", () => {
      const workflow = createSimpleWorkflow();
      const originalName = workflow.name;
      const transformer: TASTTransformer = {
        name: "mutating-transformer",
        transform: (ast) => {
          ast.name = "mutated";
          return ast;
        },
      };

      transformWorkflow(workflow, transformer);

      expect(workflow.name).toBe(originalName);
    });

    it("should handle identity transformer (no changes)", () => {
      const workflow = createSimpleWorkflow();
      const transformer: TASTTransformer = {
        name: "identity",
        transform: (ast) => ast,
      };

      const result = transformWorkflow(workflow, transformer);

      expect(result).toEqual(workflow);
    });

    it("should transform nested properties", () => {
      const workflow = createSimpleWorkflow();
      const transformer: TASTTransformer = {
        name: "add-description",
        transform: (ast) => ({
          ...ast,
          description: "Added by transformer",
        }),
      };

      const result = transformWorkflow(workflow, transformer);

      expect(result.description).toBe("Added by transformer");
    });
  });

  describe("applyTransformations", () => {
    it("should apply multiple transformers in sequence", () => {
      const workflow = createSimpleWorkflow();
      const transformers: TASTTransformer[] = [
        {
          name: "rename",
          transform: (ast) => ({ ...ast, name: "step1" }),
        },
        {
          name: "add-description",
          transform: (ast) => ({ ...ast, description: `Desc for ${ast.name}` }),
        },
      ];

      const result = applyTransformations(workflow, transformers);

      expect(result.name).toBe("step1");
      expect(result.description).toBe("Desc for step1");
    });

    it("should handle empty transformer list", () => {
      const workflow = createSimpleWorkflow();
      const transformers: TASTTransformer[] = [];

      const result = applyTransformations(workflow, transformers);

      expect(result).toEqual(workflow);
    });

    it("should chain transformations correctly (order matters)", () => {
      const workflow = createSimpleWorkflow();
      workflow.name = "original";
      const transformers: TASTTransformer[] = [
        {
          name: "first",
          transform: (ast) => ({ ...ast, name: ast.name + "-first" }),
        },
        {
          name: "second",
          transform: (ast) => ({ ...ast, name: ast.name + "-second" }),
        },
        {
          name: "third",
          transform: (ast) => ({ ...ast, name: ast.name + "-third" }),
        },
      ];

      const result = applyTransformations(workflow, transformers);

      expect(result.name).toBe("original-first-second-third");
    });

    it("should preserve all properties through chain", () => {
      const workflow = createChainWorkflow();
      const nodeCount = workflow.instances.length;
      const connectionCount = workflow.connections.length;

      const transformers: TASTTransformer[] = [
        {
          name: "rename",
          transform: (ast) => ({ ...ast, name: "renamed" }),
        },
      ];

      const result = applyTransformations(workflow, transformers);

      expect(result.instances.length).toBe(nodeCount);
      expect(result.connections.length).toBe(connectionCount);
    });
  });

  describe("composeTransformers", () => {
    it("should create a composed transformer with correct name", () => {
      const transformers: TASTTransformer[] = [
        { name: "alpha", transform: (ast) => ast },
        { name: "beta", transform: (ast) => ast },
        { name: "gamma", transform: (ast) => ast },
      ];

      const composed = composeTransformers(transformers);

      expect(composed.name).toBe("composed(alpha, beta, gamma)");
    });

    it("should apply composed transformer correctly", () => {
      const workflow = createSimpleWorkflow();
      workflow.name = "start";

      const transformers: TASTTransformer[] = [
        {
          name: "add-A",
          transform: (ast) => ({ ...ast, name: ast.name + "A" }),
        },
        {
          name: "add-B",
          transform: (ast) => ({ ...ast, name: ast.name + "B" }),
        },
      ];

      const composed = composeTransformers(transformers);
      const result = composed.transform(workflow);

      expect(result.name).toBe("startAB");
    });

    it("should handle single transformer composition", () => {
      const singleTransformer: TASTTransformer = {
        name: "single",
        transform: (ast) => ({ ...ast, name: "single-applied" }),
      };

      const composed = composeTransformers([singleTransformer]);

      expect(composed.name).toBe("composed(single)");

      const workflow = createSimpleWorkflow();
      const result = composed.transform(workflow);
      expect(result.name).toBe("single-applied");
    });

    it("should handle empty transformer list", () => {
      const composed = composeTransformers([]);

      expect(composed.name).toBe("composed()");

      const workflow = createSimpleWorkflow();
      const result = composed.transform(workflow);
      expect(result).toEqual(workflow);
    });
  });

  describe("Edge Cases", () => {
    it("should handle transformer that throws error", () => {
      const workflow = createSimpleWorkflow();
      const transformer: TASTTransformer = {
        name: "error-transformer",
        transform: () => {
          throw new Error("Transformer failed");
        },
      };

      expect(() => transformWorkflow(workflow, transformer)).toThrow("Transformer failed");
    });

    it("should handle transformer that returns modified node types", () => {
      const workflow = createSimpleWorkflow();
      const transformer: TASTTransformer = {
        name: "modify-node-types",
        transform: (ast) => ({
          ...ast,
          nodeTypes: ast.nodeTypes.map((nt) => ({
            ...nt,
            description: "Modified",
          })),
        }),
      };

      const result = transformWorkflow(workflow, transformer);

      expect(result.nodeTypes[0].description).toBe("Modified");
      expect(workflow.nodeTypes[0].description).toBeUndefined();
    });

    it("should handle transformer that adds new node instances", () => {
      const workflow = createSimpleWorkflow();
      const originalCount = workflow.instances.length;

      const transformer: TASTTransformer = {
        name: "add-node",
        transform: (ast) => ({
          ...ast,
          instances: [
            ...ast.instances,
            {
              type: "NodeInstance" as const,
              id: "newNode",
              nodeType: ast.nodeTypes[0].functionName,
            },
          ],
        }),
      };

      const result = transformWorkflow(workflow, transformer);

      expect(result.instances.length).toBe(originalCount + 1);
      expect(result.instances.find((n) => n.id === "newNode")).toBeDefined();
    });
  });
});
