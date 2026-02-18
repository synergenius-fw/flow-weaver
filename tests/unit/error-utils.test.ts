/**
 * Tests for error-utils.ts
 * Utility functions for consistent error message extraction and wrapping.
 */

import { getErrorMessage, wrapError } from "../../src/utils/error-utils";

describe("getErrorMessage", () => {
  describe("Error instances", () => {
    it("should extract message from Error instance", () => {
      const error = new Error("Something went wrong");
      expect(getErrorMessage(error)).toBe("Something went wrong");
    });

    it("should extract message from TypeError", () => {
      const error = new TypeError("Cannot read property");
      expect(getErrorMessage(error)).toBe("Cannot read property");
    });

    it("should extract message from custom Error subclass", () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = "CustomError";
        }
      }
      const error = new CustomError("Custom error message");
      expect(getErrorMessage(error)).toBe("Custom error message");
    });

    it("should handle error with empty message", () => {
      const error = new Error("");
      expect(getErrorMessage(error)).toBe("");
    });
  });

  describe("Primitive types", () => {
    it("should convert string to string", () => {
      expect(getErrorMessage("Raw error string")).toBe("Raw error string");
    });

    it("should convert number to string", () => {
      expect(getErrorMessage(42)).toBe("42");
    });

    it("should convert null to string", () => {
      expect(getErrorMessage(null)).toBe("null");
    });

    it("should convert undefined to string", () => {
      expect(getErrorMessage(undefined)).toBe("undefined");
    });

    it("should convert boolean to string", () => {
      expect(getErrorMessage(false)).toBe("false");
      expect(getErrorMessage(true)).toBe("true");
    });
  });

  describe("Object types", () => {
    it("should convert plain object to string", () => {
      expect(getErrorMessage({ code: 500 })).toBe("[object Object]");
    });

    it("should use toString if object has custom toString", () => {
      const obj = {
        toString() {
          return "Custom toString output";
        },
      };
      expect(getErrorMessage(obj)).toBe("Custom toString output");
    });
  });
});

describe("wrapError", () => {
  describe("Wrapping Error instances", () => {
    it("should wrap Error with context", () => {
      const original = new Error("Original message");
      const wrapped = wrapError(original, "While parsing");
      expect(wrapped.message).toBe("While parsing: Original message");
    });

    it("should preserve original error in cause", () => {
      const original = new Error("Original");
      const wrapped = wrapError(original, "Context");
      expect((wrapped as Error & { cause?: unknown }).cause).toBe(original);
    });

    it("should handle nested wrapping", () => {
      const original = new Error("Root cause");
      const wrapped1 = wrapError(original, "Level 1");
      const wrapped2 = wrapError(wrapped1, "Level 2");
      expect(wrapped2.message).toBe("Level 2: Level 1: Root cause");
      expect((wrapped2 as Error & { cause?: unknown }).cause).toBe(wrapped1);
    });
  });

  describe("Wrapping non-Error values", () => {
    it("should wrap string with context", () => {
      const wrapped = wrapError("Raw string error", "Context");
      expect(wrapped.message).toBe("Context: Raw string error");
    });

    it("should wrap number with context", () => {
      const wrapped = wrapError(404, "HTTP Error");
      expect(wrapped.message).toBe("HTTP Error: 404");
    });

    it("should wrap null with context", () => {
      const wrapped = wrapError(null, "Unexpected value");
      expect(wrapped.message).toBe("Unexpected value: null");
    });

    it("should not set cause for non-Error values", () => {
      const wrapped = wrapError("string error", "Context");
      expect((wrapped as Error & { cause?: unknown }).cause).toBeUndefined();
    });
  });

  describe("Edge cases", () => {
    it("should handle empty context", () => {
      const original = new Error("Message");
      const wrapped = wrapError(original, "");
      expect(wrapped.message).toBe(": Message");
    });

    it("should handle empty error message", () => {
      const original = new Error("");
      const wrapped = wrapError(original, "Context");
      expect(wrapped.message).toBe("Context: ");
    });
  });
});
