import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  reviewCreate: vi.fn(),
  bookingFindFirst: vi.fn(),
  bookingUpdate: vi.fn(),
  reviewRequestFindFirst: vi.fn(),
  reviewRequestUpdate: vi.fn(),
  contactFindFirst: vi.fn(),
  contactFindUnique: vi.fn(),
  revalidatePath: vi.fn(),
  sendOwnerReviewNotification: vi.fn(),
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    review: { create: mocks.reviewCreate },
    booking: {
      findFirst: mocks.bookingFindFirst,
      update: mocks.bookingUpdate,
    },
    reviewRequest: {
      findFirst: mocks.reviewRequestFindFirst,
      update: mocks.reviewRequestUpdate,
    },
    contact: { findFirst: mocks.contactFindFirst, findUnique: mocks.contactFindUnique },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/features/reviews/lib/email", () => ({
  sendOwnerReviewNotification: mocks.sendOwnerReviewNotification,
}));

import { POST } from "../../src/app/api/reviews/route";

/**
 * Creates a fake NextRequest with the given JSON body.
 * @param body - The request body object.
 * @returns A minimal fake NextRequest.
 */
function makeRequest(body: object): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe("POST /api/reviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reviewCreate.mockResolvedValue({
      id: "review-1",
      text: "Great service indeed!",
      firstName: "Alice",
      lastName: null,
      isAnonymous: false,
      verified: false,
      status: "pending",
    });
    mocks.bookingFindFirst.mockResolvedValue(null);
    mocks.reviewRequestFindFirst.mockResolvedValue(null);
    mocks.contactFindFirst.mockResolvedValue(null);
    mocks.contactFindUnique.mockResolvedValue(null);
    mocks.sendOwnerReviewNotification.mockResolvedValue(undefined);
  });

  it("returns 201 with ok:true for a valid non-anonymous review", async () => {
    const req = makeRequest({
      text: "Great service indeed!",
      firstName: "Alice",
      isAnonymous: false,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.id).toBe("review-1");
  });

  it("returns 201 for an anonymous review without firstName", async () => {
    mocks.reviewCreate.mockResolvedValue({
      id: "review-2",
      text: "Anonymous review here!",
      firstName: null,
      isAnonymous: true,
      verified: false,
      status: "pending",
    });
    const req = makeRequest({
      text: "Anonymous review here!",
      isAnonymous: true,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it("returns 400 when text is too short", async () => {
    const req = makeRequest({ text: "Too short", firstName: "Alice" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/at least 10 characters/);
  });

  it("returns 400 when text exceeds the hard limit of 1100 characters", async () => {
    const req = makeRequest({ text: "a".repeat(1101), firstName: "Alice" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/1000 characters/);
  });

  it("returns 400 when non-anonymous and firstName is missing", async () => {
    const req = makeRequest({
      text: "Great service indeed!",
      isAnonymous: false,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/First name required/);
  });

  it("marks review as verified when bookingId and reviewToken match", async () => {
    mocks.bookingFindFirst.mockResolvedValue({
      id: "booking-1",
      reviewToken: "valid-token",
    });
    mocks.bookingUpdate.mockResolvedValue({});
    mocks.reviewCreate.mockResolvedValue({
      id: "review-3",
      text: "Verified review text here!",
      verified: true,
      status: "pending",
    });
    const req = makeRequest({
      text: "Verified review text here!",
      firstName: "Bob",
      bookingId: "booking-1",
      reviewToken: "valid-token",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.verified).toBe(true);
  });

  it("creates unverified review when bookingId token does not match", async () => {
    mocks.bookingFindFirst.mockResolvedValue(null);
    const req = makeRequest({
      text: "Good enough for a review!",
      firstName: "Carol",
      bookingId: "booking-99",
      reviewToken: "wrong-token",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.verified).toBe(false);
  });

  it("calls revalidatePath for review pages after creation", async () => {
    const req = makeRequest({
      text: "Excellent service experience!",
      firstName: "Dave",
    });
    await POST(req);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/reviews");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/review");
  });

  it("marks review as verified via reviewRequestId and reviewToken", async () => {
    mocks.reviewRequestFindFirst.mockResolvedValue({
      id: "rr-1",
      reviewToken: "rr-token",
      email: "eve@example.com",
      phone: null,
    });
    mocks.reviewRequestUpdate.mockResolvedValue({});
    mocks.reviewCreate.mockResolvedValue({
      id: "review-rr",
      text: "Fantastic service from start!",
      verified: true,
      status: "pending",
    });
    const req = makeRequest({
      text: "Fantastic service from start!",
      firstName: "Eve",
      reviewRequestId: "rr-1",
      reviewToken: "rr-token",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.verified).toBe(true);
  });

  it("stores contactEmail and contactPhone from body when reviewRequest lacks them", async () => {
    mocks.reviewRequestFindFirst.mockResolvedValue({
      id: "rr-2",
      reviewToken: "rr-token-2",
      email: null,
      phone: null,
    });
    mocks.reviewRequestUpdate.mockResolvedValue({});
    mocks.reviewCreate.mockResolvedValue({
      id: "review-rr2",
      text: "Really happy with the outcome!",
      verified: true,
      status: "pending",
    });
    const req = makeRequest({
      text: "Really happy with the outcome!",
      firstName: "Frank",
      reviewRequestId: "rr-2",
      reviewToken: "rr-token-2",
      contactEmail: "frank@example.com",
      contactPhone: "021 555 6666",
    });
    await POST(req);
    expect(mocks.reviewRequestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "frank@example.com" }),
      }),
    );
  });

  it("auto-links review to contact by booking email", async () => {
    mocks.bookingFindFirst.mockResolvedValue({
      id: "booking-link",
      reviewToken: "link-token",
      email: "grace@example.com",
    });
    mocks.bookingUpdate.mockResolvedValue({});
    mocks.contactFindFirst.mockResolvedValue({ id: "contact-grace" });
    mocks.reviewCreate.mockResolvedValue({
      id: "review-linked",
      text: "Smooth and professional experience!",
      verified: true,
      status: "pending",
    });
    const req = makeRequest({
      text: "Smooth and professional experience!",
      firstName: "Grace",
      bookingId: "booking-link",
      reviewToken: "link-token",
    });
    await POST(req);
    expect(mocks.reviewCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contactId: "contact-grace" }),
      }),
    );
  });

  it("auto-links review to contact by review request email", async () => {
    mocks.reviewRequestFindFirst.mockResolvedValue({
      id: "rr-link",
      reviewToken: "rr-link-token",
      email: "henry@example.com",
      phone: null,
    });
    mocks.reviewRequestUpdate.mockResolvedValue({});
    mocks.contactFindFirst.mockResolvedValue({ id: "contact-henry" });
    mocks.reviewCreate.mockResolvedValue({
      id: "review-rr-linked",
      text: "Would highly recommend this service!",
      verified: true,
      status: "pending",
    });
    const req = makeRequest({
      text: "Would highly recommend this service!",
      firstName: "Henry",
      reviewRequestId: "rr-link",
      reviewToken: "rr-link-token",
    });
    await POST(req);
    expect(mocks.reviewCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contactId: "contact-henry" }),
      }),
    );
  });

  it("falls back to phone lookup when review request has no email match", async () => {
    mocks.reviewRequestFindFirst.mockResolvedValue({
      id: "rr-phone",
      reviewToken: "rr-phone-token",
      email: null,
      phone: "021 777 8888",
    });
    mocks.reviewRequestUpdate.mockResolvedValue({});
    // email is null on the review request so the email-lookup branch is skipped;
    // only the phone-lookup findFirst is called
    mocks.contactFindFirst.mockResolvedValue({ id: "contact-phone" });
    mocks.reviewCreate.mockResolvedValue({
      id: "review-phone",
      text: "Absolutely brilliant work done here!",
      verified: true,
      status: "pending",
    });
    const req = makeRequest({
      text: "Absolutely brilliant work done here!",
      firstName: "Iris",
      reviewRequestId: "rr-phone",
      reviewToken: "rr-phone-token",
    });
    await POST(req);
    expect(mocks.reviewCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contactId: "contact-phone" }),
      }),
    );
  });

  it("returns 500 on unexpected database error", async () => {
    mocks.reviewCreate.mockRejectedValue(new Error("DB crash"));
    const req = makeRequest({ text: "Great service indeed!", firstName: "Jane" });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/failed to submit review/i);
  });
});
