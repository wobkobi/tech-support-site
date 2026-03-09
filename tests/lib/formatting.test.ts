import { describe, it, expect } from "vitest";
import * as formatting from "../../src/features/reviews/lib/formatting";

// Minimal test for formatting library

describe("formatting", () => {
  it("should export formatReview", () => {
    expect(typeof formatting.formatReview).toBe("function");
  });

  it("should title case names", () => {
    expect(formatting.toTitleCase("john doe and the team")).toBe("John Doe and the Team");
    expect(formatting.toTitleCase("a test of the system")).toBe("A Test of the System");
  });

  it("should format reviewer name", () => {
    expect(formatting.formatReviewerName({ firstName: "john", lastName: "doe" })).toBe("John Doe");
    expect(formatting.formatReviewerName({ isAnonymous: true })).toBe("Anonymous");
    expect(formatting.formatReviewerName({ firstName: "", lastName: "" })).toBe("Anonymous");
  });
});
