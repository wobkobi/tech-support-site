import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isCronAuthorized: vi.fn(),
  bookingFindMany: vi.fn(),
  bookingUpdateMany: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isCronAuthorized: mocks.isCronAuthorized,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: mocks.bookingFindMany,
      updateMany: mocks.bookingUpdateMany,
    },
  },
}));

import { GET } from "../../src/app/api/cron/release-holds/route";

const FAKE_REQ = {} as unknown as NextRequest;

describe("GET /api/cron/release-holds", () => {
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

  it("returns ok:true with releasedCount 0 when no expired holds exist", async () => {
    mocks.isCronAuthorized.mockReturnValue(true);
    mocks.bookingFindMany.mockResolvedValue([]);
    const res = await GET(FAKE_REQ);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.releasedCount).toBe(0);
    expect(json.releasedIds).toEqual([]);
    expect(mocks.bookingUpdateMany).not.toHaveBeenCalled();
  });

  it("cancels expired holds and returns their IDs", async () => {
    mocks.isCronAuthorized.mockReturnValue(true);
    mocks.bookingFindMany.mockResolvedValue([{ id: "hold-1" }, { id: "hold-2" }]);
    mocks.bookingUpdateMany.mockResolvedValue({ count: 2 });
    const res = await GET(FAKE_REQ);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.releasedCount).toBe(2);
    expect(json.releasedIds).toEqual(["hold-1", "hold-2"]);
    expect(mocks.bookingUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["hold-1", "hold-2"] } },
      data: { status: "cancelled", activeSlotKey: null },
    });
  });

  it("returns 500 when database throws", async () => {
    mocks.isCronAuthorized.mockReturnValue(true);
    mocks.bookingFindMany.mockRejectedValue(new Error("DB error"));
    const res = await GET(FAKE_REQ);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
});
