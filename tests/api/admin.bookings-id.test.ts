import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isAdminRequest: vi.fn(),
  bookingFindUnique: vi.fn(),
  bookingUpdate: vi.fn(),
  bookingDelete: vi.fn(),
  deleteBookingEvent: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isAdminRequest: mocks.isAdminRequest,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    booking: {
      findUnique: mocks.bookingFindUnique,
      update: mocks.bookingUpdate,
      delete: mocks.bookingDelete,
    },
  },
}));

vi.mock("@/features/calendar/lib/google-calendar", () => ({
  deleteBookingEvent: mocks.deleteBookingEvent,
}));

import { PATCH, DELETE } from "../../src/app/api/admin/bookings/[id]/route";

const BOOKING = {
  id: "booking-123",
  name: "Alice",
  email: "alice@example.com",
  notes: null,
  status: "confirmed",
  calendarEventId: "cal-event-1",
  activeSlotKey: "2026-03-25T10:00:00.000Z",
};

const PARAMS = { params: Promise.resolve({ id: "booking-123" }) };

/**
 * Creates a fake NextRequest with the given JSON body.
 * @param body - The request body object.
 * @returns A minimal fake NextRequest.
 */
function makeRequest(body: object): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe("PATCH /api/admin/bookings/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bookingFindUnique.mockResolvedValue(BOOKING);
    mocks.bookingUpdate.mockResolvedValue({});
    mocks.deleteBookingEvent.mockResolvedValue(undefined);
  });

  it("returns 401 when request is not from admin", async () => {
    mocks.isAdminRequest.mockReturnValue(false);
    const res = await PATCH(makeRequest({}), PARAMS);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 404 when booking does not exist", async () => {
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.bookingFindUnique.mockResolvedValue(null);
    const res = await PATCH(makeRequest({}), PARAMS);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it("updates name, email, and notes", async () => {
    mocks.isAdminRequest.mockReturnValue(true);
    const res = await PATCH(
      makeRequest({ name: "  Bob  ", email: "  bob@example.com  ", notes: "New notes" }),
      PARAMS,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      where: { id: "booking-123" },
      data: { name: "Bob", email: "bob@example.com", notes: "New notes" },
    });
  });

  it("cancels booking, deletes calendar event, and clears activeSlotKey", async () => {
    mocks.isAdminRequest.mockReturnValue(true);
    const res = await PATCH(makeRequest({ status: "cancelled" }), PARAMS);
    expect(res.status).toBe(200);
    expect(mocks.deleteBookingEvent).toHaveBeenCalledWith({ eventId: "cal-event-1" });
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      where: { id: "booking-123" },
      data: { status: "cancelled", activeSlotKey: null },
    });
  });

  it("skips calendar delete when booking has no calendarEventId", async () => {
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.bookingFindUnique.mockResolvedValue({ ...BOOKING, calendarEventId: null });
    await PATCH(makeRequest({ status: "cancelled" }), PARAMS);
    expect(mocks.deleteBookingEvent).not.toHaveBeenCalled();
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      where: { id: "booking-123" },
      data: { status: "cancelled", activeSlotKey: null },
    });
  });

  it("does not re-cancel an already cancelled booking", async () => {
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.bookingFindUnique.mockResolvedValue({ ...BOOKING, status: "cancelled" });
    await PATCH(makeRequest({ status: "cancelled" }), PARAMS);
    expect(mocks.deleteBookingEvent).not.toHaveBeenCalled();
  });

  it("calendar delete failure does not fail the request", async () => {
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.deleteBookingEvent.mockRejectedValue(new Error("Calendar error"));
    const res = await PATCH(makeRequest({ status: "cancelled" }), PARAMS);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("marks booking as completed and clears activeSlotKey", async () => {
    mocks.isAdminRequest.mockReturnValue(true);
    await PATCH(makeRequest({ status: "completed" }), PARAMS);
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      where: { id: "booking-123" },
      data: { status: "completed", activeSlotKey: null },
    });
  });

  it("marks booking as confirmed without clearing activeSlotKey", async () => {
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.bookingFindUnique.mockResolvedValue({ ...BOOKING, status: "held" });
    await PATCH(makeRequest({ status: "confirmed" }), PARAMS);
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      where: { id: "booking-123" },
      data: { status: "confirmed" },
    });
  });
});

describe("DELETE /api/admin/bookings/[id]", () => {
  /**
   * Creates a minimal fake NextRequest (no body needed for DELETE).
   * @returns A minimal fake NextRequest.
   */
  function makeDeleteRequest(): NextRequest {
    return {} as unknown as NextRequest;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bookingFindUnique.mockResolvedValue(BOOKING);
    mocks.bookingDelete.mockResolvedValue({});
    mocks.deleteBookingEvent.mockResolvedValue(undefined);
  });

  it("returns 401 when request is not from admin", async () => {
    mocks.isAdminRequest.mockReturnValue(false);
    const res = await DELETE(makeDeleteRequest(), PARAMS);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 404 when booking does not exist", async () => {
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.bookingFindUnique.mockResolvedValue(null);
    const res = await DELETE(makeDeleteRequest(), PARAMS);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it("deletes the calendar event and the booking", async () => {
    mocks.isAdminRequest.mockReturnValue(true);
    const res = await DELETE(makeDeleteRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(mocks.deleteBookingEvent).toHaveBeenCalledWith({ eventId: "cal-event-1" });
    expect(mocks.bookingDelete).toHaveBeenCalledWith({ where: { id: "booking-123" } });
  });

  it("skips calendar delete when booking has no calendarEventId", async () => {
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.bookingFindUnique.mockResolvedValue({ ...BOOKING, calendarEventId: null });
    const res = await DELETE(makeDeleteRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect(mocks.deleteBookingEvent).not.toHaveBeenCalled();
    expect(mocks.bookingDelete).toHaveBeenCalledWith({ where: { id: "booking-123" } });
  });

  it("calendar delete failure does not fail the request", async () => {
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.deleteBookingEvent.mockRejectedValue(new Error("Calendar error"));
    const res = await DELETE(makeDeleteRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(mocks.bookingDelete).toHaveBeenCalledWith({ where: { id: "booking-123" } });
  });
});
