import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isAdminRequest: vi.fn(),
  travelBlockUpdateMany: vi.fn(),
  refreshCalendarCache: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isAdminRequest: mocks.isAdminRequest,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    travelBlock: { updateMany: mocks.travelBlockUpdateMany },
  },
}));

vi.mock("@/features/calendar/lib/calendar-cache", () => ({
  refreshCalendarCache: mocks.refreshCalendarCache,
}));

import { POST } from "../../src/app/api/admin/travel/recalculate/route";

/**
 * Creates a minimal fake NextRequest.
 * @returns A minimal fake NextRequest.
 */
function makeRequest(): NextRequest {
  return {} as unknown as NextRequest;
}

describe("POST /api/admin/travel/recalculate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.travelBlockUpdateMany.mockResolvedValue({ count: 3 });
    mocks.refreshCalendarCache.mockResolvedValue({ cachedCount: 5 });
  });

  it("returns 401 when not admin", async () => {
    mocks.isAdminRequest.mockReturnValue(false);
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("deletes all travel blocks, runs cache refresh, and returns ok with cachedCount", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.cachedCount).toBe(5);
    expect(mocks.travelBlockUpdateMany).toHaveBeenCalledWith({
      data: {
        rawTravelMinutes: null,
        roundedMinutes: null,
        rawTravelBackMinutes: null,
        roundedBackMinutes: null,
      },
    });
    expect(mocks.refreshCalendarCache).toHaveBeenCalled();
  });

  it("returns 500 when an error is thrown", async () => {
    mocks.refreshCalendarCache.mockRejectedValue(new Error("Cache failure"));
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
});
