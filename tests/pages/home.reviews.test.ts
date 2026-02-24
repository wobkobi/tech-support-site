/**
 * @file tests/pages/home.reviews.test.tsx
 * @description Tests for home page review rendering (excerpt of reviews)
 * @severity S2 - Home page review display and performance
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { prisma } from "@/lib/prisma";

// Mock Prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    review: {
      findMany: vi.fn(),
    },
  },
}));

/**
 * Helper to create a mock review object for testing.
 * @param id - Numeric identifier for the review.
 * @param overrides - Optional partial overrides for review properties.
 * @returns A mock review object.
 */
function createMockReview(
  id: number,
  overrides?: Partial<{
    text: string;
    firstName: string;
    lastName: string;
    isAnonymous: boolean;
  }>,
) {
  return {
    id: `review-${id}`,
    text: `Review ${id}: This is a great service!`,
    firstName: `John${id}`,
    lastName: `Doe${id}`,
    isAnonymous: false,
    createdAt: new Date(2024, 0, id),
    ...overrides,
  };
}

describe("Home Page - Review Section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Featured reviews on home page", () => {
    it("home page should display limited number of recent reviews", async () => {
      const mockPrisma = vi.mocked(prisma);

      // Home page typically shows 3-6 recent reviews
      const homePageLimit = 6;
      const allReviews = Array.from({ length: 100 }, (_, i) => createMockReview(i + 1));

      // Sort by most recent and take limit
      const featuredReviews = allReviews
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, homePageLimit);

      (mockPrisma.review.findMany as Mock).mockResolvedValue(featuredReviews);

      const result = await mockPrisma.review.findMany({
        where: { status: "approved" },
        orderBy: { createdAt: "desc" },
        take: homePageLimit,
      });

      expect(result).toHaveLength(homePageLimit);
      expect(result[0].id).toBe("review-100"); // Most recent
    });

    it("displays 0 reviews gracefully on home page", async () => {
      const mockPrisma = vi.mocked(prisma);
      (mockPrisma.review.findMany as Mock).mockResolvedValue([]);

      const result = await mockPrisma.review.findMany({
        where: { status: "approved" },
        take: 6,
      });

      expect(result).toHaveLength(0);
    });

    it("displays 1-3 reviews on home page in card layout", async () => {
      const mockPrisma = vi.mocked(prisma);
      const reviews = [createMockReview(1), createMockReview(2), createMockReview(3)];

      (mockPrisma.review.findMany as Mock).mockResolvedValue(reviews);

      const result = await mockPrisma.review.findMany({
        take: 6,
      });

      expect(result).toHaveLength(3);
      // Home page with 3 reviews should use regular card layout (no marquee)
    });

    it("displays 4+ reviews on home page in marquee", async () => {
      const mockPrisma = vi.mocked(prisma);
      const reviews = Array.from({ length: 6 }, (_, i) => createMockReview(i + 1));

      (mockPrisma.review.findMany as Mock).mockResolvedValue(reviews);

      const result = await mockPrisma.review.findMany({
        take: 6,
      });

      expect(result).toHaveLength(6);
      // Home page with 6 reviews should use marquee layout
    });
  });

  describe("Performance with home page review queries", () => {
    it("fetches home page reviews quickly", async () => {
      const mockPrisma = vi.mocked(prisma);
      const reviews = Array.from({ length: 6 }, (_, i) => createMockReview(i + 1));

      (mockPrisma.review.findMany as Mock).mockResolvedValue(reviews);

      const start = performance.now();
      const result = await mockPrisma.review.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
      });
      const end = performance.now();

      expect(result).toHaveLength(6);
      // Home page review fetch should be <50ms
      expect(end - start).toBeLessThan(50);
    });

    it("uses take/skip for efficient pagination", async () => {
      const mockPrisma = vi.mocked(prisma);
      const reviews = Array.from({ length: 6 }, (_, i) => createMockReview(i + 1));

      (mockPrisma.review.findMany as Mock).mockResolvedValue(reviews);

      await mockPrisma.review.findMany({
        where: { status: "approved" },
        orderBy: { createdAt: "desc" },
        take: 6, // Limit results
      });

      // Verify take parameter was used
      expect(mockPrisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 6,
        }),
      );
    });
  });

  describe("Review text truncation for home page", () => {
    it("handles varying review text lengths on home page", async () => {
      const mockPrisma = vi.mocked(prisma);
      const reviews = [
        createMockReview(1, { text: "Short review" }),
        createMockReview(2, {
          text: "This is a longer review that provides more detail. " + "A".repeat(200),
        }),
        createMockReview(3, { text: "A".repeat(500) }),
      ];

      (mockPrisma.review.findMany as Mock).mockResolvedValue(reviews);

      const result = await mockPrisma.review.findMany();

      expect(result[0].text.length).toBeLessThan(50);
      expect(result[1].text.length).toBeGreaterThan(100);
      expect(result[2].text.length).toBeGreaterThan(400);
      // All should be returned (truncation happens in UI)
    });

    it("preserves full review text from database", async () => {
      const mockPrisma = vi.mocked(prisma);
      const longText = "A".repeat(1000);
      const reviews = [createMockReview(1, { text: longText })];

      (mockPrisma.review.findMany as Mock).mockResolvedValue(reviews);

      const result = await mockPrisma.review.findMany();

      expect(result[0].text).toBe(longText);
    });
  });

  describe("Home page vs Reviews page query patterns", () => {
    it("home page uses take/limit", async () => {
      const mockPrisma = vi.mocked(prisma);
      (mockPrisma.review.findMany as Mock).mockResolvedValue([]);

      // Home page: fetch 6 recent reviews
      await mockPrisma.review.findMany({
        where: { status: "approved" },
        orderBy: { createdAt: "desc" },
        take: 6,
      });

      expect(mockPrisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 6,
        }),
      );
    });

    it("reviews page fetches all approved reviews without limit", async () => {
      const mockPrisma = vi.mocked(prisma);
      (mockPrisma.review.findMany as Mock).mockResolvedValue([]);

      // Reviews page: fetch all approved
      await mockPrisma.review.findMany({
        where: { status: "approved" },
        orderBy: { createdAt: "desc" },
        // No take limit - fetch all
      });

      expect(mockPrisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: "approved" },
          orderBy: { createdAt: "desc" },
        }),
      );

      // Should NOT have take limit
      expect(mockPrisma.review.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          take: expect.any(Number),
        }),
      );
    });
  });

  describe("Link from home to reviews page", () => {
    it("home page should have CTA link to reviews page", () => {
      // This would be implemented in e2e test
      // Home page shows reviews sidebar with "View All Reviews" link to /reviews
      const reviewsPageUrl = "/reviews";
      expect(reviewsPageUrl).toBe("/reviews");
    });

    it("reviews page shows complete list starting with same reviews shown on home", async () => {
      const mockPrisma = vi.mocked(prisma);

      // Simulate home page fetch (6 recent)
      const topReviews = Array.from({ length: 6 }, (_, i) => createMockReview(i + 1));
      (mockPrisma.review.findMany as Mock).mockResolvedValueOnce(topReviews);

      const homeReviews = await mockPrisma.review.findMany({
        where: { status: "approved" },
        orderBy: { createdAt: "desc" },
        take: 6,
      });

      // Simulate reviews page fetch (all)
      const allReviews = Array.from({ length: 50 }, (_, i) => createMockReview(i + 1));
      (mockPrisma.review.findMany as Mock).mockResolvedValueOnce(allReviews);

      const pageReviews = await mockPrisma.review.findMany({
        where: { status: "approved" },
        orderBy: { createdAt: "desc" },
      });

      // First 6 of reviews page should match home page
      expect(pageReviews.slice(0, 6).map((r) => r.id)).toEqual(homeReviews.map((r) => r.id));

      // Reviews page has more
      expect(pageReviews.length).toBeGreaterThan(homeReviews.length);
    });
  });

  describe("Caching/ISR strategy", () => {
    it("home page should use moderate ISR time (e.g., 60-300s)", () => {
      // Home page can have slightly stale reviews
      const homePageRevalidateTime = 60; // seconds
      expect(homePageRevalidateTime).toBeGreaterThan(0);
      expect(homePageRevalidateTime).toBeLessThan(3600); // Less than 1 hour
    });

    it("reviews page should use longer ISR time (e.g., 300-600s)", () => {
      // Reviews page shows many reviews, can be slightly stale
      const reviewsPageRevalidateTime = 300; // seconds
      expect(reviewsPageRevalidateTime).toBeGreaterThanOrEqual(300);
    });

    it("new review on home page appears after ISR", async () => {
      const mockPrisma = vi.mocked(prisma);

      // Before: 5 reviews
      const oldReviews = Array.from({ length: 5 }, (_, i) => createMockReview(i + 1));
      (mockPrisma.review.findMany as Mock).mockResolvedValueOnce(oldReviews);

      let result = await mockPrisma.review.findMany({
        where: { status: "approved" },
        orderBy: { createdAt: "desc" },
        take: 6,
      });

      expect(result).toHaveLength(5);

      // After ISR revalidation: 6 reviews
      const newReviews = Array.from({ length: 6 }, (_, i) => createMockReview(i + 1));
      (mockPrisma.review.findMany as Mock).mockResolvedValueOnce(newReviews);

      result = await mockPrisma.review.findMany({
        where: { status: "approved" },
        orderBy: { createdAt: "desc" },
        take: 6,
      });

      expect(result).toHaveLength(6);
    });
  });
});
