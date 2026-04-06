import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockOAuth2, mockInsert, mockDelete, mockList, mockGetOffset } = vi.hoisted(() => {
  const mockOAuth2 = vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ) {
    this.setCredentials = vi.fn();
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
  });
  const mockInsert = vi.fn();
  const mockDelete = vi.fn();
  const mockList = vi.fn();
  const mockGetOffset = vi.fn().mockReturnValue(12);
  return { mockOAuth2, mockInsert, mockDelete, mockList, mockGetOffset };
});

vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: mockOAuth2 },
    calendar: vi.fn().mockReturnValue({
      events: { insert: mockInsert, delete: mockDelete, list: mockList },
    }),
  },
}));

vi.mock("@/shared/lib/timezone-utils", () => ({
  getPacificAucklandOffset: mockGetOffset,
}));

import {
  getBookingCalendarId,
  getOAuth2Client,
  createBookingEvent,
  deleteBookingEvent,
  fetchAllCalendarEvents,
  createTravelBlockEvent,
} from "../../src/features/calendar/lib/google-calendar";

const envBackup = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BOOKING_CALENDAR_ID = "booking-cal-id";
  process.env.WORK_CALENDAR_ID = "work-cal-id";
  process.env.PERSONAL_CALENDAR_ID = "personal-cal-id";
  process.env.GOOGLE_OAUTH_CLIENT_ID = "mock-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "mock-client-secret";
  process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "mock-refresh-token";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://developers.google.com/oauthplayground";
  mockGetOffset.mockReturnValue(12);
  mockList.mockResolvedValue({ data: { items: [] } });
});

afterEach(() => {
  process.env = { ...envBackup };
});

describe("getBookingCalendarId", () => {
  it("returns the booking calendar id from env", () => {
    expect(getBookingCalendarId()).toBe("booking-cal-id");
  });

  it("returns 'primary' when BOOKING_CALENDAR_ID is not set", () => {
    delete process.env.BOOKING_CALENDAR_ID;
    expect(getBookingCalendarId()).toBe("primary");
  });
});

describe("getOAuth2Client", () => {
  it("creates an OAuth2 client with credentials from env", () => {
    const client = getOAuth2Client();
    expect(mockOAuth2).toHaveBeenCalledWith(
      "mock-client-id",
      "mock-client-secret",
      "https://developers.google.com/oauthplayground",
    );
    expect(typeof client.setCredentials).toBe("function");
  });

  it("throws when OAuth credentials are missing", () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    expect(() => getOAuth2Client()).toThrow(/Missing Google OAuth/);
  });
});

describe("createBookingEvent", () => {
  const PARAMS = {
    summary: "Tech Support: Alice - 1 hr",
    description: "Fix my laptop",
    startAt: new Date("2099-06-15T22:00:00Z"),
    endAt: new Date("2099-06-15T23:00:00Z"),
    timeZone: "Pacific/Auckland",
    attendeeEmail: "alice@example.com",
    attendeeName: "Alice",
  };

  it("creates a calendar event and returns the eventId", async () => {
    mockInsert.mockResolvedValue({ data: { id: "event-123" } });
    const result = await createBookingEvent(PARAMS);
    expect(result.eventId).toBe("event-123");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "booking-cal-id",
        requestBody: expect.objectContaining({ summary: PARAMS.summary }),
      }),
    );
  });

  it("includes location when provided", async () => {
    mockInsert.mockResolvedValue({ data: { id: "event-456" } });
    await createBookingEvent({ ...PARAMS, location: "123 Main St" });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ location: "123 Main St" }),
      }),
    );
  });

  it("throws when the API response has no event ID", async () => {
    mockInsert.mockResolvedValue({ data: {} });
    await expect(createBookingEvent(PARAMS)).rejects.toThrow(/no event ID/);
  });
});

describe("deleteBookingEvent", () => {
  it("calls calendar.events.delete with the correct eventId", async () => {
    mockDelete.mockResolvedValue({});
    await deleteBookingEvent({ eventId: "event-to-delete" });
    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "booking-cal-id",
        eventId: "event-to-delete",
      }),
    );
  });
});

