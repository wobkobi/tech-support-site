/**
 * @file tests/api/cron/calendar-cache.integration.test.ts
 * @description Integration tests for refresh-calendar-cache cron endpoint
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/cron/refresh-calendar-cache/route";
import { NextRequest } from "next/server";

vi.mock("@/lib/calendar-cache");

describe("GET /api/cron/refresh-calendar-cache - Integration", () => {
  const CRON_SECRET = "test-secret-calendar";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
  });

  it("returns cached and deleted counts on success", async () => {
    const { refreshCalendarCache } = await import("@/lib/calendar-cache");

    vi.mocked(refreshCalendarCache).mockResolvedValueOnce({
      cachedCount: 15,
      deletedCount: 3,
    } as any);

    const request = new NextRequest("http://localhost:3000/api/cron/refresh-calendar-cache", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    const response = await GET(request);
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.cachedCount).toBe(15);
    expect(body.deletedCount).toBe(3);
  });

  it("handles empty cache (zero events)", async () => {
    const { refreshCalendarCache } = await import("@/lib/calendar-cache");

    vi.mocked(refreshCalendarCache).mockResolvedValueOnce({
      cachedCount: 0,
      deletedCount: 0,
    } as any);

    const request = new NextRequest("http://localhost:3000/api/cron/refresh-calendar-cache", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    const response = await GET(request);
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.cachedCount).toBe(0);
    expect(body.deletedCount).toBe(0);
  });

  it("returns 500 when calendar API fails", async () => {
    const { refreshCalendarCache } = await import("@/lib/calendar-cache");

    vi.mocked(refreshCalendarCache).mockRejectedValueOnce(new Error("Google Calendar API error"));

    const request = new NextRequest("http://localhost:3000/api/cron/refresh-calendar-cache", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    const response = await GET(request);
    const body = (await response.json()) as any;

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Failed to refresh calendar cache");
  });

  it("returns 401 when authorization missing", async () => {
    const request = new NextRequest("http://localhost:3000/api/cron/refresh-calendar-cache", {
      method: "GET",
    });

    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("accepts x-vercel-cron header when CRON_SECRET is set", async () => {
    const { refreshCalendarCache } = await import("@/lib/calendar-cache");

    vi.mocked(refreshCalendarCache).mockResolvedValueOnce({
      cachedCount: 5,
      deletedCount: 1,
    } as any);

    const request = new NextRequest("http://localhost:3000/api/cron/refresh-calendar-cache", {
      method: "GET",
      headers: { "x-vercel-cron": "true" },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
  });

  it("rejects wrong bearer token", async () => {
    const request = new NextRequest("http://localhost:3000/api/cron/refresh-calendar-cache", {
      method: "GET",
      headers: { authorization: "Bearer wrong-secret" },
    });

    const response = await GET(request);

    expect(response.status).toBe(401);
  });
});
