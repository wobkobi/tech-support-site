import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isAdminRequest: vi.fn(),
  reviewFindMany: vi.fn(),
  reviewUpdate: vi.fn(),
  bookingFindMany: vi.fn(),
  contactFindMany: vi.fn(),
  reviewRequestFindMany: vi.fn(),
  normalizePhone: vi.fn((v: string) => v),
  toE164NZ: vi.fn((v: string) => v),
}));

vi.mock("@/shared/lib/auth", () => ({
  isAdminRequest: mocks.isAdminRequest,
}));

vi.mock("@/shared/lib/normalize-phone", () => ({
  normalizePhone: mocks.normalizePhone,
  toE164NZ: mocks.toE164NZ,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    review: {
      findMany: mocks.reviewFindMany,
      update: mocks.reviewUpdate,
    },
    booking: {
      findMany: mocks.bookingFindMany,
    },
    contact: {
      findMany: mocks.contactFindMany,
    },
    reviewRequest: {
      findMany: mocks.reviewRequestFindMany,
    },
  },
}));

import { POST } from "../../src/app/api/admin/reviews/match-contacts/route";

const FAKE_REQ = {} as unknown as NextRequest;

// customerRef is a reviewToken UUID - must be looked up via ReviewRequest
const TOKEN_BOB = "token-bob-uuid";

const UNMATCHED_REVIEWS = [
  { id: "r1", bookingId: "b1", customerRef: null },
  { id: "r2", bookingId: null, customerRef: TOKEN_BOB },
  { id: "r3", bookingId: null, customerRef: null },
];

const BOOKINGS = [{ id: "b1", email: "alice@example.com", phone: null }];

const CONTACTS = [
  { id: "c1", email: "alice@example.com", phone: null },
  { id: "c2", email: "bob@example.com", phone: null },
];

// ReviewRequest that maps TOKEN_BOB → bob@example.com
const REVIEW_REQUESTS = [{ reviewToken: TOKEN_BOB, email: "bob@example.com", phone: null }];

describe("POST /api/admin/reviews/match-contacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.reviewFindMany.mockResolvedValue(UNMATCHED_REVIEWS);
    mocks.bookingFindMany.mockResolvedValue(BOOKINGS);
    mocks.contactFindMany.mockResolvedValue(CONTACTS);
    mocks.reviewRequestFindMany.mockResolvedValue(REVIEW_REQUESTS);
    mocks.reviewUpdate.mockResolvedValue({});
  });

  it("returns 401 when not admin", async () => {
    mocks.isAdminRequest.mockReturnValue(false);
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns matchedCount 0 when no unmatched reviews", async () => {
    mocks.reviewFindMany.mockResolvedValue([]);
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.matchedCount).toBe(0);
    expect(mocks.reviewUpdate).not.toHaveBeenCalled();
  });

  it("matches reviews via bookingId email and customerRef token", async () => {
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    // r1 matched via booking email, r2 matched via ReviewRequest token→email
    expect(json.matchedCount).toBe(2);
  });

  it("calls review.update with correct contactId for booking-based match", async () => {
    await POST(FAKE_REQ);
    expect(mocks.reviewUpdate).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { contactId: "c1" },
    });
  });

  it("calls review.update with correct contactId for customerRef token match", async () => {
    await POST(FAKE_REQ);
    expect(mocks.reviewUpdate).toHaveBeenCalledWith({
      where: { id: "r2" },
      data: { contactId: "c2" },
    });
  });

  it("does not update reviews with no bookingId and no customerRef", async () => {
    await POST(FAKE_REQ);
    const calls = mocks.reviewUpdate.mock.calls.map((c) => c[0].where.id);
    expect(calls).not.toContain("r3");
  });

  it("returns matchedCount 0 when no contacts match", async () => {
    mocks.contactFindMany.mockResolvedValue([]);
    const res = await POST(FAKE_REQ);
    const json = await res.json();
    expect(json.matchedCount).toBe(0);
  });

  it("returns 500 on unexpected error", async () => {
    mocks.reviewFindMany.mockRejectedValue(new Error("DB error"));
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/failed/i);
  });

  it("returns matchedCount 0 when review has no bookingId and no customerRef", async () => {
    mocks.reviewFindMany.mockResolvedValue([{ id: "r4", bookingId: null, customerRef: null }]);
    mocks.reviewRequestFindMany.mockResolvedValue([]);
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.matchedCount).toBe(0);
    expect(mocks.reviewUpdate).not.toHaveBeenCalled();
  });

  it("matches a review via booking phone when email contact is not found", async () => {
    mocks.reviewFindMany.mockResolvedValue([{ id: "r5", bookingId: "b2", customerRef: null }]);
    mocks.bookingFindMany.mockResolvedValue([
      { id: "b2", email: "unknown@example.com", phone: "021111" },
    ]);
    mocks.contactFindMany.mockResolvedValue([
      { id: "c3", email: "carol@example.com", phone: "021111" },
    ]);
    mocks.reviewRequestFindMany.mockResolvedValue([]);
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.matchedCount).toBe(1);
    expect(mocks.reviewUpdate).toHaveBeenCalledWith({
      where: { id: "r5" },
      data: { contactId: "c3" },
    });
  });

  it("matches a review via ReviewRequest phone when no email contact is found", async () => {
    const TOKEN = "token-sms-only";
    mocks.reviewFindMany.mockResolvedValue([{ id: "r6", bookingId: null, customerRef: TOKEN }]);
    mocks.bookingFindMany.mockResolvedValue([]);
    mocks.reviewRequestFindMany.mockResolvedValue([
      { reviewToken: TOKEN, email: null, phone: "021999" },
    ]);
    mocks.contactFindMany.mockResolvedValue([
      { id: "c4", email: "dave@example.com", phone: "021999" },
    ]);
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.matchedCount).toBe(1);
    expect(mocks.reviewUpdate).toHaveBeenCalledWith({
      where: { id: "r6" },
      data: { contactId: "c4" },
    });
  });
});