describe("fetchAllCalendarEvents", () => {
  const START = new Date("2099-06-01T00:00:00Z");
  const END = new Date("2099-06-30T00:00:00Z");

  it("returns an empty array when calendars have no events", async () => {
    const events = await fetchAllCalendarEvents(START, END);
    expect(events).toHaveLength(0);
  });

  it("returns timed events from configured calendars", async () => {
    mockList.mockResolvedValue({
      data: {
        items: [
          {
            id: "timed-event-1",
            start: { dateTime: "2099-06-15T10:00:00Z" },
            end: { dateTime: "2099-06-15T11:00:00Z" },
            summary: "Meeting",
          },
        ],
      },
    });
    const events = await fetchAllCalendarEvents(START, END);
    // 3 calendars each returning 1 event = 3 total
    expect(events).toHaveLength(3);
    expect(events[0].id).toBe("timed-event-1");
    expect(events[0].summary).toBe("Meeting");
  });

  it("converts all-day events from non-personal calendars using NZ timezone offset", async () => {
    mockList
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: "allday-1",
              start: { date: "2099-06-15" },
              end: { date: "2099-06-16" },
              summary: "All Day",
            },
          ],
        },
      })
      .mockResolvedValue({ data: { items: [] } });

    const events = await fetchAllCalendarEvents(START, END);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("allday-1");
    // With utcOffset=12: startAt = Date.UTC(2099,5,15, -12,0,0) = 2099-06-14T12:00:00Z
    expect(events[0].start).toBe(new Date(Date.UTC(2099, 5, 15, -12, 0, 0)).toISOString());
  });

  it("skips all-day events from the personal calendar", async () => {
    mockList
      .mockResolvedValueOnce({ data: { items: [] } }) // booking
      .mockResolvedValueOnce({ data: { items: [] } }) // work
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: "personal-allday",
              start: { date: "2099-06-15" },
              end: { date: "2099-06-16" },
              summary: "Personal Day Off",
            },
          ],
        },
      }); // personal

    const events = await fetchAllCalendarEvents(START, END);
    expect(events).toHaveLength(0);
  });

  it("continues fetching from other calendars when one fails", async () => {
    mockList
      .mockRejectedValueOnce(new Error("Calendar API error")) // booking fails
      .mockResolvedValue({ data: { items: [] } }); // work and personal succeed

    const events = await fetchAllCalendarEvents(START, END);
    expect(events).toHaveLength(0); // No events but no throw
  });

  it("throws when all calendars fail", async () => {
    mockList.mockRejectedValue(new Error("Network error"));
    await expect(fetchAllCalendarEvents(START, END)).rejects.toThrow(/all.*calendars/i);
  });

  it("skips cancelled events", async () => {
    mockList.mockResolvedValue({
      data: {
        items: [
          {
            id: "cancelled-event",
            status: "cancelled",
            start: { dateTime: "2099-06-15T10:00:00Z" },
            end: { dateTime: "2099-06-15T11:00:00Z" },
            summary: "Cancelled Meeting",
          },
          {
            id: "confirmed-event",
            status: "confirmed",
            start: { dateTime: "2099-06-15T12:00:00Z" },
            end: { dateTime: "2099-06-15T13:00:00Z" },
            summary: "Confirmed Meeting",
          },
        ],
      },
    });
    const events = await fetchAllCalendarEvents(START, END);
    // 3 calendars × 1 confirmed event each = 3 (cancelled ones are filtered out)
    expect(events.every((e) => e.id === "confirmed-event")).toBe(true);
    expect(events.some((e) => e.id === "cancelled-event")).toBe(false);
  });

  it("skips events declined by the self attendee", async () => {
    mockList.mockResolvedValue({
      data: {
        items: [
          {
            id: "declined-event",
            status: "confirmed",
            start: { dateTime: "2099-06-15T10:00:00Z" },
            end: { dateTime: "2099-06-15T11:00:00Z" },
            summary: "Declined Meeting",
            attendees: [{ self: true, responseStatus: "declined" }],
          },
          {
            id: "accepted-event",
            status: "confirmed",
            start: { dateTime: "2099-06-15T12:00:00Z" },
            end: { dateTime: "2099-06-15T13:00:00Z" },
            summary: "Accepted Meeting",
            attendees: [{ self: true, responseStatus: "accepted" }],
          },
        ],
      },
    });
    const events = await fetchAllCalendarEvents(START, END);
    expect(events.every((e) => e.id === "accepted-event")).toBe(true);
    expect(events.some((e) => e.id === "declined-event")).toBe(false);
  });

  it("includes tentative events", async () => {
    mockList
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: "tentative-event",
              status: "tentative",
              start: { dateTime: "2099-06-15T10:00:00Z" },
              end: { dateTime: "2099-06-15T11:00:00Z" },
              summary: "Tentative Meeting",
            },
          ],
        },
      })
      .mockResolvedValue({ data: { items: [] } });
    const events = await fetchAllCalendarEvents(START, END);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("tentative-event");
  });

  it("falls back to ['primary'] when no calendar env vars are set", async () => {
    delete process.env.BOOKING_CALENDAR_ID;
    delete process.env.WORK_CALENDAR_ID;
    delete process.env.PERSONAL_CALENDAR_ID;

    mockList.mockResolvedValue({ data: { items: [] } });
    const events = await fetchAllCalendarEvents(START, END);
    expect(events).toHaveLength(0);
    expect(mockList).toHaveBeenCalledTimes(1); // Only one calendar: "primary"
  });
});

describe("createTravelBlockEvent", () => {
  it("creates a travel block event and returns the eventId", async () => {
    mockInsert.mockResolvedValue({ data: { id: "travel-event-1" } });
    const result = await createTravelBlockEvent({
      summary: "Travel to: Client",
      startAt: new Date("2099-06-15T09:00:00Z"),
      endAt: new Date("2099-06-15T10:00:00Z"),
      timeZone: "Pacific/Auckland",
    });
    expect(result.eventId).toBe("travel-event-1");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sendUpdates: "none",
        requestBody: expect.objectContaining({ summary: "Travel to: Client" }),
      }),
    );
  });

  it("throws when the API response has no event ID", async () => {
    mockInsert.mockResolvedValue({ data: {} });
    await expect(
      createTravelBlockEvent({
        summary: "Travel",
        startAt: new Date(),
        endAt: new Date(),
        timeZone: "Pacific/Auckland",
      }),
    ).rejects.toThrow(/no event ID/);
  });
});
