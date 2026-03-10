import { describe, it, expect } from "vitest";
import { reviewTextError } from "../../src/features/reviews/lib/validation";

describe("reviewTextError", () => {
  it("returns error for undefined input", () => {
    expect(reviewTextError(undefined)).toBe("Review must be at least 10 characters.");
  });

  it("returns error for empty string", () => {
    expect(reviewTextError("")).toBe("Review must be at least 10 characters.");
  });

  it("returns error for text shorter than 10 characters", () => {
    expect(reviewTextError("short")).toBe("Review must be at least 10 characters.");
  });

  it("returns error for whitespace-only string that trims to under 10 chars", () => {
    expect(reviewTextError("   ")).toBe("Review must be at least 10 characters.");
  });

  it("returns null for text exactly 10 characters long", () => {
    expect(reviewTextError("1234567890")).toBeNull();
  });

  it("returns null for text exactly 600 characters long", () => {
    expect(reviewTextError("a".repeat(600))).toBeNull();
  });

  it("returns error for text over 600 characters", () => {
    expect(reviewTextError("a".repeat(601))).toBe("Review must be 600 characters or less.");
  });

  it("returns null for normal review text", () => {
    expect(reviewTextError("Great service, highly recommended!")).toBeNull();
  });

  it("trims whitespace before checking length", () => {
    // 9 visible chars + surrounding spaces → trims to 9 → invalid
    expect(reviewTextError("  123456789  ".trim().slice(0, 9))).toBe(
      "Review must be at least 10 characters.",
    );
  });
});
