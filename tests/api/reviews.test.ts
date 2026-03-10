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
    // Dates are serialized to ISO strings when going through JSON — compare serialized form
    expect(json.reviews).toEqual(JSON.parse(JSON.stringify(mockReviews)));
  });

  it("should return 500 with empty reviews array on DB error", async () => {
    const prisma = createMockPrisma();
    prisma.review.findMany.mockRejectedValue(new Error("DB error"));
    const handlers = createReviewsHandlers(prisma as never);
    const response = await handlers.GET();
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.reviews).toEqual([]);
  });
});
