import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  bookingFindFirst: vi.fn(),
  bookingFindMany: vi.fn(),
  bookingUpdate: vi.fn(),
  validateBookingRequest: vi.fn(),
  fetchAllCalendarEvents: vi.fn(),
  createBookingEvent: vi.fn(),
  deleteBookingEvent: vi.fn(),
  getPacificAucklandOffset: vi.fn(),
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    booking: {
      findFirst: mocks.bookingFindFirst,
      findMany: mocks.bookingFindMany,
      update: mocks.bookingUpdate,
    },
  },
}));

vi.mock("@/features/booking/lib/booking", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/booking/lib/booking")>();
  return {
    ...real,
    validateBookingRequest: mocks.validateBookingRequest,
  };
});

vi.mock("@/features/calendar/lib/google-calendar", () => ({
  fetchAllCalendarEvents: mocks.fetchAllCalendarEvents,
  createBookingEvent: mocks.createBookingEvent,
  deleteBookingEvent: mocks.deleteBookingEvent,
}));

vi.mock("@/shared/lib/timezone-utils", () => ({
  getPacificAucklandOffset: mocks.getPacificAucklandOffset,
}));

import { POST } from "../../src/app/api/booking/edit/route";

/**
 * Creates a fake NextRequest with the given JSON body.
 * @param body - The request body object.
 * @returns A minimal fake NextRequest.
 */
function makeRequest(body: object): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

/** Minimal valid edit payload. */
const VALID_BODY = {
  cancelToken: "cancel-token-abc",
  dateKey: "2099-06-15",
  timeOfDay: "10am",
  duration: "short",
  name: "Alice Smith",
  meetingType: "remote" as const,
  notes: "Please help with my laptop.",
};

/** A confirmed booking returned by findFirst. */
const EXISTING_BOOKING = {
  id: "booking-1",
  email: "alice@example.com",
  status: "confirmed",
  calendarEventId: "cal-old-1",
};

