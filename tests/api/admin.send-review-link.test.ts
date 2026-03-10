import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as adminReviewsPost } from "../../src/app/api/admin/reviews/route";
import { POST as sendReviewLinkPost } from "../../src/app/api/admin/send-review-link/route";
import { isValidAdminToken } from "../../src/shared/lib/auth";
import { prisma } from "../../src/shared/lib/prisma";
import { NextRequest } from "next/server";

vi.mock("../../src/shared/lib/auth", () => ({
  isValidAdminToken: vi.fn(),
}));

vi.mock("../../src/shared/lib/prisma", () => ({
  prisma: {
    review: { create: vi.fn() },
    reviewRequest: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    booking: { findFirst: vi.fn() },
  },
}));

vi.mock("../../src/features/reviews/lib/email", () => ({
  sendPastClientReviewRequest: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Creates a fake NextRequest with the given JSON body.
 * @param body - The request body object.
 * @returns A minimal fake NextRequest.
 */
function makeRequest(body: object): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

// ─── /api/admin/reviews POST ──────────────────────────────────────────────────

describe("API: /api/admin/reviews POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 201 with review for valid admin token and text", async () => {
    (isValidAdminToken as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (prisma.review.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "r1",
      text: "Excellent support here!",
      firstName: "Jane",
      lastName: "Smith",
      isAnonymous: false,
      verified: false,
      status: "approved",
      createdAt: new Date(),
    });
    const req = makeRequest({
      token: "valid-admin-token",
      text: "Excellent support here!",
      firstName: "Jane",
      lastName: "Smith",
      isAnonymous: false,
    });
    const res = await adminReviewsPost(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.review.text).toBe("Excellent support here!");
  });

  it("returns 401 for invalid admin token", async () => {
    (isValidAdminToken as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const req = makeRequest({ token: "invalid-token", text: "Test review" });
    const res = await adminReviewsPost(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 400 for review text shorter than 10 characters", async () => {
    (isValidAdminToken as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const req = makeRequest({ token: "valid-admin-token", text: "short" });
    const res = await adminReviewsPost(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/at least 10 characters/);
  });
});

// ─── /api/admin/send-review-link POST ─────────────────────────────────────────

describe("API: /api/admin/send-review-link POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.reviewRequest.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.booking.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  it("returns 401 when admin token is invalid", async () => {
    (isValidAdminToken as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const req = makeRequest({ token: "bad", name: "Alice", email: "a@b.com", mode: "email" });
    const res = await sendReviewLinkPost(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when name is missing", async () => {
    (isValidAdminToken as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const req = makeRequest({ token: "good", email: "a@b.com", mode: "email" });
    const res = await sendReviewLinkPost(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Name/i);
  });

  it("returns 400 when email mode has no valid email", async () => {
    (isValidAdminToken as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const req = makeRequest({
      token: "good",
      name: "Alice",
      email: "not-an-email",
      mode: "email",
    });
    const res = await sendReviewLinkPost(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/email/i);
  });

  it("creates a reviewRequest and sends email — returns ok:true", async () => {
    (isValidAdminToken as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (prisma.reviewRequest.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "rr-1",
      reviewToken: "tok-abc",
    });
    const req = makeRequest({
      token: "good",
      name: "Alice",
      email: "alice@example.com",
      mode: "email",
    });
    const res = await sendReviewLinkPost(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("returns existing reviewUrl when email already has a review request", async () => {
    (isValidAdminToken as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (prisma.reviewRequest.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      reviewToken: "existing-tok",
    });
    const req = makeRequest({
      token: "good",
      name: "Alice",
      email: "alice@example.com",
      mode: "email",
    });
    const res = await sendReviewLinkPost(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.existing).toBe(true);
    expect(json.reviewUrl).toContain("existing-tok");
  });

  it("returns 400 when SMS mode has an invalid phone number", async () => {
    (isValidAdminToken as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const req = makeRequest({ token: "good", name: "Alice", phone: "123", mode: "sms" });
    const res = await sendReviewLinkPost(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/phone/i);
  });

  it("returns ok:true with reviewUrl for SMS mode with valid phone", async () => {
    (isValidAdminToken as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (prisma.reviewRequest.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "rr-2",
      reviewToken: "sms-tok",
    });
    const req = makeRequest({
      token: "good",
      name: "Alice",
      phone: "021 123 1234",
      mode: "sms",
    });
    const res = await sendReviewLinkPost(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.reviewUrl).toContain("sms-tok");
  });
});
