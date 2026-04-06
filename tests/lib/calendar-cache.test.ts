import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { findSmartOrigin } from "../../src/features/calendar/lib/calendar-cache";
import type { CalendarEvent } from "../../src/features/calendar/lib/google-calendar";

const mocks = vi.hoisted(() => ({
  fetchAllCalendarEvents: vi.fn(),
  getBookingCalendarId: vi.fn(),
  calendarEventCacheDeleteMany: vi.fn(),
  calendarEventCacheUpsert: vi.fn(),
  calendarEventCacheUpdateMany: vi.fn(),
  travelBlockFindMany: vi.fn(),
  travelBlockCreate: vi.fn(),
  travelBlockUpdate: vi.fn(),
  travelBlockDelete: vi.fn(),
  calculateTravelMinutes: vi.fn(),
}));

vi.mock("@/features/calendar/lib/google-calendar", () => ({
  fetchAllCalendarEvents: mocks.fetchAllCalendarEvents,
  getBookingCalendarId: mocks.getBookingCalendarId,
}));

vi.mock("@/features/calendar/lib/travel-time", () => ({
  calculateTravelMinutes: mocks.calculateTravelMinutes,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    calendarEventCache: {
      deleteMany: mocks.calendarEventCacheDeleteMany,
      upsert: mocks.calendarEventCacheUpsert,
      updateMany: mocks.calendarEventCacheUpdateMany,
    },
    travelBlock: {
      findMany: mocks.travelBlockFindMany,
      create: mocks.travelBlockCreate,
      update: mocks.travelBlockUpdate,
      delete: mocks.travelBlockDelete,
    },
  },
}));

import { refreshCalendarCache } from "../../src/features/calendar/lib/calendar-cache";

const BOOKING_CAL = "booking@example.com";
const WORK_CAL = "work@example.com";

const makeEvent = (
  id: string,
  startIso: string,
  endIso: string,
  extra: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  id,
  start: startIso,
  end: endIso,
  calendarEmail: "cal@example.com",
  ...extra,
});

describe("findSmartOrigin", () => {
  const HOME = "1 Home St, Auckland";

  it("returns homeAddress when no other events exist", () => {
    const target = makeEvent("e1", "2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z", {
      location: "Dentist",
    });
    expect(findSmartOrigin([target], target, HOME)).toBe(HOME);
  });

  it("returns the closest preceding event location within 4 hours", () => {
    const preceding = makeEvent("e0", "2026-06-01T07:00:00Z", "2026-06-01T08:00:00Z", {
      location: "99 Prior Ave",
    });
    const target = makeEvent("e1", "2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z", {
      location: "Dentist",
    });
    expect(findSmartOrigin([preceding, target], target, HOME)).toBe("99 Prior Ave");
  });

  it("falls back to home when preceding event ends more than 4 hours before target", () => {
    const preceding = makeEvent("e0", "2026-06-01T03:00:00Z", "2026-06-01T04:00:00Z", {
      location: "99 Far Away",
    });
    const target = makeEvent("e1", "2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z", {
      location: "Dentist",
    });
    // gap = 6 hours > 4 hours
    expect(findSmartOrigin([preceding, target], target, HOME)).toBe(HOME);
  });

  it("picks the closest preceding event when multiple candidates exist", () => {
    const farPreceding = makeEvent("e0", "2026-06-01T06:00:00Z", "2026-06-01T07:00:00Z", {
      location: "Far Place",
    });
    const closePreceding = makeEvent("e1", "2026-06-01T08:30:00Z", "2026-06-01T09:00:00Z", {
      location: "Close Place",
    });
    const target = makeEvent("e2", "2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z", {
      location: "Dentist",
    });
    expect(findSmartOrigin([farPreceding, closePreceding, target], target, HOME)).toBe(
      "Close Place",
    );
  });

  it("skips events that end after target starts", () => {
    const overlapping = makeEvent("e0", "2026-06-01T09:00:00Z", "2026-06-01T11:00:00Z", {
      location: "Overlapping",
    });
    const target = makeEvent("e1", "2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z", {
      location: "Dentist",
    });
    expect(findSmartOrigin([overlapping, target], target, HOME)).toBe(HOME);
  });

  it("uses event summary as fallback when no location field is set", () => {
    const preceding = makeEvent("e0", "2026-06-01T08:00:00Z", "2026-06-01T09:00:00Z", {
      summary: "Hoyts Ormiston",
    });
    const target = makeEvent("e1", "2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z", {
      location: "Dentist",
    });
    expect(findSmartOrigin([preceding, target], target, HOME)).toBe("Hoyts Ormiston");
  });

  it("ignores events without a location or summary", () => {
    const noLoc = makeEvent("e0", "2026-06-01T08:00:00Z", "2026-06-01T09:00:00Z");
    const target = makeEvent("e1", "2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z", {
      location: "Dentist",
    });
    expect(findSmartOrigin([noLoc, target], target, HOME)).toBe(HOME);
  });
});

