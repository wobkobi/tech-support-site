import { describe, it, expect } from "vitest";
import * as formatting from "../../src/features/reviews/lib/formatting";

describe("formatting", () => {
  it("should export formatReviewerName", () => {
    expect(typeof formatting.formatReviewerName).toBe("function");
  });

  it("should format reviewer name when both names present", () => {
    expect(formatting.formatReviewerName({ firstName: "John", lastName: "Smith" })).toBe(
      "John Smith",
    );
    expect(formatting.formatReviewerName({ firstName: "McDonald", lastName: "Jones" })).toBe(
      "McDonald Jones",
    );
    expect(formatting.formatReviewerName({ firstName: "Jane" })).toBe("Jane");
    expect(formatting.formatReviewerName({ isAnonymous: true })).toBe("Anonymous");
    expect(formatting.formatReviewerName({ firstName: "", lastName: "" })).toBe("Anonymous");
    expect(formatting.formatReviewerName({ firstName: "Jane", lastName: "" })).toBe("Jane");
  });
});
