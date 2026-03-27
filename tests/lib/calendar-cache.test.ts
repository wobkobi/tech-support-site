import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
      { useArrivalTime: true },
    );
    expect(mocks.calculateTravelMinutes).toHaveBeenNthCalledWith(
      2,
      "456 Dentist Ave",
      "1 Home St, Auckland",
      new Date(futureEnd),
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
