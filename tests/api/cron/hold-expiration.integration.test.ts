/**
 * @file tests/api/cron/hold-expiration.integration.test.ts
 * @description Integration tests for hold expiration: verifies activeSlotKey is cleared when holds expire
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

describe("Hold Expiration Integration - activeSlotKey Clearing", () => {
  const CRON_SECRET = "test-secret-hold-expiration";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
  });

  it("clears activeSlotKey when releasing expired holds", async () => {
    const { prisma } = await import("@/lib/prisma");

    const now = new Date("2026-02-24T10:15:00Z");
    vi.setSystemTime(now);

    // Simulate 3 expired holds with activeSlotKey set
    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([
      { id: "hold-1" },
      { id: "hold-2" },
      { id: "hold-3" },
    ] as any);

    vi.mocked(prisma.booking.updateMany).mockResolvedValueOnce({ count: 3 } as any);

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

    // Verify response
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.releasedCount).toBe(3);
    expect(body.releasedIds).toEqual(["hold-1", "hold-2", "hold-3"]);

    // ✅ CRITICAL: Verify updateMany was called with activeSlotKey: null
    const updateCall = vi.mocked(prisma.booking.updateMany).mock.calls[0];
    expect(updateCall[0]).toEqual({
      where: { id: { in: ["hold-1", "hold-2", "hold-3"] } },
      data: {
        status: "cancelled",
        activeSlotKey: null, // Must be null to free up the slot
      },
    });

    vi.useRealTimers();
  });

  it("does not modify activeSlotKey if no holds expired", async () => {
    const { prisma } = await import("@/lib/prisma");

    const now = new Date("2026-02-24T10:15:00Z");
    vi.setSystemTime(now);

    // No expired holds
    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([]);

    const request = new NextRequest("http://localhost:3000/api/cron/release-holds", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    const response = await GET(request);
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.releasedCount).toBe(0);

    // Verify updateMany was NOT called
    expect(prisma.booking.updateMany).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("clears activeSlotKey for single expired hold", async () => {
    const { prisma } = await import("@/lib/prisma");

    const now = new Date("2026-02-24T10:15:00Z");
    vi.setSystemTime(now);

    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([{ id: "hold-single" }] as any);
    vi.mocked(prisma.booking.updateMany).mockResolvedValueOnce({ count: 1 } as any);

    const request = new NextRequest("http://localhost:3000/api/cron/release-holds", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    await GET(request);

    // Verify activeSlotKey: null is in the update data
    const updateCall = vi.mocked(prisma.booking.updateMany).mock.calls[0];
    expect(updateCall[0].data.activeSlotKey).toBeNull();

    vi.useRealTimers();
  });
});
