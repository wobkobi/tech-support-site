import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as approve } from "@/app/api/reviews/[id]/approve";
import { POST as revoke } from "@/app/api/reviews/[id]/revoke";
import { prisma } from "@/lib/prisma";

// Mock next/cache for revalidatePath
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma");
const ADMIN_SECRET = "testsecret";

const mockReview = {
  id: "abc123",
  status: "pending",
};

beforeEach(() => {
  (prisma.review.findUnique as any) = vi.fn(async ({ where }: any) => {
    if (where.id === mockReview.id) return { ...mockReview };
    return null;
  });
  (prisma.review.update as any) = vi.fn(async ({ data }: any) => ({ ...mockReview, ...data }));
});

/**
 * Helper to create a mock request for testing.
 * @param id - Review ID.
 * @param admin - Whether to include admin secret.
 * @returns Mock request object.
 */
function makeRequest(id = "abc123", admin = true): any {
  return {
    headers: {
      /**
       * Gets header value by key.
       * @param k - Header key.
       * @returns Header value or null.
       */
      get: (k: string) => (k === "x-admin-secret" && admin ? ADMIN_SECRET : null),
    },
    params: { id },
  } as any;
}

describe("Admin moderation endpoints", () => {
  it("approves a review", async () => {
    const req = makeRequest("abc123", true);
    process.env.ADMIN_SECRET = ADMIN_SECRET;
    const res = await approve(req as any, { params: { id: "abc123" } });
    expect(res.status).toBe(200);
    expect(prisma.review.update).toHaveBeenCalledWith({
      where: { id: "abc123" },
      data: { status: "approved" },
    });
  });

  it("revokes a review", async () => {
    const req = makeRequest("abc123", true);
    process.env.ADMIN_SECRET = ADMIN_SECRET;
    const res = await revoke(req as any, { params: { id: "abc123" } });
    expect(res.status).toBe(200);
    expect(prisma.review.update).toHaveBeenCalledWith({
      where: { id: "abc123" },
      data: { status: "pending" },
    });
  });

  it("rejects unauthorized approve", async () => {
    const req = makeRequest("abc123", false);
    process.env.ADMIN_SECRET = ADMIN_SECRET;
    const res = await approve(req as any, { params: { id: "abc123" } });
    expect(res.status).toBe(403);
  });

  it("rejects unauthorized revoke", async () => {
    const req = makeRequest("abc123", false);
    process.env.ADMIN_SECRET = ADMIN_SECRET;
    const res = await revoke(req as any, { params: { id: "abc123" } });
    expect(res.status).toBe(403);
  });

  it("404 if review not found (approve)", async () => {
    const req = makeRequest("notfound", true);
    process.env.ADMIN_SECRET = ADMIN_SECRET;
    const res = await approve(req as any, { params: { id: "notfound" } });
    expect(res.status).toBe(404);
  });

  it("404 if review not found (revoke)", async () => {
    const req = makeRequest("notfound", true);
    process.env.ADMIN_SECRET = ADMIN_SECRET;
    const res = await revoke(req as any, { params: { id: "notfound" } });
    expect(res.status).toBe(404);
  });
});
