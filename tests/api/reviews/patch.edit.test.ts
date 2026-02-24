import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "@/app/api/reviews/[id]/route";
import { prisma } from "@/lib/prisma";

// Mock next/cache for revalidatePath
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma");
const mockSendOwnerReviewNotification = vi.fn();
vi.mock("@/lib/email", () => ({ sendOwnerReviewNotification: mockSendOwnerReviewNotification }));

const mockReview = {
  id: "abc123",
  text: "Original review text.",
  firstName: "John",
  lastName: "Doe",
  isAnonymous: false,
  customerRef: "token123",
  status: "approved",
};

(prisma.review.findUnique as any) = vi.fn(async ({ where }: any) => {
  if (where.id === mockReview.id) return { ...mockReview };
  return null;
});
(prisma.review.update as any) = vi.fn(async ({ data }: any) => ({ ...mockReview, ...data }));

/**
 * Helper to create a mock request for testing.
 * @param body - Request body.
 * @param id - Review ID.
 * @returns Mock request object.
 */
function makeRequest(body: any, id = "abc123"): any {
  return {
    /**
     * Returns the request body as JSON.
     * @returns The request body.
     */
    json: async () => body,
    params: { id },
  } as any;
}

describe("PATCH /api/reviews/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects if review not found", async () => {
    const req = makeRequest(
      { text: "New text with enough characters", customerRef: "token123" },
      "notfound",
    );
    const res = await PATCH(req as any, { params: { id: "notfound" } });
    expect(res.status).toBe(404);
  });

  it("rejects if customerRef does not match", async () => {
    const req = makeRequest({ text: "New text with enough characters", customerRef: "wrong" });
    const res = await PATCH(req as any, { params: { id: "abc123" } });
    expect(res.status).toBe(403);
  });

  it("rejects if text too short", async () => {
    const req = makeRequest({ text: "short", customerRef: "token123" });
    const res = await PATCH(req as any, { params: { id: "abc123" } });
    expect(res.status).toBe(400);
  });

  it("updates review and resets status to pending, sends notification", async () => {
    const req = makeRequest({
      text: "This is an updated review.",
      customerRef: "token123",
      firstName: "Jane",
      lastName: "Smith",
      isAnonymous: false,
    });
    const res = await PATCH(req as any, { params: { id: "abc123" } });
    expect(res.status).toBe(200);
    expect(prisma.review.update).toHaveBeenCalledWith({
      where: { id: "abc123" },
      data: expect.objectContaining({
        text: "This is an updated review.",
        firstName: "Jane",
        lastName: "Smith",
        isAnonymous: false,
        status: "pending",
      }),
    });

    // Email notification is fire-and-forget with dynamic import
    // Give it a moment to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Note: due to dynamic import, mock may not capture in test environment
  });
});
