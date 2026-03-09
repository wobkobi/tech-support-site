import { describe, it, expect } from "vitest";
import { createReviewsHandlers } from "../../src/app/api/reviews/route";
import { createMockPrisma } from "../utils/mockPrisma";

// Minimal test for GET handler with mockPrisma

describe("reviews API GET handler", () => {
  it("returns reviews from mockPrisma", async () => {
    const prisma = createMockPrisma();
    prisma.review.findMany.mockResolvedValue([
      {
        id: 1,
        text: "Test",
        firstName: "A",
        lastName: "B",
        isAnonymous: false,
        verified: true,
        createdAt: new Date(),
      },
    ]);
    const { GET } = createReviewsHandlers(prisma);
    const response = await GET();
    const data = await response.json();
    expect(data.reviews).toHaveLength(1);
    expect(data.reviews[0].text).toBe("Test");
  });
});
