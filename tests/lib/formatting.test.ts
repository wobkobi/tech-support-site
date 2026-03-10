import { describe, it, expect } from "vitest";
import * as formatting from "../../src/features/reviews/lib/formatting";

describe("formatting", () => {
  it("should export formatReviewerName", () => {
    expect(typeof formatting.formatReviewerName).toBe("function");
  });

  it("should format reviewer name as Firstname L. when both names present", () => {
    expect(formatting.formatReviewerName({ firstName: "John", lastName: "Doe" })).toBe("John D.");
    expect(formatting.formatReviewerName({ firstName: "McDonald", lastName: "Smith" })).toBe(
      "McDonald S.",
    );
    expect(formatting.formatReviewerName({ firstName: "Jane" })).toBe("Jane");
    expect(formatting.formatReviewerName({ isAnonymous: true })).toBe("Anonymous");
    expect(formatting.formatReviewerName({ firstName: "", lastName: "" })).toBe("Anonymous");
    expect(formatting.formatReviewerName({ firstName: "Jane", lastName: "" })).toBe("Jane");
  });
});
