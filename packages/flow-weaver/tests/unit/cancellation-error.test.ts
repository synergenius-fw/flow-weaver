/**
 * Tests for CancellationError
 */

import { CancellationError } from "../../src/runtime/CancellationError";

describe("CancellationError", () => {
  it("should create with default message", () => {
    const error = new CancellationError();
    expect(error.message).toBe("Workflow execution cancelled");
    expect(error.name).toBe("CancellationError");
  });

  it("should create with custom message", () => {
    const error = new CancellationError("Custom cancel message");
    expect(error.message).toBe("Custom cancel message");
  });

  it("should include executionIndex and nodeId", () => {
    const error = new CancellationError("Cancelled", 5, "myNode");
    expect(error.executionIndex).toBe(5);
    expect(error.nodeId).toBe("myNode");
  });

  it("should have timestamp", () => {
    const before = Date.now();
    const error = new CancellationError();
    const after = Date.now();

    expect(error.timestamp).toBeGreaterThanOrEqual(before);
    expect(error.timestamp).toBeLessThanOrEqual(after);
  });

  describe("isCancellationError", () => {
    it("should return true for CancellationError instance", () => {
      const error = new CancellationError();
      expect(CancellationError.isCancellationError(error)).toBe(true);
    });

    it("should return false for regular Error", () => {
      const error = new Error("Regular error");
      expect(CancellationError.isCancellationError(error)).toBe(false);
    });

    it("should return true for error with matching name property", () => {
      const error = new Error("Fake cancellation");
      error.name = "CancellationError";
      expect(CancellationError.isCancellationError(error)).toBe(true);
    });

    it("should return false for non-Error values", () => {
      expect(CancellationError.isCancellationError(null)).toBe(false);
      expect(CancellationError.isCancellationError(undefined)).toBe(false);
      expect(CancellationError.isCancellationError("error string")).toBe(false);
      expect(CancellationError.isCancellationError({ message: "error" })).toBe(false);
    });
  });
});