describe("POST /api/booking/edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPacificAucklandOffset.mockReturnValue(12);
    mocks.fetchAllCalendarEvents.mockResolvedValue([]);
    mocks.bookingFindMany.mockResolvedValue([]);
    mocks.validateBookingRequest.mockReturnValue({ valid: true });
  });

  it("returns 400 when cancelToken is missing", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, cancelToken: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cancel token/i);
  });

  it("returns 404 when booking is not found", async () => {
    mocks.bookingFindFirst.mockResolvedValue(null);
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found/i);
  });

  it("returns 400 when booking is cancelled", async () => {
    mocks.bookingFindFirst.mockResolvedValue({ ...EXISTING_BOOKING, status: "cancelled" });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cancelled/i);
  });

  it("returns 400 when name is missing", async () => {
    mocks.bookingFindFirst.mockResolvedValue(EXISTING_BOOKING);
    const res = await POST(makeRequest({ ...VALID_BODY, name: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name/i);
  });

  it("returns 400 when notes are missing", async () => {
    mocks.bookingFindFirst.mockResolvedValue(EXISTING_BOOKING);
    const res = await POST(makeRequest({ ...VALID_BODY, notes: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/describe/i);
  });

  it("returns 400 when in-person booking has no address", async () => {
    mocks.bookingFindFirst.mockResolvedValue(EXISTING_BOOKING);
    const res = await POST(makeRequest({ ...VALID_BODY, meetingType: "in-person", address: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/address/i);
  });

  it("returns 400 when validateBookingRequest fails", async () => {
    mocks.bookingFindFirst.mockResolvedValue(EXISTING_BOOKING);
    mocks.validateBookingRequest.mockReturnValue({ valid: false, error: "Slot not available." });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Slot not available.");
  });

  it("deletes old calendar event and creates new one on success", async () => {
    mocks.bookingFindFirst.mockResolvedValue(EXISTING_BOOKING);
    mocks.createBookingEvent.mockResolvedValue({ eventId: "cal-new-1" });
    mocks.bookingUpdate.mockResolvedValue({});
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(mocks.deleteBookingEvent).toHaveBeenCalledWith({ eventId: "cal-old-1" });
    expect(mocks.createBookingEvent).toHaveBeenCalled();
    expect(mocks.bookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "booking-1" } }),
    );
  });

  it("returns 500 when calendar event creation fails", async () => {
    mocks.bookingFindFirst.mockResolvedValue(EXISTING_BOOKING);
    mocks.createBookingEvent.mockRejectedValue(new Error("Calendar down"));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/calendar/i);
  });

  it("returns 409 when slot is taken concurrently (P2002)", async () => {
    mocks.bookingFindFirst.mockResolvedValue({ ...EXISTING_BOOKING, calendarEventId: null });
    mocks.createBookingEvent.mockResolvedValue({ eventId: "cal-new-2" });
    const p2002 = Object.assign(
      new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "0",
      }),
    );
    mocks.bookingUpdate.mockRejectedValue(p2002);
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no longer available/i);
  });

  it("proceeds even when deleting the old calendar event fails", async () => {
    mocks.bookingFindFirst.mockResolvedValue(EXISTING_BOOKING);
    mocks.deleteBookingEvent.mockRejectedValue(new Error("Calendar delete failed"));
    mocks.createBookingEvent.mockResolvedValue({ eventId: "cal-new-3" });
    mocks.bookingUpdate.mockResolvedValue({});
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("returns 400 when dateKey is missing", async () => {
    mocks.bookingFindFirst.mockResolvedValue(EXISTING_BOOKING);
    const res = await POST(makeRequest({ ...VALID_BODY, dateKey: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/day and time/i);
  });

  it("returns 400 when duration is missing", async () => {
    mocks.bookingFindFirst.mockResolvedValue(EXISTING_BOOKING);
    const res = await POST(makeRequest({ ...VALID_BODY, duration: undefined }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/job duration/i);
  });

  it("returns 400 when meetingType is missing", async () => {
    mocks.bookingFindFirst.mockResolvedValue(EXISTING_BOOKING);
    const res = await POST(makeRequest({ ...VALID_BODY, meetingType: undefined }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/in-person or remote/i);
  });

  it("passes existing bookings to validateBookingRequest", async () => {
    mocks.bookingFindFirst.mockResolvedValue(EXISTING_BOOKING);
    mocks.bookingFindMany.mockResolvedValue([
      {
        id: "other-booking",
        startAt: new Date("2099-05-01T08:00:00Z"),
        endAt: new Date("2099-05-01T09:00:00Z"),
        bufferBeforeMin: 0,
        bufferAfterMin: 30,
      },
    ]);
    mocks.createBookingEvent.mockResolvedValue({ eventId: "cal-new-x" });
    mocks.bookingUpdate.mockResolvedValue({});
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(mocks.validateBookingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ id: "other-booking" })]),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("filters the current booking's calendar event from available slots", async () => {
    mocks.bookingFindFirst.mockResolvedValue(EXISTING_BOOKING);
    mocks.fetchAllCalendarEvents.mockResolvedValue([
      {
        id: "cal-old-1",
        start: "2099-06-15T08:00:00Z",
        end: "2099-06-15T09:00:00Z",
        calendarEmail: "cal@example.com",
      },
      {
        id: "cal-other",
        start: "2099-06-15T09:00:00Z",
        end: "2099-06-15T10:00:00Z",
        calendarEmail: "cal@example.com",
      },
    ]);
    mocks.createBookingEvent.mockResolvedValue({ eventId: "cal-new-y" });
    mocks.bookingUpdate.mockResolvedValue({});
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(mocks.validateBookingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      [{ id: "cal-other", start: "2099-06-15T09:00:00Z", end: "2099-06-15T10:00:00Z" }],
      expect.anything(),
      expect.anything(),
    );
  });

  it("includes address in notes for in-person bookings", async () => {
    mocks.bookingFindFirst.mockResolvedValue(EXISTING_BOOKING);
    mocks.createBookingEvent.mockResolvedValue({ eventId: "cal-new-z" });
    mocks.bookingUpdate.mockResolvedValue({});
    const res = await POST(
      makeRequest({ ...VALID_BODY, meetingType: "in-person", address: "123 Main St" }),
    );
    expect(res.status).toBe(200);
    const updateCall = mocks.bookingUpdate.mock.calls[0][0];
    expect(updateCall.data.notes).toContain("Address: 123 Main St");
  });

  it("includes phone in notes when a phone number is provided", async () => {
    mocks.bookingFindFirst.mockResolvedValue(EXISTING_BOOKING);
    mocks.createBookingEvent.mockResolvedValue({ eventId: "cal-new-w" });
    mocks.bookingUpdate.mockResolvedValue({});
    const res = await POST(makeRequest({ ...VALID_BODY, phone: "021 123 4567" }));
    expect(res.status).toBe(200);
    const updateCall = mocks.bookingUpdate.mock.calls[0][0];
    expect(updateCall.data.notes).toContain("Phone: 021 123 4567");
  });

  it("returns 500 when request.json() throws an unexpected error", async () => {
    const badReq = {
      json: async () => {
        throw new Error("Parse error");
      },
    } as unknown as NextRequest;
    const res = await POST(badReq);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/failed to update booking/i);
  });

  it("continues with empty calendar events when calendar fetch throws", async () => {
    mocks.bookingFindFirst.mockResolvedValue(EXISTING_BOOKING);
    mocks.fetchAllCalendarEvents.mockRejectedValue(new Error("Calendar API error"));
    mocks.createBookingEvent.mockResolvedValue({ eventId: "cal-new-u" });
    mocks.bookingUpdate.mockResolvedValue({});
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
  });

  it("returns 400 for an unrecognised timeOfDay that passes validation", async () => {
    mocks.bookingFindFirst.mockResolvedValue(EXISTING_BOOKING);
    const res = await POST(makeRequest({ ...VALID_BODY, timeOfDay: "99am" as never }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid time or duration/i);
  });

  it("returns 500 when a non-P2002 booking update error is thrown", async () => {
    mocks.bookingFindFirst.mockResolvedValue(EXISTING_BOOKING);
    mocks.createBookingEvent.mockResolvedValue({ eventId: "cal-new-v" });
    mocks.bookingUpdate.mockRejectedValue(new Error("Unexpected DB error"));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/failed to update booking/i);
  });
});
