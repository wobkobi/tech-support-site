import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as createReview } from "@/app/api/reviews/route";
import { PATCH as editReview } from "@/app/api/reviews/[id]/route";
import { POST as approve } from "@/app/api/reviews/[id]/approve";
import { POST as revoke } from "@/app/api/reviews/[id]/revoke";
import { prisma } from "@/lib/prisma";

// Mock next/cache for revalidatePath
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock email service
vi.mock("@/lib/email", () => ({
  sendOwnerReviewNotification: vi.fn(),
}));

vi.mock("@/lib/prisma");
const ADMIN_SECRET = "testsecret";

let reviewId = "abc123";

beforeEach(() => {
  reviewId = "abc123";
  (prisma.review.create as any) = vi.fn(async ({ data }: any) => ({
    ...data,
    id: reviewId,
    status: "pending",
  }));
  (prisma.review.findUnique as any) = vi.fn(async ({ where }: any) => {
    if (where.id === reviewId)
      return { id: reviewId, status: "pending", customerRef: "token123", ...where };
    return null;
  });
  (prisma.review.update as any) = vi.fn(async ({ where, data }: any) => ({
    id: where.id,
    ...data,
  }));
});

/**
 * Helper to create a mock admin request.
 * @param id - Review ID.
 * @returns Mock admin request object.
 */
function makeAdminReq(id = reviewId): any {
  return {
    headers: {
      /**
       * Gets header value by key.
       * @param k - Header key.
       * @returns Header value or null.
       */
      get: (k: string) => (k === "x-admin-secret" ? ADMIN_SECRET : null),
    },
    params: { id },
  } as any;
}

/**
 * Helper to create a mock edit request.
 * @param id - Review ID.
 * @param customerRef - Customer reference token.
 * @param text - Review text.
 * @returns Mock edit request object.
 */
function makeEditReq(id = reviewId, customerRef = "token123", text = "Updated review text."): any {
  return {
    /**
     * Returns the request body as JSON.
     * @returns The request body.
     */
    json: async () => ({ text, customerRef }),
    params: { id },
  } as any;
}

describe("Review lifecycle integration", () => {
  it("submit → approve → edit → pending → approve", async () => {
    // Submit
    const req: any = {
      /**
       * Returns the request body as JSON.
       * @returns The request body.
       */
      json: async () => ({
        text: "This is a new review.",
        firstName: "John",
        lastName: "Doe",
        isAnonymous: false,
      }),
    };
    const res = await createReview(req as any);
    expect(res.status).toBe(201);
    // Approve
    process.env.ADMIN_SECRET = ADMIN_SECRET;
    const res2 = await approve(makeAdminReq() as any, { params: { id: reviewId } });
    expect(res2.status).toBe(200);
    expect(prisma.review.update).toHaveBeenCalledWith({
      where: { id: reviewId },
      data: { status: "approved" },
    });
    // Edit (should reset to pending)
    const res3 = await editReview(makeEditReq() as any, { params: { id: reviewId } });
    expect(res3.status).toBe(200);
    expect(prisma.review.update).toHaveBeenCalledWith({
      where: { id: reviewId },
      data: expect.objectContaining({ status: "pending" }),
    });
    // Approve again
    const res4 = await approve(makeAdminReq() as any, { params: { id: reviewId } });
    expect(res4.status).toBe(200);
  });

  it("submit → revoke → status is pending", async () => {
    // Submit
    const req: any = {
      /**
       * Returns the request body as JSON.
       * @returns The request body.
       */
      json: async () => ({
        text: "This is a new review.",
        firstName: "John",
        lastName: "Doe",
        isAnonymous: false,
      }),
    };
    const res = await createReview(req as any);
    expect(res.status).toBe(201);
    // Approve
    process.env.ADMIN_SECRET = ADMIN_SECRET;
    await approve(makeAdminReq() as any, { params: { id: reviewId } });
    // Revoke
    const res2 = await revoke(makeAdminReq() as any, { params: { id: reviewId } });
    expect(res2.status).toBe(200);
    expect(prisma.review.update).toHaveBeenCalledWith({
      where: { id: reviewId },
      data: { status: "pending" },
    });
  });
});
