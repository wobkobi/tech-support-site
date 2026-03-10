import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isValidAdminToken: vi.fn(),
  reviewUpdate: vi.fn(),
  reviewDelete: vi.fn(),
  revalidateReviewPaths: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isValidAdminToken: mocks.isValidAdminToken,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    review: {
      update: mocks.reviewUpdate,
      delete: mocks.reviewDelete,
    },
  },
}));

vi.mock("@/features/reviews/lib/revalidate", () => ({
  revalidateReviewPaths: mocks.revalidateReviewPaths,
}));

import { PATCH, DELETE } from "../../src/app/api/admin/reviews/[id]/route";

/**
 * Creates a fake NextRequest with the given JSON body.
 * @param body - The request body object.
 * @returns A minimal fake NextRequest.
 */
function makePatchRequest(body: object): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

/**
 * Creates a fake NextRequest with searchParams for DELETE token.
 * @param token - The admin token query param value.
 * @returns A minimal fake NextRequest.
 */
function makeDeleteRequest(token: string): NextRequest {
  return {
    json: async () => ({}),
    nextUrl: { searchParams: new URLSearchParams(`token=${token}`) },
  } as unknown as NextRequest;
}

const PARAMS = { params: Promise.resolve({ id: "review-123" }) };

describe("PATCH /api/admin/reviews/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reviewUpdate.mockResolvedValue({});
    mocks.revalidateReviewPaths.mockReturnValue(undefined);
  });

  it("returns 401 when token is invalid", async () => {
    mocks.isValidAdminToken.mockReturnValue(false);
    const req = makePatchRequest({ action: "approve", token: "bad" });
    const res = await PATCH(req, PARAMS);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 400 for an invalid action", async () => {
    mocks.isValidAdminToken.mockReturnValue(true);
    const req = makePatchRequest({ action: "delete", token: "valid" });
    const res = await PATCH(req, PARAMS);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid action");
  });

  it("approves a review and calls revalidateReviewPaths", async () => {
    mocks.isValidAdminToken.mockReturnValue(true);
    const req = makePatchRequest({ action: "approve", token: "valid" });
    const res = await PATCH(req, PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mocks.reviewUpdate).toHaveBeenCalledWith({
      where: { id: "review-123" },
      data: { status: "approved" },
    });
    expect(mocks.revalidateReviewPaths).toHaveBeenCalled();
  });

  it("revokes a review and sets status to pending", async () => {
    mocks.isValidAdminToken.mockReturnValue(true);
    const req = makePatchRequest({ action: "revoke", token: "valid" });
    await PATCH(req, PARAMS);
    expect(mocks.reviewUpdate).toHaveBeenCalledWith({
      where: { id: "review-123" },
      data: { status: "pending" },
    });
  });

  it("returns 500 when prisma.review.update throws", async () => {
    mocks.isValidAdminToken.mockReturnValue(true);
    mocks.reviewUpdate.mockRejectedValue(new Error("DB error"));
    const req = makePatchRequest({ action: "approve", token: "valid" });
    const res = await PATCH(req, PARAMS);
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/admin/reviews/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reviewDelete.mockResolvedValue({});
    mocks.revalidateReviewPaths.mockReturnValue(undefined);
  });

  it("returns 401 when token query param is invalid", async () => {
    mocks.isValidAdminToken.mockReturnValue(false);
    const req = makeDeleteRequest("bad-token");
    const res = await DELETE(req, PARAMS);
    expect(res.status).toBe(401);
  });

  it("deletes the review and calls revalidateReviewPaths", async () => {
    mocks.isValidAdminToken.mockReturnValue(true);
    const req = makeDeleteRequest("valid-token");
    const res = await DELETE(req, PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mocks.reviewDelete).toHaveBeenCalledWith({ where: { id: "review-123" } });
    expect(mocks.revalidateReviewPaths).toHaveBeenCalled();
  });

  it("returns 500 when prisma.review.delete throws", async () => {
    mocks.isValidAdminToken.mockReturnValue(true);
    mocks.reviewDelete.mockRejectedValue(new Error("DB error"));
    const req = makeDeleteRequest("valid-token");
    const res = await DELETE(req, PARAMS);
    expect(res.status).toBe(500);
  });
});
