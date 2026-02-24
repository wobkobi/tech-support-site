/**
 * @file tests/api/cron/release-holds.timing.test.ts
 * @description Timing and edge case tests for release-holds cron endpoint
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/cron/release-holds/route";
import { NextRequest } from "next/server";

// Mock Prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

describe("GET /api/cron/release-holds - Timing & Edge Cases", () => {
  const CRON_SECRET = "test-secret-123";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
  });

  it("releases hold that expired exactly at current time", async () => {
    const { prisma } = await import("@/lib/prisma");

    const now = new Date("2026-02-24T10:00:00Z");
    vi.setSystemTime(now);

    // Hold expired exactly at 10:00:00
    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([{ id: "booking-123" }] as any);

    vi.mocked(prisma.booking.updateMany).mockResolvedValueOnce({ count: 1 } as any);

    const request = new NextRequest("http://localhost:3000/api/cron/release-holds", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    const response = await GET(request);
    const body = (await response.json()) as {
      ok: boolean;
      releasedCount: number;
      releasedIds: string[];
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.releasedCount).toBe(1);
    expect(body.releasedIds).toEqual(["booking-123"]);

    // Verify query used correct time threshold
    expect(prisma.booking.findMany).toHaveBeenCalledWith({
      where: {
        status: "held",
        holdExpiresUtc: { lte: now },
      },
      select: { id: true },
    });

    // Verify status was updated to cancelled and activeSlotKey cleared
    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["booking-123"] } },
      data: {
        status: "cancelled",
        activeSlotKey: null,
      },
    });

    vi.useRealTimers();
  });

  it("does NOT release hold that expires 1 second in the future", async () => {
    const { prisma } = await import("@/lib/prisma");

    const now = new Date("2026-02-24T10:00:00Z");
    vi.setSystemTime(now);

    // Hold expires at 10:00:01 (1 second in future)
    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([]);

    const request = new NextRequest("http://localhost:3000/api/cron/release-holds", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    const response = await GET(request);
    const body = (await response.json()) as {
      ok: boolean;
      releasedCount: number;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.releasedCount).toBe(0);

    // Verify updateMany was NOT called (no holds to release)
    expect(prisma.booking.updateMany).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("releases multiple expired holds in bulk", async () => {
    const { prisma } = await import("@/lib/prisma");

    const now = new Date("2026-02-24T10:00:00Z");
    vi.setSystemTime(now);

    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([
      { id: "booking-1" },
      { id: "booking-2" },
      { id: "booking-3" },
      { id: "booking-4" },
      { id: "booking-5" },
    ] as any);

    vi.mocked(prisma.booking.updateMany).mockResolvedValueOnce({ count: 5 } as any);

    const request = new NextRequest("http://localhost:3000/api/cron/release-holds", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    const response = await GET(request);
    const body = (await response.json()) as {
      ok: boolean;
      releasedCount: number;
      releasedIds: string[];
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.releasedCount).toBe(5);
    expect(body.releasedIds).toHaveLength(5);

    // Verify bulk update with all IDs and activeSlotKey cleared
    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["booking-1", "booking-2", "booking-3", "booking-4", "booking-5"] } },
      data: {
        status: "cancelled",
        activeSlotKey: null,
      },
    });

    vi.useRealTimers();
  });

  it("handles empty result (no expired holds)", async () => {
    const { prisma } = await import("@/lib/prisma");

    const now = new Date("2026-02-24T10:00:00Z");
    vi.setSystemTime(now);

    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([]);

    const request = new NextRequest("http://localhost:3000/api/cron/release-holds", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    const response = await GET(request);
    const body = (await response.json()) as {
      ok: boolean;
      releasedCount: number;
      releasedIds: string[];
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.releasedCount).toBe(0);
    expect(body.releasedIds).toEqual([]);

    // No update should be called if no holds found
    expect(prisma.booking.updateMany).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("only queries bookings with status=held", async () => {
    const { prisma } = await import("@/lib/prisma");

    const now = new Date("2026-02-24T10:00:00Z");
    vi.setSystemTime(now);

    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([]);

    const request = new NextRequest("http://localhost:3000/api/cron/release-holds", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    await GET(request);

    // Verify query filters by status=held (not confirmed or cancelled)
    expect(prisma.booking.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: "held",
      }),
      select: { id: true },
    });

    vi.useRealTimers();
  });

  it("returns 500 on database error", async () => {
    const { prisma } = await import("@/lib/prisma");

    const now = new Date("2026-02-24T10:00:00Z");
    vi.setSystemTime(now);

    vi.mocked(prisma.booking.findMany).mockRejectedValueOnce(new Error("Database connection lost"));

    const request = new NextRequest("http://localhost:3000/api/cron/release-holds", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    const response = await GET(request);
    const body = (await response.json()) as { ok: boolean; error: string };

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Failed to release holds");

    vi.useRealTimers();
  });

  it("returns 401 if authorization header is missing", async () => {
    const { prisma } = await import("@/lib/prisma");

    const request = new NextRequest("http://localhost:3000/api/cron/release-holds", {
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

    const request = new NextRequest("http://localhost:3000/api/cron/release-holds", {
      method: "GET",
      headers: { authorization: "Bearer wrong-secret" },
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

    const request = new NextRequest("http://localhost:3000/api/cron/release-holds", {
      method: "GET",
      headers: { "x-vercel-cron": "true" },
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