describe("refreshCalendarCache", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, HOME_ADDRESS: "1 Home St, Auckland" };
    mocks.getBookingCalendarId.mockReturnValue(BOOKING_CAL);
    mocks.calendarEventCacheDeleteMany.mockResolvedValue({ count: 0 });
    mocks.calendarEventCacheUpsert.mockResolvedValue({});
    mocks.calendarEventCacheUpdateMany.mockResolvedValue({ count: 0 });
    mocks.travelBlockFindMany.mockResolvedValue([]);
    mocks.travelBlockCreate.mockResolvedValue({});
    mocks.travelBlockUpdate.mockResolvedValue({});
    mocks.travelBlockDelete.mockResolvedValue({});
    mocks.calculateTravelMinutes.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("exports refreshCalendarCache as a function", () => {
    expect(typeof refreshCalendarCache).toBe("function");
  });

  it("returns zero counts when fetchAllCalendarEvents fails gracefully", async () => {
    mocks.fetchAllCalendarEvents.mockRejectedValue(new Error("API error"));
    const result = await refreshCalendarCache();
    expect(result).toMatchObject({ cachedCount: 0, deletedCount: 0 });
  });

  it("deletes expired entries and upserts fresh events", async () => {
    mocks.fetchAllCalendarEvents.mockResolvedValue([
      {
        id: "evt-1",
        start: "2026-03-10T21:00:00Z",
        end: "2026-03-10T22:00:00Z",
        calendarEmail: BOOKING_CAL,
      },
      {
        id: "evt-2",
        start: "2026-03-11T21:00:00Z",
        end: "2026-03-11T22:00:00Z",
        calendarEmail: BOOKING_CAL,
      },
    ]);
    mocks.calendarEventCacheDeleteMany.mockResolvedValue({ count: 3 });

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

  it("skips travel blocks when HOME_ADDRESS is not set", async () => {
    delete process.env.HOME_ADDRESS;
    mocks.fetchAllCalendarEvents.mockResolvedValue([]);
    mocks.calendarEventCacheDeleteMany.mockResolvedValue({ count: 0 });

    await refreshCalendarCache();
    expect(mocks.calculateTravelMinutes).not.toHaveBeenCalled();
    expect(mocks.travelBlockCreate).not.toHaveBeenCalled();
  });

  it("skips travel blocks for events without a location", async () => {
    const futureStart = new Date(Date.now() + 3600 * 1000).toISOString();
    const futureEnd = new Date(Date.now() + 7200 * 1000).toISOString();
    mocks.fetchAllCalendarEvents.mockResolvedValue([
      {
        id: "evt-1",
        start: futureStart,
        end: futureEnd,
        calendarEmail: WORK_CAL,
        // no location
      },
    ]);
    mocks.calendarEventCacheDeleteMany.mockResolvedValue({ count: 0 });

    await refreshCalendarCache();
    expect(mocks.calculateTravelMinutes).not.toHaveBeenCalled();
  });

  it("creates travel blocks for eligible future events with a location", async () => {
    const futureStart = new Date(Date.now() + 3600 * 1000).toISOString();
    const futureEnd = new Date(Date.now() + 7200 * 1000).toISOString();
    mocks.fetchAllCalendarEvents.mockResolvedValue([
      {
        id: "evt-work",
        start: futureStart,
        end: futureEnd,
        calendarEmail: WORK_CAL,
        location: "456 Dentist Ave",
        summary: "Dentist",
      },
    ]);
    mocks.calendarEventCacheDeleteMany.mockResolvedValue({ count: 0 });
    mocks.calculateTravelMinutes.mockResolvedValue(20);

    await refreshCalendarCache();

    // Two separate API calls: travel-to then travel-back
    expect(mocks.calculateTravelMinutes).toHaveBeenCalledTimes(2);
    expect(mocks.calculateTravelMinutes).toHaveBeenNthCalledWith(
      1,
      "1 Home St, Auckland",
      "456 Dentist Ave",
      new Date(futureStart),
      { useArrivalTime: true, mode: "transit" },
    );
    expect(mocks.calculateTravelMinutes).toHaveBeenNthCalledWith(
      2,
      "456 Dentist Ave",
      "1 Home St, Auckland",
      new Date(futureEnd),
      { mode: "transit" },
    );

    // Cache entries written with synthetic IDs — no Google Calendar writes
    expect(mocks.calendarEventCacheUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          eventId_calendarEmail: {
            eventId: "travel-before:evt-work",
            calendarEmail: BOOKING_CAL,
          },
        },
      }),
    );
    expect(mocks.calendarEventCacheUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          eventId_calendarEmail: {
            eventId: "travel-after:evt-work",
            calendarEmail: BOOKING_CAL,
          },
        },
      }),
    );

    expect(mocks.travelBlockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceEventId: "evt-work",
        calendarEmail: WORK_CAL,
        beforeEventId: "travel-before:evt-work",
        afterEventId: "travel-after:evt-work",
      }),
    });
  });

  it("uses event.end + 30 min as departure for travel-back on booking calendar events", async () => {
    const futureStart = new Date(Date.now() + 3600 * 1000).toISOString();
    const futureEnd = new Date(Date.now() + 7200 * 1000).toISOString();
    mocks.fetchAllCalendarEvents.mockResolvedValue([
      {
        id: "evt-booking",
        start: futureStart,
        end: futureEnd,
        calendarEmail: BOOKING_CAL,
        location: "789 Client Rd",
        summary: "Tech Support",
      },
    ]);
    mocks.calendarEventCacheDeleteMany.mockResolvedValue({ count: 0 });
    mocks.calculateTravelMinutes.mockResolvedValue(15);

    await refreshCalendarCache();

    const expectedDeparture = new Date(new Date(futureEnd).getTime() + 30 * 60 * 1000);
    expect(mocks.calculateTravelMinutes).toHaveBeenNthCalledWith(
      2,
      "789 Client Rd",
      "1 Home St, Auckland",
      expectedDeparture,
      { mode: "transit" },
    );
  });

  it("does not create a duplicate travel block if one already exists with unchanged times", async () => {
    const futureStart = new Date(Date.now() + 3600 * 1000).toISOString();
    const futureEnd = new Date(Date.now() + 7200 * 1000).toISOString();
    mocks.travelBlockFindMany.mockResolvedValue([
      {
        id: "tb1",
        sourceEventId: "evt-work",
        calendarEmail: WORK_CAL,
        summary: null,
        eventStartAt: new Date(futureStart),
        eventEndAt: new Date(futureEnd),
        rawTravelMinutes: 20,
        roundedMinutes: 30, // Math.ceil(20/15)*15 = 30
        rawTravelBackMinutes: 18,
        roundedBackMinutes: 30, // Math.ceil(18/15)*15 = 30
        beforeEventId: "travel-before:evt-work",
        afterEventId: "travel-after:evt-work",
        transportMode: null,
        customOrigin: null,
        detectedOrigin: "1 Home St, Auckland",
      },
    ]);
    mocks.fetchAllCalendarEvents.mockResolvedValue([
      {
        id: "evt-work",
        start: futureStart,
        end: futureEnd,
        calendarEmail: WORK_CAL,
        location: "456 Dentist Ave",
      },
    ]);
    mocks.calendarEventCacheDeleteMany.mockResolvedValue({ count: 0 });

    await refreshCalendarCache();

    expect(mocks.travelBlockCreate).not.toHaveBeenCalled();
    expect(mocks.calculateTravelMinutes).not.toHaveBeenCalled();
    // Cache entries are upserted (recreated if expired) rather than just updateMany
    expect(mocks.calendarEventCacheUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          eventId_calendarEmail: {
            eventId: "travel-before:evt-work",
            calendarEmail: BOOKING_CAL,
          },
        },
        update: expect.objectContaining({ expiresAt: expect.any(Date) }),
      }),
    );
    expect(mocks.calendarEventCacheUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          eventId_calendarEmail: {
            eventId: "travel-after:evt-work",
            calendarEmail: BOOKING_CAL,
          },
        },
        update: expect.objectContaining({ expiresAt: expect.any(Date) }),
      }),
    );
  });

  it("retries a previously-null travel direction on the next cron run", async () => {
    const futureStart = new Date(Date.now() + 3600 * 1000).toISOString();
    const futureEnd = new Date(Date.now() + 7200 * 1000).toISOString();
    // travel-to succeeded last run, travel-back was null
    mocks.travelBlockFindMany.mockResolvedValue([
      {
        id: "tb1",
        sourceEventId: "evt-work",
        calendarEmail: WORK_CAL,
        summary: null,
        eventStartAt: new Date(futureStart),
        eventEndAt: new Date(futureEnd),
        rawTravelMinutes: 20,
        roundedMinutes: 30,
        rawTravelBackMinutes: null,
        roundedBackMinutes: null,
        beforeEventId: "travel-before:evt-work",
        afterEventId: null,
        transportMode: null,
        customOrigin: null,
        detectedOrigin: "1 Home St, Auckland",
      },
    ]);
    mocks.fetchAllCalendarEvents.mockResolvedValue([
      {
        id: "evt-work",
        start: futureStart,
        end: futureEnd,
        calendarEmail: WORK_CAL,
        location: "456 Dentist Ave",
      },
    ]);
    mocks.calendarEventCacheDeleteMany.mockResolvedValue({ count: 0 });
    // This time the back leg succeeds
    mocks.calculateTravelMinutes.mockResolvedValue(25);

    await refreshCalendarCache();

    // Only the back leg API call should be made (to-leg reuses stored 20 min)
    expect(mocks.calculateTravelMinutes).toHaveBeenCalledTimes(1);
    expect(mocks.calculateTravelMinutes).toHaveBeenCalledWith(
      "456 Dentist Ave",
      "1 Home St, Auckland",
      new Date(futureEnd),
      { mode: "transit" },
    );
    // travel-after cache entry should now be created
    expect(mocks.calendarEventCacheUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          eventId_calendarEmail: {
            eventId: "travel-after:evt-work",
            calendarEmail: BOOKING_CAL,
          },
        },
      }),
    );
  });

  it("uses preceding event location as origin when a nearby event ends within 4 hours", async () => {
    const precedingEnd = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(); // 1h from now
    const futureStart = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2h from now
    const futureEnd = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

    mocks.fetchAllCalendarEvents.mockResolvedValue([
      {
        id: "evt-preceding",
        start: new Date(Date.now() + 0.5 * 60 * 60 * 1000).toISOString(),
        end: precedingEnd,
        calendarEmail: WORK_CAL,
        location: "99 Prior Ave",
        summary: "Prior Meeting",
      },
      {
        id: "evt-target",
        start: futureStart,
        end: futureEnd,
        calendarEmail: WORK_CAL,
        location: "456 Dentist Ave",
        summary: "Dentist",
      },
    ]);
    mocks.calendarEventCacheDeleteMany.mockResolvedValue({ count: 0 });
    mocks.calculateTravelMinutes.mockResolvedValue(10);

    await refreshCalendarCache();

    // travel-to for evt-target should depart from the preceding event's location
    const travelToCalls = mocks.calculateTravelMinutes.mock.calls.filter(
      (c: unknown[]) => c[1] === "456 Dentist Ave",
    );
    expect(travelToCalls.length).toBeGreaterThan(0);
    expect(travelToCalls[0][0]).toBe("99 Prior Ave");
  });

  it("falls back to home when no preceding event is within 4 hours", async () => {
    const farPastEnd = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(); // 1h from now
    // Target starts 6 hours after preceding event ends — outside the 4-hour window
    const futureStart = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString();
    const futureEnd = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

    mocks.fetchAllCalendarEvents.mockResolvedValue([
      {
        id: "evt-old",
        start: new Date(Date.now() + 0.5 * 60 * 60 * 1000).toISOString(),
        end: farPastEnd,
        calendarEmail: WORK_CAL,
        location: "99 Old Place",
        summary: "Old Meeting",
      },
      {
        id: "evt-target",
        start: futureStart,
        end: futureEnd,
        calendarEmail: WORK_CAL,
        location: "456 Dentist Ave",
        summary: "Dentist",
      },
    ]);
    mocks.calendarEventCacheDeleteMany.mockResolvedValue({ count: 0 });
    mocks.calculateTravelMinutes.mockResolvedValue(20);

    await refreshCalendarCache();

    const travelToCalls = mocks.calculateTravelMinutes.mock.calls.filter(
      (c: unknown[]) => c[1] === "456 Dentist Ave",
    );
    expect(travelToCalls.length).toBeGreaterThan(0);
    expect(travelToCalls[0][0]).toBe("1 Home St, Auckland");
  });

  it("uses customOrigin when set, ignoring auto-detection", async () => {
    const precedingEnd = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString();
    const futureStart = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const futureEnd = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

    mocks.travelBlockFindMany.mockResolvedValue([
      {
        id: "tb1",
        sourceEventId: "evt-target",
        calendarEmail: WORK_CAL,
        summary: "Dentist",
        eventStartAt: new Date(futureStart),
        eventEndAt: new Date(futureEnd),
        rawTravelMinutes: null,
        roundedMinutes: null,
        rawTravelBackMinutes: null,
        roundedBackMinutes: null,
        beforeEventId: null,
        afterEventId: null,
        transportMode: null,
        customOrigin: "42 Custom St",
        detectedOrigin: "99 Prior Ave",
      },
    ]);
    mocks.fetchAllCalendarEvents.mockResolvedValue([
      {
        id: "evt-preceding",
        start: new Date(Date.now() + 0.5 * 60 * 60 * 1000).toISOString(),
        end: precedingEnd,
        calendarEmail: WORK_CAL,
        location: "99 Prior Ave",
        summary: "Prior Meeting",
      },
      {
        id: "evt-target",
        start: futureStart,
        end: futureEnd,
        calendarEmail: WORK_CAL,
        location: "456 Dentist Ave",
        summary: "Dentist",
      },
    ]);
    mocks.calendarEventCacheDeleteMany.mockResolvedValue({ count: 0 });
    mocks.calculateTravelMinutes.mockResolvedValue(15);

    await refreshCalendarCache();

    const travelToCalls = mocks.calculateTravelMinutes.mock.calls.filter(
      (c: unknown[]) => c[1] === "456 Dentist Ave",
    );
    expect(travelToCalls.length).toBeGreaterThan(0);
    expect(travelToCalls[0][0]).toBe("42 Custom St");
  });

  it("deletes stale travel blocks when source event no longer exists", async () => {
    mocks.travelBlockFindMany.mockResolvedValue([
      {
        id: "tb1",
        sourceEventId: "evt-old",
        calendarEmail: WORK_CAL,
        beforeEventId: "travel-before:evt-old",
        afterEventId: "travel-after:evt-old",
      },
    ]);
    // evt-old is not in the fetched events
    mocks.fetchAllCalendarEvents.mockResolvedValue([]);
    mocks.calendarEventCacheDeleteMany.mockResolvedValue({ count: 0 });

    await refreshCalendarCache();

    // Deletes from cache, not from Google Calendar
    expect(mocks.calendarEventCacheDeleteMany).toHaveBeenCalledWith({
      where: { eventId: { in: ["travel-before:evt-old", "travel-after:evt-old"] } },
    });
    expect(mocks.travelBlockDelete).toHaveBeenCalledWith({ where: { id: "tb1" } });
  });
});
