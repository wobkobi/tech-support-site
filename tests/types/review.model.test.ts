import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

describe("Review model type", () => {
  it("should have status and customerRef fields", () => {
    const review: Prisma.ReviewCreateInput = {
      text: "Test review",
      firstName: "John",
      lastName: "Doe",
      isAnonymous: false,
      status: "pending",
      customerRef: "abc123",
      verified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(review.status).toBeTypeOf("string");
    expect(["pending", "approved", "revoked"]).toContain(review.status);
    expect(typeof review.customerRef === "string" || review.customerRef === undefined).toBe(true);
  });
});
