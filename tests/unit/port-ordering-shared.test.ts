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
    it("should assign negative orders to mandatory ports", () => {
      const ports: Record<string, TPortDefinition> = {
        customPort: { dataType: "STRING" },
        execute: { dataType: "STEP" },
      };

      assignImplicitPortOrders(ports);

      expect(ports.execute.metadata?.order).toBe(-1);
      expect(ports.customPort.metadata?.order).toBe(0);
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

      // External scope — execute is the only mandatory port, gets -1
      expect(ports.execute.metadata?.order).toBe(-1);
      // loop scope — start is mandatory within scope, gets -1; item follows at 0
      expect(ports.start.metadata?.order).toBe(-1);
      expect(ports.item.metadata?.order).toBe(0);
    });

    it("should sort mandatory ports before regular port with explicit order 0", () => {
      const ports: Record<string, TPortDefinition> = {
        firstPort: { dataType: "STRING", metadata: { order: 0 } },
        execute: { dataType: "STEP" },
      };

      assignImplicitPortOrders(ports);

      // Mandatory port gets negative order, sorting before explicit order 0
      expect(ports.execute.metadata?.order).toBe(-1);
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

      // Should preserve existing metadata and assign negative order
      expect(ports.execute.metadata?.label).toBe("Run");
      expect(ports.execute.metadata?.order).toBe(-1);
    });
    it("should not collide implicit mandatory orders with explicit regular orders", () => {
      const ports: Record<string, TPortDefinition> = {
        onSuccess: { dataType: "STEP" },
        onFailure: { dataType: "STEP" },
        result: { dataType: "ANY", metadata: { order: 1 } },
      };

      assignImplicitPortOrders(ports);

      // result keeps its explicit order
      expect(ports.result.metadata?.order).toBe(1);
      // mandatory ports get negative orders, no collision
      expect(ports.onSuccess.metadata?.order).toBeLessThan(0);
      expect(ports.onFailure.metadata?.order).toBeLessThan(0);
      // All orders must be unique
      const orders = [
        ports.onSuccess.metadata?.order,
        ports.onFailure.metadata?.order,
        ports.result.metadata?.order,
      ];
      expect(new Set(orders).size).toBe(orders.length);
    });

    it("should produce unique orders when explicit orders interleave with mandatory ports", () => {
      const ports: Record<string, TPortDefinition> = {
        execute: { dataType: "STEP" },
        onSuccess: { dataType: "STEP" },
        onFailure: { dataType: "STEP" },
        data: { dataType: "STRING", metadata: { order: 0 } },
        isValid: { dataType: "BOOLEAN", metadata: { order: 3 } },
        error: { dataType: "STRING" },
      };

      assignImplicitPortOrders(ports);

      const allOrders = Object.values(ports).map((p) => p.metadata?.order as number);
      // All orders must be unique (no collisions)
      expect(new Set(allOrders).size).toBe(allOrders.length);
      // Explicit orders preserved
      expect(ports.data.metadata?.order).toBe(0);
      expect(ports.isValid.metadata?.order).toBe(3);
      // Mandatory ports get negative orders
      expect(ports.execute.metadata?.order).toBeLessThan(0);
      expect(ports.onSuccess.metadata?.order).toBeLessThan(0);
      expect(ports.onFailure.metadata?.order).toBeLessThan(0);
    });

    it("should handle three mandatory ports with correct negative sequence", () => {
      const ports: Record<string, TPortDefinition> = {
        execute: { dataType: "STEP" },
        onSuccess: { dataType: "STEP" },
        onFailure: { dataType: "STEP" },
        data: { dataType: "STRING" },
      };

      assignImplicitPortOrders(ports);

      // 3 mandatory ports → start at -3, fill -3, -2, -1
      const mandatoryOrders = [
        ports.execute.metadata?.order,
        ports.onSuccess.metadata?.order,
        ports.onFailure.metadata?.order,
      ] as number[];
      expect(mandatoryOrders.sort((a, b) => a - b)).toEqual([-3, -2, -1]);
      // data port gets 0
      expect(ports.data.metadata?.order).toBe(0);
    });
  });
});
