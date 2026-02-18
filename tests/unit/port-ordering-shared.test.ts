/**
 * Tests for shared port ordering utilities
 * Extracted from parser.ts for reuse across the codebase
 */

import { isMandatoryPort, assignImplicitPortOrders } from "../../src/utils/port-ordering";
import type { TPortDefinition } from "../../src/ast/types";

describe("Shared Port Ordering Utilities", () => {
  describe("isMandatoryPort", () => {
    describe("external scope (isScoped=false)", () => {
      it("should identify execute as mandatory", () => {
        expect(isMandatoryPort("execute", false)).toBe(true);
      });

      it("should identify onSuccess as mandatory", () => {
        expect(isMandatoryPort("onSuccess", false)).toBe(true);
      });

      it("should identify onFailure as mandatory", () => {
        expect(isMandatoryPort("onFailure", false)).toBe(true);
      });

      it("should return false for custom ports", () => {
        expect(isMandatoryPort("myCustomPort", false)).toBe(false);
        expect(isMandatoryPort("data", false)).toBe(false);
        expect(isMandatoryPort("result", false)).toBe(false);
      });
    });

    describe("scoped context (isScoped=true)", () => {
      it("should identify start as mandatory", () => {
        expect(isMandatoryPort("start", true)).toBe(true);
      });

      it("should identify success as mandatory", () => {
        expect(isMandatoryPort("success", true)).toBe(true);
      });

      it("should identify failure as mandatory", () => {
        expect(isMandatoryPort("failure", true)).toBe(true);
      });

      it("should return false for custom scoped ports", () => {
        expect(isMandatoryPort("item", true)).toBe(false);
        expect(isMandatoryPort("index", true)).toBe(false);
      });

      it("should return false for external mandatory ports in scoped context", () => {
        // execute, onSuccess, onFailure are NOT mandatory in scoped context
        expect(isMandatoryPort("execute", true)).toBe(false);
        expect(isMandatoryPort("onSuccess", true)).toBe(false);
        expect(isMandatoryPort("onFailure", true)).toBe(false);
      });
    });
  });

  describe("assignImplicitPortOrders", () => {
    it("should assign order 0 to mandatory ports first", () => {
      const ports: Record<string, TPortDefinition> = {
        customPort: { dataType: "STRING" },
        execute: { dataType: "STEP" },
      };

      assignImplicitPortOrders(ports);

      expect(ports.execute.metadata?.order).toBe(0);
      expect(ports.customPort.metadata?.order).toBe(1);
    });

    it("should preserve explicit order metadata", () => {
      const ports: Record<string, TPortDefinition> = {
        myPort: { dataType: "STRING", metadata: { order: 5 } },
        execute: { dataType: "STEP" },
      };

      assignImplicitPortOrders(ports);

      expect(ports.myPort.metadata?.order).toBe(5);
    });

    it("should handle multiple mandatory ports", () => {
      const ports: Record<string, TPortDefinition> = {
        data: { dataType: "STRING" },
        execute: { dataType: "STEP" },
        onSuccess: { dataType: "STEP" },
        onFailure: { dataType: "STEP" },
      };

      assignImplicitPortOrders(ports);

      // All mandatory ports should have lower orders than data
      const mandatoryOrders = [
        ports.execute.metadata?.order,
        ports.onSuccess.metadata?.order,
        ports.onFailure.metadata?.order,
      ].filter((o) => typeof o === "number") as number[];
      const dataOrder = ports.data.metadata?.order as number;

      expect(Math.max(...mandatoryOrders)).toBeLessThan(dataOrder);
    });

    it("should group ports by scope", () => {
      const ports: Record<string, TPortDefinition> = {
        start: { dataType: "STEP", scope: "loop" },
        item: { dataType: "ANY", scope: "loop" },
        execute: { dataType: "STEP" },
      };

      assignImplicitPortOrders(ports);

      // External scope
      expect(ports.execute.metadata?.order).toBe(0);
      // loop scope - start is mandatory within scope
      expect(ports.start.metadata?.order).toBe(0);
      expect(ports.item.metadata?.order).toBe(1);
    });

    it("should handle regular port with explicit order 0", () => {
      const ports: Record<string, TPortDefinition> = {
        firstPort: { dataType: "STRING", metadata: { order: 0 } },
        execute: { dataType: "STEP" },
      };

      assignImplicitPortOrders(ports);

      // Mandatory port should be pushed after port with explicit order 0
      expect(ports.execute.metadata?.order).toBeGreaterThanOrEqual(1);
      expect(ports.firstPort.metadata?.order).toBe(0);
    });

    it("should handle empty ports object", () => {
      const ports: Record<string, TPortDefinition> = {};

      // Should not throw
      expect(() => assignImplicitPortOrders(ports)).not.toThrow();
    });

    it("should handle ports with existing metadata", () => {
      const ports: Record<string, TPortDefinition> = {
        execute: { dataType: "STEP", metadata: { label: "Run" } },
        data: { dataType: "STRING" },
      };

      assignImplicitPortOrders(ports);

      // Should preserve existing metadata
      expect(ports.execute.metadata?.label).toBe("Run");
      expect(ports.execute.metadata?.order).toBe(0);
    });
  });
});
