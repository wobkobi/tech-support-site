import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  bookingFindMany: vi.fn(),
  fetchAllCalendarEvents: vi.fn(),
  buildAvailableDays: vi.fn(),
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    booking: { findMany: mocks.bookingFindMany },
  },
}));

vi.mock("@/features/calendar/lib/google-calendar", () => ({
  fetchAllCalendarEvents: mocks.fetchAllCalendarEvents,
}));

vi.mock("@/features/booking/lib/booking", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/booking/lib/booking")>();
  return { ...real, buildAvailableDays: mocks.buildAvailableDays };
});

import { GET } from "../../src/app/api/booking/days/route";

const FAKE_DAY = { dateKey: "2099-06-15", label: "Sunday 15 June", windows: [] };

describe("GET /api/booking/days", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bookingFindMany.mockResolvedValue([]);
    mocks.fetchAllCalendarEvents.mockResolvedValue([]);
    mocks.buildAvailableDays.mockReturnValue([FAKE_DAY]);
  });

  it("returns days and timeZone on success", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.days).toEqual([FAKE_DAY]);
    expect(typeof json.timeZone).toBe("string");
  });

  it("returns days even when calendar fetch fails (graceful degradation)", async () => {
    mocks.fetchAllCalendarEvents.mockRejectedValue(new Error("calendar unavailable"));
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.days).toEqual([FAKE_DAY]);
    // buildAvailableDays should still have been called (with empty calendar events)
    expect(mocks.buildAvailableDays).toHaveBeenCalled();
  });

  it("returns 500 with empty days when database throws", async () => {
    mocks.bookingFindMany.mockRejectedValue(new Error("DB down"));
    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.days).toEqual([]);
    expect(typeof json.timeZone).toBe("string");
  });
});
