import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isCronAuthorized: vi.fn(),
  bookingFindMany: vi.fn(),
  bookingUpdate: vi.fn(),
  bookingUpdateMany: vi.fn(),
  reviewRequestFindMany: vi.fn(),
  sendCustomerReviewRequest: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isCronAuthorized: mocks.isCronAuthorized,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: mocks.bookingFindMany,
      update: mocks.bookingUpdate,
      updateMany: mocks.bookingUpdateMany,
    },
    reviewRequest: {
      findMany: mocks.reviewRequestFindMany,
    },
  },
}));

vi.mock("@/features/reviews/lib/email", () => ({
  sendCustomerReviewRequest: mocks.sendCustomerReviewRequest,
}));

import { GET } from "../../src/app/api/cron/send-review-emails/route";

/** Minimal fake NextRequest (isCronAuthorized is mocked so headers don't matter). */
const FAKE_REQ = {} as unknown as NextRequest;

describe("GET /api/cron/send-review-emails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authorized", async () => {
    mocks.isCronAuthorized.mockReturnValue(false);
    const res = await GET(FAKE_REQ);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns ok:true with zero sent when no bookings are due", async () => {
    mocks.isCronAuthorized.mockReturnValue(true);
    // No bookings to email
    mocks.bookingFindMany.mockResolvedValueOnce([]);
    // Already emailed
    mocks.bookingFindMany.mockResolvedValueOnce([]);
    mocks.reviewRequestFindMany.mockResolvedValue([]);

    const res = await GET(FAKE_REQ);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.found).toBe(0);
    expect(json.sent).toBe(0);
  });

  it("sends emails for eligible bookings and increments sent count", async () => {
    mocks.isCronAuthorized.mockReturnValue(true);
    // Two bookings due for review email
    mocks.bookingFindMany
      .mockResolvedValueOnce([
        { id: "b1", name: "Alice", email: "alice@example.com", reviewToken: "t1" },
        { id: "b2", name: "Bob", email: "bob@example.com", reviewToken: "t2" },
      ])
      // alreadyEmailedBookings: none
      .mockResolvedValueOnce([]);
    mocks.reviewRequestFindMany.mockResolvedValue([]);
    mocks.bookingUpdate.mockResolvedValue({});
    mocks.sendCustomerReviewRequest.mockResolvedValue(undefined);

    const res = await GET(FAKE_REQ);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.found).toBe(2);
    expect(json.sent).toBe(2);
    expect(json.suppressed).toBe(0);
  });

  it("suppresses duplicate emails for the same email address", async () => {
    mocks.isCronAuthorized.mockReturnValue(true);
    // Two bookings with same email
    mocks.bookingFindMany
      .mockResolvedValueOnce([
        { id: "b1", name: "Alice", email: "alice@example.com", reviewToken: "t1" },
        { id: "b2", name: "Alice (repeat)", email: "alice@example.com", reviewToken: "t2" },
      ])
      .mockResolvedValueOnce([]);
    mocks.reviewRequestFindMany.mockResolvedValue([]);
    mocks.bookingUpdate.mockResolvedValue({});
    mocks.bookingUpdateMany.mockResolvedValue({ count: 1 });
    mocks.sendCustomerReviewRequest.mockResolvedValue(undefined);

    const res = await GET(FAKE_REQ);
    const json = await res.json();
    expect(json.found).toBe(2);
    expect(json.sent).toBe(1);
    expect(json.suppressed).toBe(1);
  });

  it("suppresses emails for addresses already in alreadyEmailedBookings", async () => {
    mocks.isCronAuthorized.mockReturnValue(true);
    mocks.bookingFindMany
      .mockResolvedValueOnce([
        { id: "b1", name: "Alice", email: "alice@example.com", reviewToken: "t1" },
      ])
      // alreadyEmailedBookings contains the same email
      .mockResolvedValueOnce([{ email: "alice@example.com" }]);
    mocks.reviewRequestFindMany.mockResolvedValue([]);
    mocks.bookingUpdateMany.mockResolvedValue({ count: 1 });

    const res = await GET(FAKE_REQ);
    const json = await res.json();
    expect(json.sent).toBe(0);
    expect(json.suppressed).toBe(1);
  });

  it("counts failed emails in the failed counter", async () => {
    mocks.isCronAuthorized.mockReturnValue(true);
    mocks.bookingFindMany
      .mockResolvedValueOnce([
        { id: "b1", name: "Alice", email: "alice@example.com", reviewToken: "t1" },
      ])
      .mockResolvedValueOnce([]);
    mocks.reviewRequestFindMany.mockResolvedValue([]);
    mocks.bookingUpdate.mockResolvedValue({});
    mocks.sendCustomerReviewRequest.mockRejectedValue(new Error("SMTP error"));

    const res = await GET(FAKE_REQ);
    const json = await res.json();
    expect(json.failed).toBe(1);
    expect(json.sent).toBe(0);
  });
});
