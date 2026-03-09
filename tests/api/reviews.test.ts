import { describe, it, expect } from "vitest";
import { createReviewsHandlers } from "../../src/app/api/reviews/route";
import { createMockPrisma } from "../utils/mockPrisma";

// Test for reviews API GET handler with mockPrisma

describe("API: /api/reviews", () => {
  it("should return approved reviews", async () => {
    const mockReviews = [
      {
        id: 1,
        text: "Great service!",
        firstName: "John",
        lastName: "Doe",
        isAnonymous: false,
        verified: true,
        createdAt: new Date(),
      },
    ];
    const prisma = createMockPrisma();
    prisma.review.findMany.mockResolvedValue(mockReviews);
    const handlers = createReviewsHandlers(prisma as never);
    const response = await handlers.GET();
    const json = await response.json();
    expect(json.reviews).toEqual(mockReviews);
  });

  it("should handle DB errors gracefully", async () => {
    const prisma = createMockPrisma();
    prisma.review.findMany.mockRejectedValue(new Error("DB error"));
    const handlers = createReviewsHandlers(prisma as never);
    const response = await handlers.GET();
    const json = await response.json();
    expect(json.reviews).toBeUndefined();
    expect(json.error).toBeDefined();
  });
});
