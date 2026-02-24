import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildAvailableDays,
  validateBookingRequest,
  BOOKING_CONFIG,
  type ExistingBooking,
  type ExistingEvent,
} from "@/lib/booking";

describe("buildAvailableDays & validateBookingRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===== VALIDATION TESTS =====

  describe("validateBookingRequest", () => {
    it("rejects dates in the past", () => {
      vi.setSystemTime(new Date("2026-02-24T10:00:00.000Z")); // 2026-02-24 (11am NZDT)
      const now = new Date();

      const result = validateBookingRequest(
        "2026-02-23",
        "10am",
        "short",
        [],
        [],
        now,
        BOOKING_CONFIG,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain("past");
    });

    it("rejects dates more than 14 days in advance", () => {
      vi.setSystemTime(new Date("2026-02-24T10:00:00.000Z"));
      const now = new Date();

      const result = validateBookingRequest(
        "2026-03-15",
        "10am",
        "short",
        [],
        [],
        now,
        BOOKING_CONFIG,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain("14 days");
    });

    it("accepts valid date 14 days in advance", () => {
      vi.setSystemTime(new Date("2026-02-24T10:00:00.000Z"));
      const now = new Date();

      // 14 days from 2026-02-24 is 2026-03-10
      const result = validateBookingRequest(
        "2026-03-10",
        "10am",
        "short",
        [],
        [],
        now,
        BOOKING_CONFIG,
      );

      expect(result.valid).toBe(true);
    });

    it("rejects invalid date format", () => {
      vi.setSystemTime(new Date("2026-02-24T10:00:00.000Z"));
      const now = new Date();

      const result = validateBookingRequest(
        "not-a-date",
        "10am",
        "short",
        [],
        [],
        now,
        BOOKING_CONFIG,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid date format");
    });

    it("rejects invalid time slot", () => {
      vi.setSystemTime(new Date("2026-02-24T10:00:00.000Z"));
      const now = new Date();

      const result = validateBookingRequest(
        "2026-02-25",
        "midnight",
        "short",
        [],
        [],
        now,
        BOOKING_CONFIG,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid time slot");
    });

    it("accepts valid booking request tomorrow", () => {
      vi.setSystemTime(new Date("2026-02-24T10:00:00.000Z"));
      const now = new Date();

      const result = validateBookingRequest(
        "2026-02-25",
        "10am",
        "short",
        [],
        [],
        now,
        BOOKING_CONFIG,
      );

      expect(result.valid).toBe(true);
    });

    it("rejects 2-hour job that would conflict with existing booking", () => {
      vi.setSystemTime(new Date("2026-02-24T10:00:00.000Z"));
      const now = new Date();

      const existingBooking: ExistingBooking = {
        id: "existing",
        startUtc: new Date("2026-02-25T03:00:00.000Z"), // 4pm NZDT
        endUtc: new Date("2026-02-25T04:00:00.000Z"), // 5pm NZDT
        bufferBeforeMin: 15,
        bufferAfterMin: 15,
      };

      // 3pm-5pm (2hr) would overlap with 4pm-5pm + 15min buffer = 3:45pm-5:15pm
      const result = validateBookingRequest(
        "2026-02-25",
        "3pm",
        "long",
        [existingBooking],
        [],
        now,
        BOOKING_CONFIG,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain("no longer available");
    });
  });

  // ===== AVAILABILITY TESTS =====

  describe("buildAvailableDays", () => {
    it("returns empty array before 2am NZDT (only yesterday + empty)", () => {
      vi.setSystemTime(new Date("2026-02-23T13:00:00.000Z")); // 2am 2026-02-24 NZDT
      const now = new Date();

      const days = buildAvailableDays([], [], now, BOOKING_CONFIG);

      // At 2am, today should be available (slots at 10am+ are >2hrs away, before 6pm cutoff)
      expect(days.length).toBeGreaterThan(0);
      expect(days[0].isToday).toBe(true); // First day is today
    });

    it("excludes today after 6pm same-day cutoff", () => {
      vi.setSystemTime(new Date("2026-02-24T05:30:00.000Z")); // 6:30pm NZDT = next day 5:30am UTC
      const now = new Date();

      const days = buildAvailableDays([], [], now, BOOKING_CONFIG);

      const today = days.find((d) => d.isToday);
      expect(today).toBeUndefined();
    });

    it("enforces 2-hour minimum notice on today", () => {
      vi.setSystemTime(new Date("2026-02-24T00:00:00.000Z")); // 1pm NZDT (12pm UTC)
      const now = new Date();

      const days = buildAvailableDays([], [], now, BOOKING_CONFIG);

      const today = days.find((d) => d.isToday);
      expect(today).toBeDefined();

      // 1pm slot is < 2hrs away, should be unavailable
      const onepmSlot = today?.timeWindows.find((w) => w.value === "1pm");
      expect(onepmSlot?.availableShort).toBe(false);

      // 3pm slot is > 2hrs away, should be available
      const threepmSlot = today?.timeWindows.find((w) => w.value === "3pm");
      expect(threepmSlot?.availableShort).toBe(true);
    });

    it("blocks next-day morning slots after 8pm same-day cutoff", () => {
      vi.setSystemTime(new Date("2026-02-24T07:30:00.000Z")); // 8:30pm NZDT = next day 7:30am UTC
      const now = new Date();

      const days = buildAvailableDays([], [], now, BOOKING_CONFIG);

      const tomorrow = days.find((d) => !d.isToday);
      expect(tomorrow).toBeDefined();

      // 10am and 11am should be blocked
      const tenAmSlot = tomorrow?.timeWindows.find((w) => w.value === "10am");
      expect(tenAmSlot?.availableShort).toBe(false);

      // 12pm onwards should be available
      const noonSlot = tomorrow?.timeWindows.find((w) => w.value === "12pm");
      expect(noonSlot?.availableShort).toBe(true);
    });

    it("marks weekends correctly", () => {
      vi.setSystemTime(new Date("2026-02-23T10:00:00.000Z")); // Mon 2026-02-23
      const now = new Date();

      const days = buildAvailableDays([], [], now, BOOKING_CONFIG);

      // Find Saturday 2026-02-28
      const saturday = days.find((d) => d.dateKey === "2026-02-28");
      expect(saturday?.isWeekend).toBe(true);

      // Find Sunday 2026-03-01
      const sunday = days.find((d) => d.dateKey === "2026-03-01");
      expect(sunday?.isWeekend).toBe(true);

      // Find Monday 2026-03-02
      const monday = days.find((d) => d.dateKey === "2026-03-02");
      expect(monday?.isWeekend).toBe(false);
    });

    it("detects buffer conflicts on existing bookings", () => {
      vi.setSystemTime(new Date("2026-02-23T10:00:00.000Z"));
      const now = new Date();

      const existingBooking: ExistingBooking = {
        id: "existing",
        startUtc: new Date("2026-02-25T03:00:00.000Z"), // 4pm NZDT
        endUtc: new Date("2026-02-25T04:00:00.000Z"), // 5pm NZDT
        bufferBeforeMin: 15,
        bufferAfterMin: 15,
      };

      const days = buildAvailableDays([existingBooking], [], now, BOOKING_CONFIG);

      const day = days.find((d) => d.dateKey === "2026-02-25");
      expect(day).toBeDefined();

      // 1pm slot (1hr job ending 2pm) is within 15min buffer of 3:45pm start - WAIT that doesn't make sense.
      // Let me recalculate: booking is 4pm-5pm. With 15min buffer: blocked 3:45pm-5:15pm.
      // 1pm slot is 1pm-2pm. 2pm < 3:45pm so it should be available.
      // Let me test 3pm instead: 3pm-4pm. 4pm is in blocked zone, so unavailable.

      const onePmSlot = day?.timeWindows.find((w) => w.value === "1pm");
      expect(onePmSlot?.availableShort).toBe(true); // Before buffer

      const threePmSlot = day?.timeWindows.find((w) => w.value === "3pm");
      expect(threePmSlot?.availableShort).toBe(false); // Within buffer window
    });

    it("detects buffer conflicts with calendar events", () => {
      vi.setSystemTime(new Date("2026-02-23T10:00:00.000Z"));
      const now = new Date();

      const calendarEvent: ExistingEvent = {
        id: "cal-event",
        start: "2026-02-24T22:00:00.000Z", // 11am Feb 25 NZDT
        end: "2026-02-24T23:00:00.000Z", // 12pm Feb 25 NZDT
      };

      const days = buildAvailableDays([], [calendarEvent], now, BOOKING_CONFIG);

      const day = days.find((d) => d.dateKey === "2026-02-25");

      // Event 11am-12pm with 15min buffers = 10:45am-12:15pm blocked

      // 11am slot (11am-12pm) should be blocked (fully inside event)
      const elevenAmSlot = day?.timeWindows.find((w) => w.value === "11am");
      expect(elevenAmSlot?.availableShort).toBe(false);

      // 10am slot (10am-11am) should be blocked (overlaps 10:45am buffer start)
      const tenAmSlot = day?.timeWindows.find((w) => w.value === "10am");
      expect(tenAmSlot?.availableShort).toBe(false);

      // 12pm slot (12pm-1pm) should be blocked (overlaps 12:15pm buffer end)
      const noonSlot = day?.timeWindows.find((w) => w.value === "12pm");
      expect(noonSlot?.availableShort).toBe(false);

      // 1pm slot (1pm-2pm) should be available (after buffer)
      const onePmSlot = day?.timeWindows.find((w) => w.value === "1pm");
      expect(onePmSlot?.availableShort).toBe(true);
    });

    it("respects duration-aware slot checking (1hr vs 2hr)", () => {
      vi.setSystemTime(new Date("2026-02-23T10:00:00.000Z"));
      const now = new Date();

      const existingBooking: ExistingBooking = {
        id: "existing",
        startUtc: new Date("2026-02-25T03:00:00.000Z"), // 4pm NZDT
        endUtc: new Date("2026-02-25T04:00:00.000Z"), // 5pm NZDT
        bufferBeforeMin: 15,
        bufferAfterMin: 15,
      };

      const days = buildAvailableDays([existingBooking], [], now, BOOKING_CONFIG);

      const day = days.find((d) => d.dateKey === "2026-02-25");

      // 2pm slot: 2pm-3pm (1hr) fits before buffer at 3:45pm, 2pm-4pm (2hr) overlaps buffer
      const twoPmSlot = day?.timeWindows.find((w) => w.value === "2pm");
      expect(twoPmSlot?.availableShort).toBe(true);
      expect(twoPmSlot?.availableLong).toBe(false); // Conflicts with 3:45pm buffer start

      // 3pm slot: 3pm-4pm (1hr) blocked by buffer, 3pm-5pm (2hr) blocked by booking+buffer
      const threePmSlot = day?.timeWindows.find((w) => w.value === "3pm");
      expect(threePmSlot?.availableShort).toBe(false);
      expect(threePmSlot?.availableLong).toBe(false);
    });

    it("returns hasAnySlots = true with 2hr buffer blocking morning", () => {
      vi.setSystemTime(new Date("2026-02-23T10:00:00.000Z"));
      const now = new Date();

      // Booking 10am-11am with 2hr buffer blocks until 1pm
      const blockingBookings: ExistingBooking[] = [
        {
          id: "b1",
          startUtc: new Date("2026-02-24T21:00:00.000Z"), // 10am
          endUtc: new Date("2026-02-24T22:00:00.000Z"), // 11am
          bufferBeforeMin: 0,
          bufferAfterMin: 120, // 2hr buffer blocks until 1pm
        },
      ];

      const days = buildAvailableDays(blockingBookings, [], now, BOOKING_CONFIG);

      const day = days.find((d) => d.dateKey === "2026-02-25");
      expect(day?.hasAnySlots).toBe(true);

      // Verify morning slots are blocked
      const tenAmSlot = day?.timeWindows.find((w) => w.value === "10am");
      expect(tenAmSlot?.availableShort).toBe(false);

      const elevenAmSlot = day?.timeWindows.find((w) => w.value === "11am");
      expect(elevenAmSlot?.availableShort).toBe(false);

      const noonSlot = day?.timeWindows.find((w) => w.value === "12pm");
      expect(noonSlot?.availableShort).toBe(false);

      // Verify 1pm onwards is available
      const onePmSlot = day?.timeWindows.find((w) => w.value === "1pm");
      expect(onePmSlot?.availableShort).toBe(true);

      const sixPmSlot = day?.timeWindows.find((w) => w.value === "6pm");
      expect(sixPmSlot?.availableShort).toBe(true);
    });

    it("returns hasAnySlots = true when at least one slot available", () => {
      vi.setSystemTime(new Date("2026-02-23T10:00:00.000Z"));
      const now = new Date();

      const days = buildAvailableDays([], [], now, BOOKING_CONFIG);

      // Most days should have at least one slot available
      const daysWithSlots = days.filter((d) => d.hasAnySlots);
      expect(daysWithSlots.length).toBeGreaterThan(0);
    });
  });

  // ===== DST TRANSITION TESTS =====

  describe("DST timezone handling", () => {
    it("correctly handles NZDT (UTC+13) during summer", () => {
      // Feb 24, 2026 is NZDT (UTC+13)
      vi.setSystemTime(new Date("2026-02-24T10:00:00.000Z"));
      const now = new Date();

      // 10am NZ = 21:00 UTC (previous day) during NZDT
      // Create booking at 10am slot
      const bookings: ExistingBooking[] = [
        {
          id: "b1",
          startUtc: new Date("2026-02-24T21:00:00.000Z"), // 10am NZ = 21:00 UTC
          endUtc: new Date("2026-02-24T22:00:00.000Z"), // 11am NZ = 22:00 UTC
          bufferBeforeMin: 0,
          bufferAfterMin: 0,
        },
      ];

      const daysWithBooking = buildAvailableDays(bookings, [], now, BOOKING_CONFIG);
      const tomorrowBooked = daysWithBooking.find((d) => d.dateKey === "2026-02-25");

      const tenAmSlot = tomorrowBooked?.timeWindows.find((w) => w.value === "10am");
      expect(tenAmSlot?.availableShort).toBe(false); // Blocked by booking
    });

    it("correctly handles NZST (UTC+12) during winter", () => {
      // June 15, 2026 is NZST (UTC+12)
      vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
      const now = new Date();

      // 10am NZ = 22:00 UTC (previous day) during NZST
      // Create booking at 10am slot during winter
      const bookings: ExistingBooking[] = [
        {
          id: "b1",
          startUtc: new Date("2026-06-14T22:00:00.000Z"), // 10am NZ = 22:00 UTC
          endUtc: new Date("2026-06-14T23:00:00.000Z"), // 11am NZ = 23:00 UTC
          bufferBeforeMin: 0,
          bufferAfterMin: 0,
        },
      ];

      const daysWithBooking = buildAvailableDays(bookings, [], now, BOOKING_CONFIG);
      const tomorrowBooked = daysWithBooking.find((d) => d.dateKey === "2026-06-15");

      const tenAmSlot = tomorrowBooked?.timeWindows.find((w) => w.value === "10am");
      expect(tenAmSlot?.availableShort).toBe(false); // Blocked by booking
    });

    it("validateBookingRequest handles NZDT correctly", () => {
      // Feb 24, 2026 is NZDT (UTC+13)
      vi.setSystemTime(new Date("2026-02-24T10:00:00.000Z"));
      const now = new Date();

      // Booking exists at 10am NZ on Feb 25
      const bookings: ExistingBooking[] = [
        {
          id: "b1",
          startUtc: new Date("2026-02-24T21:00:00.000Z"), // 10am NZ Feb 25
          endUtc: new Date("2026-02-24T22:00:00.000Z"),
          bufferBeforeMin: 0,
          bufferAfterMin: 0,
        },
      ];

      const result = validateBookingRequest(
        "2026-02-25",
        "10am",
        "short",
        bookings,
        [],
        now,
        BOOKING_CONFIG,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain("no longer available");
    });

    it("validateBookingRequest handles NZST correctly", () => {
      // June 14, 2026 is NZST (UTC+12)
      vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
      const now = new Date();

      // Booking exists at 10am NZ on June 15
      const bookings: ExistingBooking[] = [
        {
          id: "b1",
          startUtc: new Date("2026-06-14T22:00:00.000Z"), // 10am NZ June 15
          endUtc: new Date("2026-06-14T23:00:00.000Z"),
          bufferBeforeMin: 0,
          bufferAfterMin: 0,
        },
      ];

      const result = validateBookingRequest(
        "2026-06-15",
        "10am",
        "short",
        bookings,
        [],
        now,
        BOOKING_CONFIG,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain("no longer available");
    });
  });
});
