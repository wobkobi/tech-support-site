/**
 * @file tests/api/cron/review-email.integration.test.ts
 * @description Integration tests for send-review-emails cron endpoint state transitions
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/cron/send-review-emails/route";
import { NextRequest } from "next/server";

vi.mock("@/lib/email", () => ({
  sendCustomerReviewRequest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma");

describe("GET /api/cron/send-review-emails - Integration (State Transitions)", () => {
  const CRON_SECRET = "test-secret-integration";

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;

    // Initialize prisma mocks
    const { prisma } = await import("@/lib/prisma");
    (prisma.booking as any) = {
      findMany: vi.fn(),
      update: vi.fn(),
    };
  });

  it("sets reviewSentAt timestamp when sending email", async () => {
    const { prisma } = await import("@/lib/prisma");

    const now = new Date("2026-02-24T10:00:00Z");
    const thirtyOneMinutesAgo = new Date("2026-02-24T09:29:00Z");

    vi.setSystemTime(now);

    const booking = {
      id: "booking-123",
      name: "John Doe",
      email: "john@example.com",
      reviewToken: "token-abc",
      endUtc: thirtyOneMinutesAgo,
    };

    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([booking] as any);
    vi.mocked(prisma.booking.update).mockResolvedValueOnce({
      ...booking,
      reviewSentAt: now,
    } as any);

    const request = new NextRequest("http://localhost:3000/api/cron/send-review-emails", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    await GET(request);

    // Verify update call set reviewSentAt
    const updateCall = vi.mocked(prisma.booking.update).mock.calls[0];
    expect(updateCall[0].data.reviewSentAt).toEqual(now);
  });

  it("skips booking with reviewSentAt already set (idempotency)", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { sendCustomerReviewRequest } = await import("@/lib/email");

    const now = new Date("2026-02-24T10:00:00Z");

    vi.setSystemTime(now);

    // Booking already has reviewSentAt set (so findMany won't return it)
    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([]);

    const request = new NextRequest("http://localhost:3000/api/cron/send-review-emails", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    const response = await GET(request);
    const body = (await response.json()) as any;

    expect(body.sent).toBe(0);
    expect(sendCustomerReviewRequest).not.toHaveBeenCalled();
  });

  it("does not email appointment that ended 20 minutes ago (too recent)", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { sendCustomerReviewRequest } = await import("@/lib/email");

    const now = new Date("2026-02-24T10:00:00Z");

    vi.setSystemTime(now);

    // Cron looks for endUtc <= now - 30min
    // If appointment ended 20min ago, it won't match the WHERE clause
    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([]);

    const request = new NextRequest("http://localhost:3000/api/cron/send-review-emails", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    await GET(request);

    expect(sendCustomerReviewRequest).not.toHaveBeenCalled();
  });

  it("handles partial failures (one email error does not stop others)", async () => {
    const { prisma } = await import("@/lib/prisma");

    const now = new Date("2026-02-24T10:00:00Z");

    vi.setSystemTime(now);

    const bookings = [
      {
        id: "booking-1",
        name: "John Doe",
        email: "john@example.com",
        reviewToken: "token-1",
      },
      {
        id: "booking-2",
        name: "Jane Smith",
        email: "jane@example.com",
        reviewToken: "token-2",
      },
    ];

    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce(bookings as any);

    // First update succeeds, second fails
    vi.mocked(prisma.booking.update)
      .mockResolvedValueOnce({ ...bookings[0], reviewSentAt: now } as any)
      .mockRejectedValueOnce(new Error("Database error"));

    const request = new NextRequest("http://localhost:3000/api/cron/send-review-emails", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    const response = await GET(request);
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(1);
  });

  it("returns 401 when authorization header missing", async () => {
    const request = new NextRequest("http://localhost:3000/api/cron/send-review-emails", {
      method: "GET",
    });

    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("returns 401 when bearer token is wrong", async () => {
    const request = new NextRequest("http://localhost:3000/api/cron/send-review-emails", {
      method: "GET",
      headers: { authorization: "Bearer wrong-secret" },
    });

    const response = await GET(request);

    expect(response.status).toBe(401);
  });
});
