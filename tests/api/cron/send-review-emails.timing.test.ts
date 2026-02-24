/**
 * @file tests/api/cron/send-review-emails.timing.test.ts
 * @description Timing edge case tests for send-review-emails cron endpoint
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/cron/send-review-emails/route";
import { NextRequest } from "next/server";

// Mock email sending
vi.mock("@/lib/email", () => ({
  sendCustomerReviewRequest: vi.fn().mockResolvedValue(undefined),
}));

// Mock Prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe("GET /api/cron/send-review-emails - Timing Edge Cases", () => {
  const CRON_SECRET = "test-secret-123";
  
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
  });

  it("sends email for booking that ended exactly 30 minutes ago", async () => {
    const { prisma } = await import("@/lib/prisma");

    const now = new Date("2026-02-24T10:00:00Z");
    const thirtyMinutesAgo = new Date("2026-02-24T09:30:00Z");

    vi.setSystemTime(now);

    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([
      {
        id: "booking-123",
        name: "John Doe",
        email: "john@example.com",
        reviewToken: "token-abc",
      },
    ] as any);

    vi.mocked(prisma.booking.update).mockResolvedValueOnce({ id: "booking-123" } as any);

    const request = new NextRequest("http://localhost:3000/api/cron/send-review-emails", {
      method: "GET",
      headers: {
        authorization: `Bearer ${CRON_SECRET}`,
      },
    });

    const response = await GET(request);
    const body = (await response.json()) as {
      ok: boolean;
      found: number;
      sent: number;
      failed: number;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.found).toBe(1);
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(0);

    // Verify query used correct time threshold
    expect(prisma.booking.findMany).toHaveBeenCalledWith({
      where: {
        endUtc: { lte: thirtyMinutesAgo },
        status: "confirmed",
        reviewSentAt: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        reviewToken: true,
      },
    });

    // Verify reviewSentAt was updated
    expect(prisma.booking.update).toHaveBeenCalledWith({
      where: { id: "booking-123" },
      data: { reviewSentAt: now },
    });

    vi.useRealTimers();
  });

  it("does NOT send email for booking that ended only 29 minutes ago", async () => {
    const { prisma } = await import("@/lib/prisma");

    const now = new Date("2026-02-24T10:00:00Z");

    vi.setSystemTime(now);

    // Mock returns empty array (booking is too recent)
    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([]);

    const request = new NextRequest("http://localhost:3000/api/cron/send-review-emails", {
      method: "GET",
      headers: {
        authorization: `Bearer ${CRON_SECRET}`,
      },
    });

    const response = await GET(request);
    const body = (await response.json()) as {
      ok: boolean;
      found: number;
      sent: number;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.found).toBe(0);
    expect(body.sent).toBe(0);

    // Verify email was NOT sent
    const { sendCustomerReviewRequest } = await import("@/lib/email");
    expect(sendCustomerReviewRequest).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("does NOT send email if reviewSentAt is already set (duplicate prevention)", async () => {
    const { prisma } = await import("@/lib/prisma");

    const now = new Date("2026-02-24T10:00:00Z");

    vi.setSystemTime(now);

    // Mock returns empty array (booking already has reviewSentAt set)
    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([]);

    const request = new NextRequest("http://localhost:3000/api/cron/send-review-emails", {
      method: "GET",
      headers: {
        authorization: `Bearer ${CRON_SECRET}`,
      },
    });

    const response = await GET(request);
    const body = (await response.json()) as {
      ok: boolean;
      found: number;
      sent: number;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.found).toBe(0);
    expect(body.sent).toBe(0);

    // Verify query filters out bookings with reviewSentAt
    expect(prisma.booking.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        reviewSentAt: null,
      }),
      select: expect.any(Object),
    });

    vi.useRealTimers();
  });

  it("does NOT send email for non-confirmed bookings", async () => {
    const { prisma } = await import("@/lib/prisma");

    const now = new Date("2026-02-24T10:00:00Z");

    vi.setSystemTime(now);

    // Mock returns empty array (query filters by status=confirmed)
    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([]);

    const request = new NextRequest("http://localhost:3000/api/cron/send-review-emails", {
      method: "GET",
      headers: {
        authorization: `Bearer ${CRON_SECRET}`,
      },
    });

    const response = await GET(request);
    const body = (await response.json()) as {
      ok: boolean;
      found: number;
      sent: number;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.found).toBe(0);
    expect(body.sent).toBe(0);

    // Verify query filters by status=confirmed
    expect(prisma.booking.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: "confirmed",
      }),
      select: expect.any(Object),
    });

    vi.useRealTimers();
  });

  it("handles partial failures without blocking other bookings", async () => {
    const { prisma } = await import("@/lib/prisma");

    const now = new Date("2026-02-24T10:00:00Z");

    vi.setSystemTime(now);

    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([
      {
        id: "booking-success",
        name: "Success User",
        email: "success@example.com",
        reviewToken: "token-success",
      },
      {
        id: "booking-fail",
        name: "Fail User",
        email: "fail@example.com",
        reviewToken: "token-fail",
      },
    ] as any);

    // First update succeeds, second fails
    vi.mocked(prisma.booking.update)
      .mockResolvedValueOnce({ id: "booking-success" } as any)
      .mockRejectedValueOnce(new Error("Database connection lost"));

    const request = new NextRequest("http://localhost:3000/api/cron/send-review-emails", {
      method: "GET",
      headers: {
        authorization: `Bearer ${CRON_SECRET}`,
      },
    });

    const response = await GET(request);
    const body = (await response.json()) as {
      ok: boolean;
      found: number;
      sent: number;
      failed: number;
      errors: string[];
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.found).toBe(2);
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toContain("booking-fail");

    vi.useRealTimers();
  });

  it("returns 401 if authorization header is missing", async () => {
    const { prisma } = await import("@/lib/prisma");

    const request = new NextRequest("http://localhost:3000/api/cron/send-review-emails", {
      method: "GET",
    });

    const response = await GET(request);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");

    // Verify no DB queries were made
    expect(prisma.booking.findMany).not.toHaveBeenCalled();
  });

  it("returns 401 if authorization header has wrong secret", async () => {
    const { prisma } = await import("@/lib/prisma");

    const request = new NextRequest("http://localhost:3000/api/cron/send-review-emails", {
      method: "GET",
      headers: {
        authorization: "Bearer wrong-secret",
      },
    });

    const response = await GET(request);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");

    // Verify no DB queries were made
    expect(prisma.booking.findMany).not.toHaveBeenCalled();
  });

  it("accepts request with x-vercel-cron header", async () => {
    const { prisma } = await import("@/lib/prisma");

    const now = new Date("2026-02-24T10:00:00Z");

    vi.setSystemTime(now);

    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([]);

    const request = new NextRequest("http://localhost:3000/api/cron/send-review-emails", {
      method: "GET",
      headers: {
        "x-vercel-cron": "true",
      },
    });

    const response = await GET(request);
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);

    // Verify query was made (auth passed)
    expect(prisma.booking.findMany).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
