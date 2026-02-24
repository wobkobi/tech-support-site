/**
 * @file tests/api/cron/refresh-calendar-cache.test.ts
 * @description Tests for calendar cache refresh cron endpoint
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/cron/refresh-calendar-cache/route";
import { NextRequest } from "next/server";

// Mock calendar-cache module
vi.mock("@/lib/calendar-cache", () => ({
  refreshCalendarCache: vi.fn(),
}));

describe("GET /api/cron/refresh-calendar-cache", () => {
  const CRON_SECRET = "test-secret-123";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
  });

  it("returns cache refresh results on success", async () => {
    const { refreshCalendarCache } = await import("@/lib/calendar-cache");

    vi.mocked(refreshCalendarCache).mockResolvedValueOnce({
      cachedCount: 15,
      deletedCount: 3,
    });

    const request = new NextRequest("http://localhost:3000/api/cron/refresh-calendar-cache", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    const response = await GET(request);
    const body = (await response.json()) as {
      ok: boolean;
      cachedCount: number;
      deletedCount: number;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.cachedCount).toBe(15);
    expect(body.deletedCount).toBe(3);

    expect(refreshCalendarCache).toHaveBeenCalledTimes(1);
  });

  it("handles empty cache refresh (no events)", async () => {
    const { refreshCalendarCache } = await import("@/lib/calendar-cache");

    vi.mocked(refreshCalendarCache).mockResolvedValueOnce({
      cachedCount: 0,
      deletedCount: 0,
    });

    const request = new NextRequest("http://localhost:3000/api/cron/refresh-calendar-cache", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    const response = await GET(request);
    const body = (await response.json()) as {
      ok: boolean;
      cachedCount: number;
      deletedCount: number;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.cachedCount).toBe(0);
    expect(body.deletedCount).toBe(0);
  });

  it("returns 500 when calendar cache refresh fails", async () => {
    const { refreshCalendarCache } = await import("@/lib/calendar-cache");

    vi.mocked(refreshCalendarCache).mockRejectedValueOnce(new Error("Google Calendar API error"));

    const request = new NextRequest("http://localhost:3000/api/cron/refresh-calendar-cache", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    const response = await GET(request);
    const body = (await response.json()) as { ok: boolean; error: string };

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Failed to refresh calendar cache");
  });

  it("returns 401 if authorization header is missing", async () => {
    const { refreshCalendarCache } = await import("@/lib/calendar-cache");

    const request = new NextRequest("http://localhost:3000/api/cron/refresh-calendar-cache", {
      method: "GET",
    });

    const response = await GET(request);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");

    // Verify cache refresh was NOT called
    expect(refreshCalendarCache).not.toHaveBeenCalled();
  });

  it("returns 401 if authorization header has wrong secret", async () => {
    const { refreshCalendarCache } = await import("@/lib/calendar-cache");

    const request = new NextRequest("http://localhost:3000/api/cron/refresh-calendar-cache", {
      method: "GET",
      headers: { authorization: "Bearer wrong-secret" },
    });

    const response = await GET(request);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");

    // Verify cache refresh was NOT called
    expect(refreshCalendarCache).not.toHaveBeenCalled();
  });

  it("accepts request with x-vercel-cron header", async () => {
    const { refreshCalendarCache } = await import("@/lib/calendar-cache");

    vi.mocked(refreshCalendarCache).mockResolvedValueOnce({
      cachedCount: 10,
      deletedCount: 2,
    });

    const request = new NextRequest("http://localhost:3000/api/cron/refresh-calendar-cache", {
      method: "GET",
      headers: { "x-vercel-cron": "true" },
    });

    const response = await GET(request);
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);

    // Verify cache refresh was called (auth passed)
    expect(refreshCalendarCache).toHaveBeenCalled();
  });
});
