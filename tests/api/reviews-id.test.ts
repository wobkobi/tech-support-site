import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  reviewFindUnique: vi.fn(),
  reviewUpdate: vi.fn(),
  sendOwnerReviewNotification: vi.fn(),
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    review: {
      findUnique: mocks.reviewFindUnique,
      update: mocks.reviewUpdate,
    },
  },
}));

vi.mock("@/features/reviews/lib/email", () => ({
  sendOwnerReviewNotification: mocks.sendOwnerReviewNotification,
}));

import { PATCH } from "../../src/app/api/reviews/[id]/route";

/**
 * Creates a fake NextRequest with the given JSON body.
 * @param body - The request body object.
 * @returns A minimal fake NextRequest.
 */
function makeRequest(body: object): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

/** Shared valid review payload. */
const VALID_BODY = {
  text: "Great service, very helpful and professional.",
  firstName: "Jane",
  lastName: "Doe",
  isAnonymous: false,
  customerRef: "token-abc",
};

/** Shared existing review with matching customerRef. */
const EXISTING_REVIEW = {
  id: "review-1",
  text: "Old text",
  firstName: "Jane",
  lastName: "Doe",
  isAnonymous: false,
  customerRef: "token-abc",
  verified: true,
};

describe("PATCH /api/reviews/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when text is too short", async () => {
    const req = makeRequest({ ...VALID_BODY, text: "Short" });
    const res = await PATCH(req, { params: { id: "review-1" } });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/10 characters/i);
  });

  it("returns 400 when text exceeds 600 characters", async () => {
    const req = makeRequest({ ...VALID_BODY, text: "x".repeat(601) });
    const res = await PATCH(req, { params: { id: "review-1" } });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/600 characters/i);
  });

  it("returns 404 when review does not exist", async () => {
    mocks.reviewFindUnique.mockResolvedValue(null);
    const req = makeRequest(VALID_BODY);
    const res = await PATCH(req, { params: { id: "missing-id" } });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it("returns 403 when customerRef does not match", async () => {
    mocks.reviewFindUnique.mockResolvedValue({ ...EXISTING_REVIEW, customerRef: "other-token" });
    const req = makeRequest(VALID_BODY);
    const res = await PATCH(req, { params: { id: "review-1" } });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/unauthorized/i);
  });

  it("returns 403 when review has no customerRef", async () => {
    mocks.reviewFindUnique.mockResolvedValue({ ...EXISTING_REVIEW, customerRef: null });
    const req = makeRequest(VALID_BODY);
    const res = await PATCH(req, { params: { id: "review-1" } });
    expect(res.status).toBe(403);
  });

  it("updates review, resets status to pending, and returns ok:true", async () => {
    mocks.reviewFindUnique.mockResolvedValue(EXISTING_REVIEW);
    mocks.reviewUpdate.mockResolvedValue({
      ...EXISTING_REVIEW,
      text: VALID_BODY.text,
      status: "pending",
    });
    const req = makeRequest(VALID_BODY);
    const res = await PATCH(req, { params: { id: "review-1" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mocks.reviewUpdate).toHaveBeenCalledWith({
      where: { id: "review-1" },
      data: expect.objectContaining({ status: "pending" }),
    });
  });

  it("clears name fields when isAnonymous is true", async () => {
    mocks.reviewFindUnique.mockResolvedValue(EXISTING_REVIEW);
    mocks.reviewUpdate.mockResolvedValue({ ...EXISTING_REVIEW, isAnonymous: true });
    const req = makeRequest({ ...VALID_BODY, isAnonymous: true });
    await PATCH(req, { params: { id: "review-1" } });
    expect(mocks.reviewUpdate).toHaveBeenCalledWith({
      where: { id: "review-1" },
      data: expect.objectContaining({ firstName: null, lastName: null, isAnonymous: true }),
    });
  });

  it("returns 500 when database throws", async () => {
    mocks.reviewFindUnique.mockRejectedValue(new Error("DB error"));
    const req = makeRequest(VALID_BODY);
    const res = await PATCH(req, { params: { id: "review-1" } });
    expect(res.status).toBe(500);
  });
});
