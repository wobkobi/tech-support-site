import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isValidAdminToken: vi.fn(),
  isAdminRequest: vi.fn(),
  reviewFindUnique: vi.fn(),
  reviewUpdate: vi.fn(),
  reviewDelete: vi.fn(),
  bookingFindUnique: vi.fn(),
  reviewRequestFindFirst: vi.fn(),
  contactUpsert: vi.fn(),
  revalidateReviewPaths: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isValidAdminToken: mocks.isValidAdminToken,
  isAdminRequest: mocks.isAdminRequest,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    review: {
      findUnique: mocks.reviewFindUnique,
      update: mocks.reviewUpdate,
      delete: mocks.reviewDelete,
    },
    booking: { findUnique: mocks.bookingFindUnique },
    reviewRequest: { findFirst: mocks.reviewRequestFindFirst },
    contact: { upsert: mocks.contactUpsert },
  },
}));

vi.mock("@/features/reviews/lib/revalidate", () => ({
  revalidateReviewPaths: mocks.revalidateReviewPaths,
}));

import { PATCH, DELETE } from "../../src/app/api/admin/reviews/[id]/route";

/**
 * Creates a fake NextRequest with the given JSON body and optional headers.
 * @param body - The request body object.
 * @param headers - Optional HTTP headers map.
 * @returns A minimal fake NextRequest.
 */
function makePatchRequest(body: object, headers: Record<string, string> = {}): NextRequest {
  return {
    json: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as NextRequest;
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

/** Default review stub with no source info — auto-link does nothing. */
const NO_SOURCE_REVIEW = {
  bookingId: null,
  customerRef: null,
  contactId: null,
  firstName: null,
  lastName: null,
};

describe("PATCH /api/admin/reviews/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reviewFindUnique.mockResolvedValue(NO_SOURCE_REVIEW);
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

  it("auto-links review to a contact when the review has a bookingId", async () => {
    mocks.isValidAdminToken.mockReturnValue(true);
    mocks.reviewFindUnique.mockResolvedValue({
      bookingId: "booking-abc",
      customerRef: null,
      contactId: null,
      firstName: "Alice",
      lastName: "Smith",
    });
    mocks.bookingFindUnique.mockResolvedValue({ email: "alice@example.com", name: "Alice Smith" });
    mocks.contactUpsert.mockResolvedValue({ id: "contact-1" });

    const req = makePatchRequest({ action: "approve", token: "valid" });
    await PATCH(req, PARAMS);

    expect(mocks.bookingFindUnique).toHaveBeenCalledWith({
      where: { id: "booking-abc" },
      select: { email: true, name: true },
    });
    expect(mocks.contactUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "alice@example.com" },
        create: expect.objectContaining({ name: "Alice Smith", email: "alice@example.com" }),
        update: {},
      }),
    );
    expect(mocks.reviewUpdate).toHaveBeenCalledWith({
      where: { id: "review-123" },
      data: { contactId: "contact-1" },
    });
  });

  it("auto-links review to a contact when the review has a customerRef", async () => {
    mocks.isValidAdminToken.mockReturnValue(true);
    mocks.reviewFindUnique.mockResolvedValue({
      bookingId: null,
      customerRef: "token-xyz",
      contactId: null,
      firstName: "Bob",
      lastName: null,
    });
    mocks.reviewRequestFindFirst.mockResolvedValue({
      email: "bob@example.com",
      name: "Bob Jones",
      phone: "021 000 0000",
    });
    mocks.contactUpsert.mockResolvedValue({ id: "contact-2" });

    const req = makePatchRequest({ action: "approve", token: "valid" });
    await PATCH(req, PARAMS);

    expect(mocks.reviewRequestFindFirst).toHaveBeenCalledWith({
      where: { reviewToken: "token-xyz" },
      select: { email: true, name: true, phone: true },
    });
    expect(mocks.contactUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "bob@example.com" },
        create: expect.objectContaining({
          name: "Bob Jones",
          email: "bob@example.com",
          phone: "021 000 0000",
        }),
        update: {},
      }),
    );
  });

  it("skips auto-link when review already has a contactId", async () => {
    mocks.isValidAdminToken.mockReturnValue(true);
    mocks.reviewFindUnique.mockResolvedValue({
      bookingId: "booking-abc",
      customerRef: null,
      contactId: "existing-contact",
      firstName: null,
      lastName: null,
    });

    const req = makePatchRequest({ action: "approve", token: "valid" });
    await PATCH(req, PARAMS);

    expect(mocks.contactUpsert).not.toHaveBeenCalled();
  });

  it("skips auto-link when no booking or review request is found", async () => {
    mocks.isValidAdminToken.mockReturnValue(true);
    mocks.reviewFindUnique.mockResolvedValue({
      bookingId: "booking-abc",
      customerRef: null,
      contactId: null,
      firstName: null,
      lastName: null,
    });
    mocks.bookingFindUnique.mockResolvedValue(null);

    const req = makePatchRequest({ action: "approve", token: "valid" });
    const res = await PATCH(req, PARAMS);

    expect(res.status).toBe(200);
    expect(mocks.contactUpsert).not.toHaveBeenCalled();
  });

  it("still approves review when auto-link contact upsert throws", async () => {
    mocks.isValidAdminToken.mockReturnValue(true);
    mocks.reviewFindUnique.mockResolvedValue({
      bookingId: null,
      customerRef: "token-xyz",
      contactId: null,
      firstName: null,
      lastName: null,
    });
    mocks.reviewRequestFindFirst.mockResolvedValue({
      email: "test@example.com",
      name: "Test User",
      phone: null,
    });
    mocks.contactUpsert.mockRejectedValue(new Error("DB upsert failed"));

    const req = makePatchRequest({ action: "approve", token: "valid" });
    const res = await PATCH(req, PARAMS);

    // Approval still succeeds despite auto-link failure
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

describe("PATCH /api/admin/reviews/[id] — contactId link flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.reviewUpdate.mockResolvedValue({});
  });

  it("returns 401 when X-Admin-Secret is missing", async () => {
    mocks.isAdminRequest.mockReturnValue(false);
    const req = makePatchRequest({ contactId: "c1" });
    const res = await PATCH(req, PARAMS);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("updates contactId to a string value", async () => {
    const req = makePatchRequest({ contactId: "c1" }, { "x-admin-secret": "secret" });
    const res = await PATCH(req, PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mocks.reviewUpdate).toHaveBeenCalledWith({
      where: { id: "review-123" },
      data: { contactId: "c1" },
    });
  });

  it("updates contactId to null (unlink)", async () => {
    const req = makePatchRequest({ contactId: null }, { "x-admin-secret": "secret" });
    const res = await PATCH(req, PARAMS);
    expect(res.status).toBe(200);
    expect(mocks.reviewUpdate).toHaveBeenCalledWith({
      where: { id: "review-123" },
      data: { contactId: null },
    });
  });

  it("returns 500 on DB error during contact-link", async () => {
    mocks.reviewUpdate.mockRejectedValue(new Error("DB error"));
    const req = makePatchRequest({ contactId: "c1" }, { "x-admin-secret": "secret" });
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
