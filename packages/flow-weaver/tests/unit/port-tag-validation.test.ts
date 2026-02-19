/**
 * Tests for port tag validation utilities
 * Shared logic for determining port tag types (@input, @output, @step)
 */

import {
  isReservedStepPort,
  shouldUseStepTag,
  getPortTagType,
} from "../../src/utils/port-tag-utils";
import type { TPortDefinition } from "../../src/ast/types";

describe("Port Tag Validation Utilities", () => {
  describe("isReservedStepPort", () => {
    describe("external reserved ports", () => {
      it("should return true for execute", () => {
        expect(isReservedStepPort("execute")).toBe(true);
      });

      it("should return true for onSuccess", () => {
        expect(isReservedStepPort("onSuccess")).toBe(true);
      });

      it("should return true for onFailure", () => {
        expect(isReservedStepPort("onFailure")).toBe(true);
      });
    });

    describe("scoped reserved ports", () => {
      it("should return true for start", () => {
        expect(isReservedStepPort("start")).toBe(true);
      });

      it("should return true for success", () => {
        expect(isReservedStepPort("success")).toBe(true);
      });

      it("should return true for failure", () => {
        expect(isReservedStepPort("failure")).toBe(true);
      });
    });

    describe("non-reserved ports", () => {
      it("should return false for custom step ports", () => {
        expect(isReservedStepPort("onComplete")).toBe(false);
        expect(isReservedStepPort("onTimeout")).toBe(false);
        expect(isReservedStepPort("nextStep")).toBe(false);
      });

      it("should return false for data ports", () => {
        expect(isReservedStepPort("data")).toBe(false);
        expect(isReservedStepPort("result")).toBe(false);
        expect(isReservedStepPort("item")).toBe(false);
      });
    });
  });

  describe("shouldUseStepTag", () => {
    it("should return false for reserved STEP ports", () => {
      const port: TPortDefinition = { dataType: "STEP" };
      expect(shouldUseStepTag("execute", port)).toBe(false);
      expect(shouldUseStepTag("onSuccess", port)).toBe(false);
      expect(shouldUseStepTag("onFailure", port)).toBe(false);
    });

    it("should return true for custom STEP ports", () => {
      const port: TPortDefinition = { dataType: "STEP" };
      expect(shouldUseStepTag("onComplete", port)).toBe(true);
      expect(shouldUseStepTag("onTimeout", port)).toBe(true);
    });

    it("should return false for scoped mandatory ports", () => {
      const port: TPortDefinition = { dataType: "STEP", scope: "loop" };
      expect(shouldUseStepTag("start", port)).toBe(false);
      expect(shouldUseStepTag("success", port)).toBe(false);
      expect(shouldUseStepTag("failure", port)).toBe(false);
    });

    it("should return false for non-STEP ports", () => {
      const stringPort: TPortDefinition = { dataType: "STRING" };
      expect(shouldUseStepTag("data", stringPort)).toBe(false);

      const numberPort: TPortDefinition = { dataType: "NUMBER" };
      expect(shouldUseStepTag("count", numberPort)).toBe(false);
    });
  });

  describe("getPortTagType", () => {
    it("should return 'input' for input direction data ports", () => {
      const port: TPortDefinition = { dataType: "STRING" };
      expect(getPortTagType("myPort", port, "input")).toBe("input");
    });

    it("should return 'output' for output direction data ports", () => {
      const port: TPortDefinition = { dataType: "NUMBER" };
      expect(getPortTagType("result", port, "output")).toBe("output");
    });

    it("should return 'step' for custom STEP ports", () => {
      const port: TPortDefinition = { dataType: "STEP" };
      expect(getPortTagType("onComplete", port, "output")).toBe("step");
      expect(getPortTagType("onTimeout", port, "output")).toBe("step");
    });

    it("should return 'input' for execute port (reserved)", () => {
      const port: TPortDefinition = { dataType: "STEP" };
      expect(getPortTagType("execute", port, "input")).toBe("input");
    });

    it("should return 'output' for onSuccess/onFailure ports (reserved)", () => {
      const port: TPortDefinition = { dataType: "STEP" };
      expect(getPortTagType("onSuccess", port, "output")).toBe("output");
      expect(getPortTagType("onFailure", port, "output")).toBe("output");
    });

    it("should return direction for scoped mandatory ports", () => {
      const port: TPortDefinition = { dataType: "STEP", scope: "loop" };
      expect(getPortTagType("start", port, "output")).toBe("output");
      expect(getPortTagType("success", port, "input")).toBe("input");
    });
  });
});
