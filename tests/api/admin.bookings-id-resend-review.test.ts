import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isAdminRequest: vi.fn(),
  bookingFindUnique: vi.fn(),
  bookingUpdate: vi.fn(),
  sendCustomerReviewRequest: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isAdminRequest: mocks.isAdminRequest,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    booking: {
      findUnique: mocks.bookingFindUnique,
      update: mocks.bookingUpdate,
    },
  },
}));

vi.mock("@/features/reviews/lib/email", () => ({
  sendCustomerReviewRequest: mocks.sendCustomerReviewRequest,
}));

import { POST } from "../../src/app/api/admin/bookings/[id]/resend-review/route";

const BOOKING = {
  id: "booking-123",
  name: "Alice Smith",
  email: "alice@example.com",
  reviewToken: "token-abc",
};

const PARAMS = { params: Promise.resolve({ id: "booking-123" }) };
const FAKE_REQ = {} as unknown as NextRequest;

describe("POST /api/admin/bookings/[id]/resend-review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.bookingFindUnique.mockResolvedValue(BOOKING);
    mocks.bookingUpdate.mockResolvedValue({});
    mocks.sendCustomerReviewRequest.mockResolvedValue(undefined);
  });

  it("returns 401 when request is not from admin", async () => {
    mocks.isAdminRequest.mockReturnValue(false);
    const res = await POST(FAKE_REQ, PARAMS);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 404 when booking does not exist", async () => {
    mocks.bookingFindUnique.mockResolvedValue(null);
    const res = await POST(FAKE_REQ, PARAMS);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it("calls sendCustomerReviewRequest with the booking data", async () => {
    await POST(FAKE_REQ, PARAMS);
    expect(mocks.sendCustomerReviewRequest).toHaveBeenCalledWith(BOOKING);
  });

  it("updates reviewSentAt after sending", async () => {
    await POST(FAKE_REQ, PARAMS);
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      where: { id: "booking-123" },
      data: { reviewSentAt: expect.any(Date) },
    });
  });

  it("returns ok:true on success", async () => {
    const res = await POST(FAKE_REQ, PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("still updates reviewSentAt even if sendCustomerReviewRequest is fire-and-forget", async () => {
    // sendCustomerReviewRequest never throws - reviewSentAt must always be updated
    mocks.sendCustomerReviewRequest.mockResolvedValue(undefined);
    await POST(FAKE_REQ, PARAMS);
    expect(mocks.bookingUpdate).toHaveBeenCalled();
  });
});
