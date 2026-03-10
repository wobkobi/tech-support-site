import { describe, it, expect } from "vitest";
import {
  validateBookingRequest,
  buildAvailableDays,
  BOOKING_CONFIG,
  DURATION_OPTIONS,
  TIME_OF_DAY_OPTIONS,
  type ExistingBooking,
} from "../../src/features/booking/lib/booking";

// Fixed "now": 2026-03-09T01:00:00Z = 14:00 NZ time (NZDT UTC+13)
// todayNZStr = "2026-03-09", currentHourNZ = 14
const NOW = new Date("2026-03-09T01:00:00Z");

// A dateKey one day ahead (tomorrow), safely within the booking window
const TOMORROW = "2026-03-10";

// NZ UTC offset on March 10, 2026 is 13 (NZDT)
// 10am NZ on March 10 = Date.UTC(2026, 2, 10, 10-13) = Date.UTC(2026, 2, 9, 21) = 2026-03-09T21:00Z
const SLOT_10AM_UTC = new Date("2026-03-09T21:00:00Z");
const SLOT_10AM_END_UTC = new Date("2026-03-09T22:00:00Z"); // +1 hr

describe("BOOKING_CONFIG", () => {
  it("has correct timeZone", () => {
    expect(BOOKING_CONFIG.timeZone).toBe("Pacific/Auckland");
  });

  it("has maxAdvanceDays of 14", () => {
    expect(BOOKING_CONFIG.maxAdvanceDays).toBe(14);
  });

  it("has bufferMin of 15", () => {
    expect(BOOKING_CONFIG.bufferMin).toBe(15);
  });

  it("has minHoursNotice of 2", () => {
    expect(BOOKING_CONFIG.minHoursNotice).toBe(2);
  });
});

describe("DURATION_OPTIONS", () => {
  it("contains short (60 min) and long (120 min) options", () => {
    const short = DURATION_OPTIONS.find((d) => d.value === "short");
    const long = DURATION_OPTIONS.find((d) => d.value === "long");
    expect(short?.durationMinutes).toBe(60);
    expect(long?.durationMinutes).toBe(120);
  });
});

describe("TIME_OF_DAY_OPTIONS", () => {
  it("has 9 hourly slots from 10am to 6pm", () => {
    expect(TIME_OF_DAY_OPTIONS).toHaveLength(9);
    expect(TIME_OF_DAY_OPTIONS[0].value).toBe("10am");
    expect(TIME_OF_DAY_OPTIONS[TIME_OF_DAY_OPTIONS.length - 1].value).toBe("6pm");
  });
});

describe("validateBookingRequest", () => {
  it("returns valid for a free slot tomorrow", () => {
    const result = validateBookingRequest(TOMORROW, "10am", "short", [], [], NOW, BOOKING_CONFIG);
    expect(result.valid).toBe(true);
  });

  it("returns invalid for a date in the past", () => {
    const result = validateBookingRequest(
      "2020-01-01",
      "10am",
      "short",
      [],
      [],
      NOW,
      BOOKING_CONFIG,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/past/i);
  });

  it("returns invalid for a date beyond maxAdvanceDays", () => {
    const result = validateBookingRequest(
      "2026-04-01",
      "10am",
      "short",
      [],
      [],
      NOW,
      BOOKING_CONFIG,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/advance/i);
  });

  it("returns invalid for a malformed dateKey", () => {
    const result = validateBookingRequest(
      "not-a-date",
      "10am",
      "short",
      [],
      [],
      NOW,
      BOOKING_CONFIG,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Invalid date/i);
  });

  it("returns invalid for an unknown timeOfDay", () => {
    const result = validateBookingRequest(
      TOMORROW,
      "3am" as never,
      "short",
      [],
      [],
      NOW,
      BOOKING_CONFIG,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Invalid time slot/i);
  });

  it("returns invalid when slot conflicts with an existing booking", () => {
    const existing: ExistingBooking = {
      id: "booking-1",
      startAt: SLOT_10AM_UTC,
      endAt: SLOT_10AM_END_UTC,
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
    };
    const result = validateBookingRequest(
      TOMORROW,
      "10am",
      "short",
      [existing],
      [],
      NOW,
      BOOKING_CONFIG,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/no longer available/i);
  });

  it("returns invalid when slot conflicts with a calendar event", () => {
    const calEvent = {
      id: "cal-1",
      start: SLOT_10AM_UTC.toISOString(),
      end: SLOT_10AM_END_UTC.toISOString(),
    };
    const result = validateBookingRequest(
      TOMORROW,
      "10am",
      "short",
      [],
      [calEvent],
      NOW,
      BOOKING_CONFIG,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/no longer available/i);
  });

  it("returns valid for a long (2hr) job with no conflicts", () => {
    const result = validateBookingRequest(TOMORROW, "10am", "long", [], [], NOW, BOOKING_CONFIG);
    expect(result.valid).toBe(true);
  });

  it("returns invalid for long job when only the second hour is blocked", () => {
    // Block the 11am slot (1 hour into a 2hr booking starting at 10am)
    const slot11amStart = new Date(SLOT_10AM_UTC.getTime() + 60 * 60 * 1000);
    const slot11amEnd = new Date(slot11amStart.getTime() + 60 * 60 * 1000);
    const calEvent = {
      id: "cal-2",
      start: slot11amStart.toISOString(),
      end: slot11amEnd.toISOString(),
    };
    const result = validateBookingRequest(
      TOMORROW,
      "10am",
      "long",
      [],
      [calEvent],
      NOW,
      BOOKING_CONFIG,
    );
    expect(result.valid).toBe(false);
  });
});

