import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isCronAuthorized: vi.fn(),
  refreshCalendarCache: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isCronAuthorized: mocks.isCronAuthorized,
}));

vi.mock("@/features/calendar/lib/calendar-cache", () => ({
  refreshCalendarCache: mocks.refreshCalendarCache,
}));

import { GET } from "../../src/app/api/cron/refresh-calendar-cache/route";

/** Minimal fake request (isCronAuthorized is mocked so headers don't matter). */
const FAKE_REQ = {} as unknown as NextRequest;

describe("GET /api/cron/refresh-calendar-cache", () => {
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

  it("returns ok with cachedCount and deletedCount on success", async () => {
    mocks.isCronAuthorized.mockReturnValue(true);
    mocks.refreshCalendarCache.mockResolvedValue({ cachedCount: 5, deletedCount: 2 });
    const res = await GET(FAKE_REQ);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.cachedCount).toBe(5);
    expect(json.deletedCount).toBe(2);
  });

  it("returns 500 when refreshCalendarCache throws", async () => {
    mocks.isCronAuthorized.mockReturnValue(true);
    mocks.refreshCalendarCache.mockRejectedValue(new Error("calendar API down"));
    const res = await GET(FAKE_REQ);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
});
