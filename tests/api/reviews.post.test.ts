import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  reviewCreate: vi.fn(),
  bookingFindFirst: vi.fn(),
  bookingUpdate: vi.fn(),
  reviewRequestFindFirst: vi.fn(),
  reviewRequestUpdate: vi.fn(),
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

  it("returns 400 when text is too long", async () => {
    const req = makeRequest({ text: "a".repeat(601), firstName: "Alice" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/600 characters/);
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
});
