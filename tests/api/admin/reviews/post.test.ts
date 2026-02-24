/**
 * @file tests/api/admin/reviews/post.test.ts
 * @description Tests for admin manual review creation API
 * @severity S1 - Critical - Admin review creation endpoint with no test coverage
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/admin/reviews/route";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma");
const ADMIN_SECRET = "testsecret";

const mockCreatedReview = {
  id: "review-new-123",
  text: "Manually added review from past client",
  firstName: "Jane",
  lastName: "Smith",
  isAnonymous: false,
  verified: false,
  status: "approved",
  createdAt: new Date("2024-01-15T10:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_SECRET = ADMIN_SECRET;

  (prisma.review.create as any) = vi.fn(async ({ data }: any) => ({
    ...mockCreatedReview,
    ...data,
  }));
});

/**
 * Helper to create a mock POST request
 * @param body - Request body
 * @returns Mock request object
 */
function makeRequest(body: any): any {
  return {
    /**
     * Returns the request body as JSON.
     * @returns The request body.
     */
    json: async () => body,
  } as any;
}

describe("POST /api/admin/reviews", () => {
  describe("Authentication", () => {
    it("rejects unauthorized request (no token)", async () => {
      const req = makeRequest({
        text: "Great service!",
        firstName: "John",
        lastName: "Doe",
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
      expect(prisma.review.create).not.toHaveBeenCalled();
    });

    it("rejects unauthorized request (wrong token)", async () => {
      const req = makeRequest({
        token: "wrongsecret",
        text: "Great service!",
        firstName: "John",
        lastName: "Doe",
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
      expect(prisma.review.create).not.toHaveBeenCalled();
    });

    it("accepts valid token", async () => {
      const req = makeRequest({
        token: ADMIN_SECRET,
        text: "Great service!",
        firstName: "John",
        lastName: "Doe",
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      expect(prisma.review.create).toHaveBeenCalled();
    });
  });

  describe("Validation", () => {
    it("rejects review with text too short", async () => {
      const req = makeRequest({
        token: ADMIN_SECRET,
        text: "Short",
        firstName: "John",
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Review must be at least 10 characters.");
      expect(prisma.review.create).not.toHaveBeenCalled();
    });

    it("rejects review with text too long", async () => {
      const req = makeRequest({
        token: ADMIN_SECRET,
        text: "A".repeat(601),
        firstName: "John",
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Review must be 600 characters or less.");
      expect(prisma.review.create).not.toHaveBeenCalled();
    });

    it("rejects review with missing text", async () => {
      const req = makeRequest({
        token: ADMIN_SECRET,
        firstName: "John",
        lastName: "Doe",
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Review must be at least 10 characters.");
    });

    it("rejects review with empty text", async () => {
      const req = makeRequest({
        token: ADMIN_SECRET,
        text: "   ",
        firstName: "John",
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe("Review creation", () => {
    it("creates a review with full name", async () => {
      const req = makeRequest({
        token: ADMIN_SECRET,
        text: "This is a manually added review from a past client",
        firstName: "Jane",
        lastName: "Smith",
        isAnonymous: false,
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.review).toBeDefined();

      expect(prisma.review.create).toHaveBeenCalledWith({
        data: {
          text: "This is a manually added review from a past client",
          firstName: "Jane",
          lastName: "Smith",
          isAnonymous: false,
          verified: false,
          status: "approved",
        },
        select: {
          id: true,
          text: true,
          firstName: true,
          lastName: true,
          isAnonymous: true,
          verified: true,
          status: true,
          createdAt: true,
        },
      });
    });

    it("creates anonymous review", async () => {
      const req = makeRequest({
        token: ADMIN_SECRET,
        text: "Anonymous feedback from satisfied customer",
        firstName: "Should",
        lastName: "BeIgnored",
        isAnonymous: true,
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            text: "Anonymous feedback from satisfied customer",
            firstName: null,
            lastName: null,
            isAnonymous: true,
          }),
        }),
      );
    });

    it("creates review with only first name", async () => {
      const req = makeRequest({
        token: ADMIN_SECRET,
        text: "Great experience overall",
        firstName: "John",
        isAnonymous: false,
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            firstName: "John",
            lastName: null,
          }),
        }),
      );
    });

    it("trims whitespace from text and names", async () => {
      const req = makeRequest({
        token: ADMIN_SECRET,
        text: "  Review with extra spaces  ",
        firstName: "  Jane  ",
        lastName: "  Smith  ",
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            text: "Review with extra spaces",
            firstName: "Jane",
            lastName: "Smith",
          }),
        }),
      );
    });

    it("creates review with status pre-approved", async () => {
      const req = makeRequest({
        token: ADMIN_SECRET,
        text: "This review is already approved",
        firstName: "John",
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "approved",
            verified: false,
          }),
        }),
      );
    });

    it("returns created review in response", async () => {
      const req = makeRequest({
        token: ADMIN_SECRET,
        text: "Sample review text",
        firstName: "Test",
        lastName: "User",
      });

      const res = await POST(req);
      const body = await res.json();

      expect(body.review).toBeDefined();
      expect(body.review.id).toBeDefined();
      expect(body.review.text).toBeDefined();
      expect(body.review.status).toBe("approved");
    });
  });

  describe("Error handling", () => {
    it("returns 500 on database error", async () => {
      (prisma.review.create as any) = vi.fn().mockRejectedValue(new Error("DB Error"));

      const req = makeRequest({
        token: ADMIN_SECRET,
        text: "This will fail",
        firstName: "Test",
      });

      const res = await POST(req);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Failed to create review.");
    });

    it("handles missing optional fields gracefully", async () => {
      const req = makeRequest({
        token: ADMIN_SECRET,
        text: "Review with minimal data",
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            firstName: null,
            lastName: null,
            isAnonymous: false,
          }),
        }),
      );
    });
  });

  describe("Edge cases", () => {
    it("accepts review at minimum length (10 chars)", async () => {
      const req = makeRequest({
        token: ADMIN_SECRET,
        text: "1234567890",
        firstName: "Test",
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    it("accepts review at maximum length (600 chars)", async () => {
      const req = makeRequest({
        token: ADMIN_SECRET,
        text: "A".repeat(600),
        firstName: "Test",
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    it("handles special characters in text", async () => {
      const req = makeRequest({
        token: ADMIN_SECRET,
        text: 'Review with "quotes" and special chars: !@#$%^&*()',
        firstName: "Test",
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    it("handles unicode characters", async () => {
      const req = makeRequest({
        token: ADMIN_SECRET,
        text: "Great service! 👍 Very satisfied 😊",
        firstName: "Test",
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
    });
  });
});