describe("buildAvailableDays", () => {
  it("returns an array of BookableDay objects", () => {
    const days = buildAvailableDays([], [], NOW, BOOKING_CONFIG);
    expect(Array.isArray(days)).toBe(true);
    expect(days.length).toBeGreaterThan(0);
  });

  it("returns at most maxAdvanceDays days", () => {
    const days = buildAvailableDays([], [], NOW, BOOKING_CONFIG);
    expect(days.length).toBeLessThanOrEqual(BOOKING_CONFIG.maxAdvanceDays);
  });

  it("first day has dateKey matching today NZ date", () => {
    const days = buildAvailableDays([], [], NOW, BOOKING_CONFIG);
    // NOW = 2026-03-09T01:00Z = 14:00 NZ → todayNZ = 2026-03-09
    expect(days[0].dateKey).toBe("2026-03-09");
    expect(days[0].isToday).toBe(true);
  });

  it("marks past slots on today as unavailable (current NZ hour is 14)", () => {
    const days = buildAvailableDays([], [], NOW, BOOKING_CONFIG);
    const today = days.find((d) => d.isToday)!;
    // 10am slot: hoursUntilSlot = 10-14 = -4 < 2 → blocked
    const slot10am = today.timeWindows.find((w) => w.value === "10am")!;
    expect(slot10am.availableShort).toBe(false);
    expect(slot10am.availableLong).toBe(false);
  });

  it("marks slots with sufficient notice on today as available", () => {
    const days = buildAvailableDays([], [], NOW, BOOKING_CONFIG);
    const today = days.find((d) => d.isToday)!;
    // 4pm slot: hoursUntilSlot = 16-14 = 2, NOT < 2 → available
    const slot4pm = today.timeWindows.find((w) => w.value === "4pm")!;
    expect(slot4pm.availableShort).toBe(true);
  });

  it("excludes a day that has no available slots at all", () => {
    // Block all of tomorrow with a very wide calendar event
    const blockAll = {
      id: "block-all",
      start: new Date("2026-03-09T20:00:00Z").toISOString(), // before 10am NZ on March 10
      end: new Date("2026-03-10T12:00:00Z").toISOString(), // after 6pm NZ on March 10 (with buffer)
    };
    const before = buildAvailableDays([], [], NOW, BOOKING_CONFIG);
    const after = buildAvailableDays([], [blockAll], NOW, BOOKING_CONFIG);
    // Tomorrow should be removed from results
    const tomorrowBefore = before.find((d) => d.dateKey === TOMORROW);
    const tomorrowAfter = after.find((d) => d.dateKey === TOMORROW);
    expect(tomorrowBefore).toBeDefined();
    expect(tomorrowAfter).toBeUndefined();
  });

  it("marks slot unavailable when it conflicts with an existing booking (with buffer)", () => {
    // Booking at 10am NZ tomorrow with 15-min buffer after
    const booking: ExistingBooking = {
      id: "b1",
      startAt: SLOT_10AM_UTC,
      endAt: SLOT_10AM_END_UTC,
      bufferBeforeMin: 0,
      bufferAfterMin: 15,
    };
    const days = buildAvailableDays([booking], [], NOW, BOOKING_CONFIG);
    const tomorrow = days.find((d) => d.dateKey === TOMORROW)!;
    const slot10am = tomorrow?.timeWindows.find((w) => w.value === "10am");
    expect(slot10am?.availableShort).toBe(false);
  });
});
