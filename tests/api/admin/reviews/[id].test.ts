/**
 * @file tests/api/admin/reviews/[id].test.ts
 * @description Tests for admin review moderation API (PATCH approve/revoke, DELETE)
 * @severity S1 - Critical - Admin moderation endpoints with no test coverage
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH, DELETE } from "@/app/api/admin/reviews/[id]/route";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

// Mock next/cache for revalidatePath
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma");
const ADMIN_SECRET = "testsecret";

const mockReview = {
  id: "review-123",
  text: "Great service!",
  status: "pending",
  firstName: "John",
  lastName: "Doe",
  isAnonymous: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_SECRET = ADMIN_SECRET;

  (prisma.review.findUnique as any) = vi.fn(async ({ where }: any) => {
    if (where.id === mockReview.id) return { ...mockReview };
    return null;
  });

  (prisma.review.update as any) = vi.fn(async ({ data }: any) => ({
    ...mockReview,
    ...data,
  }));

  (prisma.review.delete as any) = vi.fn(async ({ where }: any) => {
    if (where.id === mockReview.id) return { ...mockReview };
    throw new Error("Review not found");
  });
});

/**
 * Helper to create a mock PATCH request
 * @param action - "approve" or "revoke"
 * @param token - Admin token
 * @returns Mock request object
 */
function makePatchRequest(action: string, token: string | null): any {
  return {
    json: async () => ({ action, token }),
  } as any;
}

/**
 * Helper to create a mock DELETE request
 * @param token - Admin token (query param)
 * @returns Mock request object
 */
function makeDeleteRequest(token: string | null): any {
  return {
    nextUrl: {
      searchParams: {
        get: (key: string) => (key === "token" ? token : null),
      },
    },
  } as any;
}

describe("PATCH /api/admin/reviews/[id]", () => {
  describe("Authentication", () => {
    it("rejects unauthorized request (no token)", async () => {
      const req = makePatchRequest("approve", null);
      const res = await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
      expect(prisma.review.update).not.toHaveBeenCalled();
    });

    it("rejects unauthorized request (wrong token)", async () => {
      const req = makePatchRequest("approve", "wrongsecret");
      const res = await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
      expect(prisma.review.update).not.toHaveBeenCalled();
    });

    it("accepts valid token", async () => {
      const req = makePatchRequest("approve", ADMIN_SECRET);
      const res = await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });
      expect(res.status).toBe(200);
      expect(prisma.review.update).toHaveBeenCalled();
    });
  });

  describe("Validation", () => {
    it("rejects invalid action", async () => {
      const req = makePatchRequest("invalid", ADMIN_SECRET);
      const res = await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid action");
      expect(prisma.review.update).not.toHaveBeenCalled();
    });

    it("rejects missing action", async () => {
      const req = {
        json: async () => ({ token: ADMIN_SECRET }),
      } as any;
      const res = await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });
      expect(res.status).toBe(400);
    });
  });

  describe("Approve action", () => {
    it("approves a review", async () => {
      const req = makePatchRequest("approve", ADMIN_SECRET);
      const res = await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      expect(prisma.review.update).toHaveBeenCalledWith({
        where: { id: "review-123" },
        data: { status: "approved" },
      });
    });

    it("triggers ISR revalidation on approve", async () => {
      const req = makePatchRequest("approve", ADMIN_SECRET);
      await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });

      expect(revalidatePath).toHaveBeenCalledWith("/reviews");
      expect(revalidatePath).toHaveBeenCalledWith("/review");
      expect(revalidatePath).toHaveBeenCalledWith("/");
      expect(revalidatePath).toHaveBeenCalledTimes(3);
    });
  });

  describe("Revoke action", () => {
    it("revokes a review", async () => {
      const req = makePatchRequest("revoke", ADMIN_SECRET);
      const res = await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      expect(prisma.review.update).toHaveBeenCalledWith({
        where: { id: "review-123" },
        data: { status: "pending" },
      });
    });

    it("triggers ISR revalidation on revoke", async () => {
      const req = makePatchRequest("revoke", ADMIN_SECRET);
      await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });

      expect(revalidatePath).toHaveBeenCalledWith("/reviews");
      expect(revalidatePath).toHaveBeenCalledWith("/review");
      expect(revalidatePath).toHaveBeenCalledWith("/");
      expect(revalidatePath).toHaveBeenCalledTimes(3);
    });
  });

  describe("Error handling", () => {
    it("returns 500 on database error", async () => {
      (prisma.review.update as any) = vi.fn().mockRejectedValue(new Error("DB Error"));

      const req = makePatchRequest("approve", ADMIN_SECRET);
      const res = await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Failed to update review");
    });
  });
});

describe("DELETE /api/admin/reviews/[id]", () => {
  describe("Authentication", () => {
    it("rejects unauthorized request (no token)", async () => {
      const req = makeDeleteRequest(null);
      const res = await DELETE(req, { params: Promise.resolve({ id: "review-123" }) });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
      expect(prisma.review.delete).not.toHaveBeenCalled();
    });

    it("rejects unauthorized request (wrong token)", async () => {
      const req = makeDeleteRequest("wrongsecret");
      const res = await DELETE(req, { params: Promise.resolve({ id: "review-123" }) });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
      expect(prisma.review.delete).not.toHaveBeenCalled();
    });

    it("accepts valid token", async () => {
      const req = makeDeleteRequest(ADMIN_SECRET);
      const res = await DELETE(req, { params: Promise.resolve({ id: "review-123" }) });
      expect(res.status).toBe(200);
      expect(prisma.review.delete).toHaveBeenCalled();
    });
  });

  describe("Delete operation", () => {
    it("deletes a review", async () => {
      const req = makeDeleteRequest(ADMIN_SECRET);
      const res = await DELETE(req, { params: Promise.resolve({ id: "review-123" }) });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      expect(prisma.review.delete).toHaveBeenCalledWith({
        where: { id: "review-123" },
      });
    });

    it("triggers ISR revalidation on delete", async () => {
      const req = makeDeleteRequest(ADMIN_SECRET);
      await DELETE(req, { params: Promise.resolve({ id: "review-123" }) });

      expect(revalidatePath).toHaveBeenCalledWith("/reviews");
      expect(revalidatePath).toHaveBeenCalledWith("/review");
      expect(revalidatePath).toHaveBeenCalledWith("/");
      expect(revalidatePath).toHaveBeenCalledTimes(3);
    });
  });

  describe("Error handling", () => {
    it("returns 500 on database error", async () => {
      (prisma.review.delete as any) = vi.fn().mockRejectedValue(new Error("DB Error"));

      const req = makeDeleteRequest(ADMIN_SECRET);
      const res = await DELETE(req, { params: Promise.resolve({ id: "review-123" }) });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Failed to delete review");
    });

    it("returns 500 when review not found", async () => {
      (prisma.review.delete as any) = vi.fn().mockRejectedValue(new Error("Record not found"));

      const req = makeDeleteRequest(ADMIN_SECRET);
      const res = await DELETE(req, { params: Promise.resolve({ id: "notfound" }) });

      expect(res.status).toBe(500);
    });
  });
});
