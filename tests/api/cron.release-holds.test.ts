import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isCronAuthorized: vi.fn(),
  bookingFindMany: vi.fn(),
  bookingUpdate: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isCronAuthorized: mocks.isCronAuthorized,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: mocks.bookingFindMany,
      update: mocks.bookingUpdate,
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
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
  });

  it("cancels expired holds and returns their IDs", async () => {
    mocks.isCronAuthorized.mockReturnValue(true);
    mocks.bookingFindMany.mockResolvedValue([{ id: "hold-1" }, { id: "hold-2" }]);
    mocks.bookingUpdate.mockResolvedValue({});
    const res = await GET(FAKE_REQ);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.releasedCount).toBe(2);
    expect(json.releasedIds).toEqual(["hold-1", "hold-2"]);
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      where: { id: "hold-1" },
      data: { status: "cancelled", activeSlotKey: "released:hold-1" },
    });
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      where: { id: "hold-2" },
      data: { status: "cancelled", activeSlotKey: "released:hold-2" },
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
