import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchAllCalendarEvents: vi.fn(),
  calendarEventCacheDeleteMany: vi.fn(),
  calendarEventCacheUpsert: vi.fn(),
}));

vi.mock("@/features/calendar/lib/google-calendar", () => ({
  fetchAllCalendarEvents: mocks.fetchAllCalendarEvents,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    calendarEventCache: {
      deleteMany: mocks.calendarEventCacheDeleteMany,
      upsert: mocks.calendarEventCacheUpsert,
    },
  },
}));

import { refreshCalendarCache } from "../../src/features/calendar/lib/calendar-cache";

describe("refreshCalendarCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports refreshCalendarCache as a function", () => {
    expect(typeof refreshCalendarCache).toBe("function");
  });

  it("returns zero counts when fetchAllCalendarEvents fails gracefully", async () => {
    mocks.fetchAllCalendarEvents.mockRejectedValue(new Error("API error"));
    const result = await refreshCalendarCache();
    expect(result).toEqual({ cachedCount: 0, deletedCount: 0 });
  });

  it("deletes expired entries and upserts fresh events", async () => {
    mocks.fetchAllCalendarEvents.mockResolvedValue([
      {
        id: "evt-1",
        start: "2026-03-10T21:00:00Z",
        end: "2026-03-10T22:00:00Z",
        calendarEmail: "cal@example.com",
      },
      {
        id: "evt-2",
        start: "2026-03-11T21:00:00Z",
        end: "2026-03-11T22:00:00Z",
        calendarEmail: "cal@example.com",
      },
    ]);
    mocks.calendarEventCacheDeleteMany.mockResolvedValue({ count: 3 });
    mocks.calendarEventCacheUpsert.mockResolvedValue({});

    const result = await refreshCalendarCache();

    expect(mocks.calendarEventCacheDeleteMany).toHaveBeenCalled();
    expect(mocks.calendarEventCacheUpsert).toHaveBeenCalledTimes(2);
    expect(result.cachedCount).toBe(2);
    expect(result.deletedCount).toBe(3);
  });

  it("returns cachedCount 0 and deletedCount from DB when no events are fetched", async () => {
    mocks.fetchAllCalendarEvents.mockResolvedValue([]);
    mocks.calendarEventCacheDeleteMany.mockResolvedValue({ count: 1 });

    const result = await refreshCalendarCache();
    expect(result.cachedCount).toBe(0);
    expect(result.deletedCount).toBe(1);
  });
});
