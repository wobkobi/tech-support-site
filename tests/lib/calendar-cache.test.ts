import { describe, it, expect } from "vitest";
import * as calendarCache from "../../src/features/calendar/lib/calendar-cache";

// Minimal test for calendar-cache library

describe("calendar-cache", () => {
  it("should export getCalendarCache", () => {
    expect(typeof calendarCache.getCalendarCache).toBe("function");
  });
});
