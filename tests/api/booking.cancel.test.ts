import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  bookingFindFirst: vi.fn(),
  bookingUpdate: vi.fn(),
  deleteBookingEvent: vi.fn(),
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    booking: {
      findFirst: mocks.bookingFindFirst,
      update: mocks.bookingUpdate,
    },
  },
}));

vi.mock("@/features/calendar/lib/google-calendar", () => ({
  deleteBookingEvent: mocks.deleteBookingEvent,
}));

import { POST } from "../../src/app/api/booking/cancel/route";

/**
 * Creates a fake NextRequest with the given JSON body.
 * @param body - The request body object.
 * @returns A minimal fake NextRequest.
 */
function makeRequest(body: object): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe("POST /api/booking/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when cancelToken is missing", async () => {
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/cancel token/i);
  });

  it("returns 404 when booking is not found", async () => {
    mocks.bookingFindFirst.mockResolvedValue(null);
    const req = makeRequest({ cancelToken: "unknown-token" });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it("returns 400 when booking is already cancelled", async () => {
    mocks.bookingFindFirst.mockResolvedValue({
      id: "booking-1",
      status: "cancelled",
      calendarEventId: null,
    });
    const req = makeRequest({ cancelToken: "token-1" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/already cancelled/i);
  });

  it("returns ok:true and cancels booking (no calendar event)", async () => {
    mocks.bookingFindFirst.mockResolvedValue({
      id: "booking-2",
      status: "confirmed",
      calendarEventId: null,
    });
    mocks.bookingUpdate.mockResolvedValue({});
    const req = makeRequest({ cancelToken: "token-2" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      where: { id: "booking-2" },
      data: { status: "cancelled", activeSlotKey: null },
    });
  });

  it("deletes calendar event and cancels booking when calendarEventId exists", async () => {
    mocks.bookingFindFirst.mockResolvedValue({
      id: "booking-3",
      status: "confirmed",
      calendarEventId: "cal-event-abc",
    });
    mocks.deleteBookingEvent.mockResolvedValue(undefined);
    mocks.bookingUpdate.mockResolvedValue({});
    const req = makeRequest({ cancelToken: "token-3" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mocks.deleteBookingEvent).toHaveBeenCalledWith({ eventId: "cal-event-abc" });
  });

  it("still cancels booking even when calendar deletion fails", async () => {
    mocks.bookingFindFirst.mockResolvedValue({
      id: "booking-4",
      status: "confirmed",
      calendarEventId: "cal-event-xyz",
    });
    mocks.deleteBookingEvent.mockRejectedValue(new Error("Calendar API error"));
    mocks.bookingUpdate.mockResolvedValue({});
    const req = makeRequest({ cancelToken: "token-4" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mocks.bookingUpdate).toHaveBeenCalled();
  });
});
